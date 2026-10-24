"""整点自动更新：定时从 ESPN 拉完赛结果，并入快照。

为什么需要：
    模型权重是静态的，快照（场均进失球 + Elo）不更新的话，今天踢完的比赛
    对后面比赛的预测没有任何影响。原先只在有请求打到 /predict 时才顺带推送，
    属于懒更新 —— 没人刷页面快照就永远停在原地。这里改成每个整点主动拉一次。

拉取策略：
    ESPN 的 scoreboard 只支持单日查询（dates=YYYYMMDD，写成区间会返回 400），
    所以逐日查询。起点取 max(今天-N天, last_observed_date-1)：
    正常情况只查 2 天，服务停机几天后会自动把中间的空档补齐。
    重叠一天是为了兜住「比赛踢到跨天 + 当天完赛但上一轮还没抓到」的情况。

幂等：
    去重完全交给 observe_matches（eventId 全局去重 + baseline_date 跳过），
    所以重复拉同一批是安全的，这里不需要再记账。
"""

from __future__ import annotations

import json
import os
import ssl
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date as Date
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer"

# ESPN 联赛代码 -> 训练数据里的联赛代码。
# 欧冠（uefa.champions）故意不在这里：它不对应任何训练联赛，硬并入会给快照
# 新建一个空的联赛分组，把该联赛的兜底均值打散。
FEEDS: Dict[str, str] = {
    "eng.1": "E0",
    "esp.1": "SP1",
    "ger.1": "D1",
    "ita.1": "I1",
    "fra.1": "F1",
    "chn.1": "CSL",
}

DEFAULT_DAYS_BACK = 7   # 正常情况最多回看几天
MAX_GAP_DAYS = 45       # 落后太多时最多补多少天，防止停机一个月后一次性狂拉
REQUEST_TIMEOUT = 15.0


# ---------------------------------------------------------------------------
# 抓取
# ---------------------------------------------------------------------------


def _get_json(url: str, retries: int = 1) -> Dict[str, Any]:
    """带一次重试的 GET。ESPN 偶发超时/连接重置，重试一次基本能过。"""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    last: Optional[Exception] = None
    for _ in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT, context=ctx) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            last = exc
    raise last  # type: ignore[misc]


def fetch_day(espn_code: str, league: str, day: Date) -> List[Dict[str, Any]]:
    """抓某个联赛某一天的完赛场次（未开赛/进行中的不要）。"""
    url = f"{ESPN_BASE}/{espn_code}/scoreboard?dates={day:%Y%m%d}&limit=100"
    payload = _get_json(url)

    items: List[Dict[str, Any]] = []
    for event in payload.get("events") or []:
        state = (((event.get("status") or {}).get("type") or {}).get("state")) or ""
        if state != "post":
            continue

        comp = (event.get("competitions") or [{}])[0]
        competitors = comp.get("competitors") or []
        if len(competitors) != 2:
            continue
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if home is None or away is None:
            continue

        # 点球决胜的场次（杯赛偶发）不能拿点球比分当常规时间结果，直接跳过
        try:
            if int(home.get("shootoutScore") or 0) or int(away.get("shootoutScore") or 0):
                continue
            home_goals = int(home.get("score"))
            away_goals = int(away.get("score"))
        except (TypeError, ValueError):
            continue

        home_name = (home.get("team") or {}).get("displayName") or (home.get("team") or {}).get("name")
        away_name = (away.get("team") or {}).get("displayName") or (away.get("team") or {}).get("name")
        if not home_name or not away_name:
            continue

        kickoff = str(event.get("date") or "")
        try:
            played = datetime.fromisoformat(kickoff.replace("Z", "+00:00")).astimezone(timezone.utc)
        except ValueError:
            played = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)

        items.append(
            {
                "eventId": str(event.get("id")),
                "league": league,
                "date": played.strftime("%Y-%m-%d"),
                # ts 只用于同一天内的排序（Elo 对顺序敏感），不参与存储
                "ts": played.isoformat(),
                "home": str(home_name),
                "away": str(away_name),
                "homeGoals": home_goals,
                "awayGoals": away_goals,
            }
        )
    return items


def resolve_window(last_observed: str, days_back: int = DEFAULT_DAYS_BACK) -> List[Date]:
    """算出这轮要查哪些日期。

    正常从「上次观察日的昨天」开始（重叠一天做兜底），
    落后太多时最多回看 MAX_GAP_DAYS 天。
    """
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days_back)

    if last_observed:
        try:
            last = Date.fromisoformat(last_observed)
            start = max(start, last - timedelta(days=1))
        except ValueError:
            pass

    start = max(start, today - timedelta(days=MAX_GAP_DAYS))
    start = min(start, today)
    return [start + timedelta(days=i) for i in range((today - start).days + 1)]


def refresh(
    model: Any,
    resolver: Any,
    days_back: int = DEFAULT_DAYS_BACK,
    max_workers: int = 8,
) -> Dict[str, Any]:
    """完整跑一轮：拉取 -> 队名归一化 -> 并入快照。"""
    window = resolve_window(model.form.last_observed_date, days_back)

    tasks = [(code, league, day) for code, league in FEEDS.items() for day in window]
    fetched: List[Dict[str, Any]] = []
    errors: List[str] = []

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(fetch_day, code, league, day): (code, day) for code, league, day in tasks}
        for fut in as_completed(futures):
            code, day = futures[fut]
            try:
                fetched.extend(fut.result())
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{code}@{day:%Y-%m-%d}: {exc}")

    # 队名解析：训练数据里没有的新球队（本赛季升班马）按原名并入，
    # 不能整场丢掉 —— 丢掉的话对手那场的数据也一起没了。新队 Elo 从基准分
    # 起步、场均从这一场开始累积，几轮之后就会收敛到真实水平。
    usable: List[Dict[str, Any]] = []
    unresolved: List[str] = []
    new_teams: List[str] = []

    def pick(raw: str) -> Optional[str]:
        hit = resolver.resolve(raw)
        if hit:
            return hit
        cleaned = str(raw or "").strip()
        if len(cleaned) < 3 or cleaned.upper() in {"TBD", "TBA"}:
            return None
        resolver.add(cleaned)
        new_teams.append(cleaned)
        return cleaned

    for item in fetched:
        home = pick(item["home"])
        away = pick(item["away"])
        if not home or not away:
            unresolved.append(f"{item['home']} vs {item['away']}")
            continue
        usable.append({**item, "home": home, "away": away})

    result = model.observe_matches(usable)

    return {
        **result,
        "fetched": len(fetched),
        "resolved": len(usable),
        "newTeams": sorted(set(new_teams)),
        "unresolvedCount": len(unresolved),
        "unresolved": sorted(set(unresolved))[:20],
        "errorCount": len(errors),
        "errors": errors[:5],
        "window": {
            "from": window[0].isoformat(),
            "to": window[-1].isoformat(),
            "days": len(window),
            "requests": len(tasks),
        },
    }


# ---------------------------------------------------------------------------
# 整点调度
# ---------------------------------------------------------------------------


class HourlyScheduler(threading.Thread):
    """每个整点跑一次的后台线程。

    时间基准取本机本地时区（用户在中国就是 GMT+8），对齐到本地整点。
    每轮结束重新算「下一个整点」，所以长任务跑超了也不会累积漂移。
    """

    def __init__(self, job: Callable[[], Dict[str, Any]], run_on_start: bool = True, name: str = "auto-observe") -> None:
        super().__init__(daemon=True, name=name)
        self._job = job
        self._run_on_start = run_on_start
        self._stop_event = threading.Event()
        self._state_lock = threading.Lock()

        self.enabled = True
        self.runs = 0
        self.last_trigger: Optional[str] = None
        self.last_run_at: Optional[str] = None
        self.last_error: Optional[str] = None
        self.last_result: Optional[Dict[str, Any]] = None
        self.next_run_at: Optional[str] = None

    @staticmethod
    def next_tick(now: Optional[datetime] = None) -> datetime:
        now = now or datetime.now().astimezone()
        return (now + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)

    def run(self) -> None:
        if self._run_on_start:
            self.execute("startup")

        while not self._stop_event.is_set():
            tick = self.next_tick()
            with self._state_lock:
                self.next_run_at = tick.isoformat(timespec="seconds")
            wait = (tick - datetime.now().astimezone()).total_seconds()
            if self._stop_event.wait(max(1.0, wait)):
                break
            self.execute("hourly")

    def execute(self, trigger: str = "manual") -> Optional[Dict[str, Any]]:
        """跑一轮。异常只记录不上抛，绝不能让调度线程死掉。"""
        started = datetime.now().astimezone()
        result: Optional[Dict[str, Any]] = None
        error: Optional[str] = None
        try:
            result = self._job()
        except Exception as exc:  # noqa: BLE001
            error = f"{type(exc).__name__}: {exc}"

        with self._state_lock:
            self.last_trigger = trigger
            self.last_run_at = started.isoformat(timespec="seconds")
            self.last_error = error
            self.last_result = result
            self.runs += 1
            self.next_run_at = self.next_tick().isoformat(timespec="seconds")
        return result

    def stop(self) -> None:
        self._stop_event.set()
        with self._state_lock:
            self.enabled = False

    def status(self) -> Dict[str, Any]:
        with self._state_lock:
            return {
                "enabled": self.enabled,
                "running": self.is_alive(),
                "runs": self.runs,
                "lastTrigger": self.last_trigger,
                "lastRunAt": self.last_run_at,
                "nextRunAt": self.next_run_at,
                "lastError": self.last_error,
                "lastResult": self.last_result,
            }


_scheduler: Optional[HourlyScheduler] = None


def start(model: Any, resolver: Any) -> Optional[HourlyScheduler]:
    """按需拉起全局调度线程。AUTO_OBSERVE=0 可关闭。"""
    global _scheduler
    if os.environ.get("AUTO_OBSERVE", "1").strip() in {"0", "false", "False", "off"}:
        return None
    if _scheduler is not None and _scheduler.is_alive():
        return _scheduler

    try:
        days_back = int(os.environ.get("AUTO_OBSERVE_DAYS", DEFAULT_DAYS_BACK))
    except ValueError:
        days_back = DEFAULT_DAYS_BACK

    job = lambda: refresh(model, resolver, days_back=days_back)  # noqa: E731
    _scheduler = HourlyScheduler(job)
    _scheduler.start()
    return _scheduler


def stop() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.stop()
        _scheduler = None


def status() -> Dict[str, Any]:
    if _scheduler is None:
        return {"enabled": False, "running": False, "reason": "未启动（AUTO_OBSERVE=0 或尚未初始化）"}
    return _scheduler.status()


def trigger() -> Dict[str, Any]:
    """手动触发一次（给 /observe/refresh 用）。"""
    if _scheduler is None:
        return {"ok": False, "reason": "调度器未启动"}
    result = _scheduler.execute("manual")
    return {"ok": True, "result": result, "status": _scheduler.status()}
