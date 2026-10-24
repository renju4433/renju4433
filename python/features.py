"""赛前特征工程：主客场场均进/失球 8 个特征 + Elo 3 个特征（严格无泄漏）。

11 个特征按顺序：
    home_h_gf  主队 主场 场均进球
    home_h_ga  主队 主场 场均失球
    home_a_gf  主队 客场 场均进球
    home_a_ga  主队 客场 场均失球
    away_h_gf  客队 主场 场均进球
    away_h_ga  客队 主场 场均失球
    away_a_gf  客队 客场 场均进球
    away_a_ga  客队 客场 场均失球
    elo_home   主队 赛前 Elo 评分
    elo_away   客队 赛前 Elo 评分
    elo_diff   Elo 分差（主 - 客，不含主场加成）

所有数值只用「该场比赛之前」已经结束的比赛累计，绝不看未来场次。
样本不足时逐级回退：
    该场地 -> 该队两个场地合并 -> 该联赛同场地 -> 该联赛合并 -> 全库合并 -> 常量

场均进失球对全部历史等权（不做时间衰减：实测衰减会让测试集变差）。
也不做贝叶斯收缩：实测 m>0 反而单调变差，树模型按值域切分，
收缩抹平了球队之间的方差，而「样本量」这一信息并没有进入特征。

Elo 采用 World Football Elo 的经典设定：
    期望胜率 We = 1 / (1 + 10^(-(Elo主 + 主场加成 - Elo客)/400))
    更新量      = K × 净胜球系数 × (实际结果 - We)
    净胜球系数  = 1（净胜 1 球）/ 1.5（2 球）/ (11+净胜球)/8（3 球及以上）
初始分 1500，只用赛前评分做特征，赛后立即更新，因此同样无泄漏。
"""

from __future__ import annotations

import csv
import json
import os
from collections import defaultdict
from dataclasses import dataclass
from datetime import date as Date
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence, Tuple, Union

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, "data", "real_soccer_matches.csv")
# 中超是后补的数据（football-data.co.uk 覆盖不到），单独存一个文件，
# 由 load_matches 一并读入。league 字段写 "CSL" 与五大联赛的 E0/SP1/... 区分。
CSL_DATA_PATH = os.path.join(BASE_DIR, "data", "csl_matches.csv")
DATA_PATHS = [DATA_PATH, CSL_DATA_PATH]

FEATURE_NAMES = [
    "home_h_gf",
    "home_h_ga",
    "home_a_gf",
    "home_a_ga",
    "away_h_gf",
    "away_h_ga",
    "away_a_gf",
    "away_a_ga",
    "elo_home",
    "elo_away",
    "elo_diff",
]

FORM_FEATURE_COUNT = 8  # 前 8 个是主客场进/失球特征，其余为 Elo

FEATURE_LABELS = {
    "home_h_gf": "主队主场场均进球",
    "home_h_ga": "主队主场场均失球",
    "home_a_gf": "主队客场场均进球",
    "home_a_ga": "主队客场场均失球",
    "away_h_gf": "客队主场场均进球",
    "away_h_ga": "客队主场场均失球",
    "away_a_gf": "客队客场场均进球",
    "away_a_ga": "客队客场场均失球",
    "elo_home": "主队赛前Elo",
    "elo_away": "客队赛前Elo",
    "elo_diff": "Elo分差(主-客)",
}

# 全库兜底值（历史五大数据平均，仅当局势完全没样本时使用）
DEFAULT_HOME_GF = 1.45
DEFAULT_HOME_GA = 1.15
DEFAULT_AWAY_GF = 1.15
DEFAULT_AWAY_GA = 1.45


@dataclass(frozen=True)
class EloConfig:
    """Elo 超参数。K 与主场加成由训练脚本在训练期内搜索确定。"""

    k: float = 20.0
    home_advantage: float = 65.0
    initial: float = 1500.0

    def to_json(self) -> Dict[str, float]:
        return {
            "k": self.k,
            "homeAdvantage": self.home_advantage,
            "initial": self.initial,
        }


DEFAULT_ELO = EloConfig()


def goal_multiplier(goal_diff: int) -> float:
    """净胜球对 Elo 更新的放大系数。"""
    diff = abs(int(goal_diff))
    if diff <= 1:
        return 1.0
    if diff == 2:
        return 1.5
    return (11.0 + diff) / 8.0


def expected_score(elo_diff: float) -> float:
    """Elo 期望得分（胜=1 平=0.5 负=0）。"""
    return 1.0 / (1.0 + 10.0 ** (-float(elo_diff) / 400.0))


@dataclass
class VenueRecord:
    gf: float = 0.0
    ga: float = 0.0
    n: float = 0.0

    def add(self, gf: float, ga: float) -> None:
        self.gf += gf
        self.ga += ga
        self.n += 1.0

    @property
    def mean(self) -> Optional[Tuple[float, float]]:
        if self.n <= 0:
            return None
        return self.gf / self.n, self.ga / self.n

    def to_json(self) -> Dict[str, float]:
        return {"gf": round(self.gf, 4), "ga": round(self.ga, 4), "n": round(self.n, 4)}

    @classmethod
    def from_json(cls, data: Dict[str, object]) -> "VenueRecord":
        return cls(
            gf=float(data.get("gf", 0) or 0),
            ga=float(data.get("ga", 0) or 0),
            n=float(data.get("n", 0) or 0),
        )


def _pooled(home: VenueRecord, away: VenueRecord) -> Optional[Tuple[float, float]]:
    n = home.n + away.n
    if n <= 0:
        return None
    return (home.gf + away.gf) / n, (home.ga + away.ga) / n


def resolve_venues(
    home_rec: VenueRecord,
    away_rec: VenueRecord,
    league_home: VenueRecord,
    league_away: VenueRecord,
    global_home: VenueRecord,
    global_away: VenueRecord,
) -> Tuple[float, float, float, float]:
    """返回 (该队主场场均进, 主场场均失, 客场场均进, 客场场均失)。

    「客场」指的是同一支球队在客场的数据 —— 调用方把两支球队各自传进来即可。
    """
    pooled = _pooled(home_rec, away_rec)
    league_pooled = _pooled(league_home, league_away)
    global_pooled = _pooled(global_home, global_away)

    home_prior = (
        league_home.mean
        or league_pooled
        or global_pooled
        or (DEFAULT_HOME_GF, DEFAULT_HOME_GA)
    )
    away_prior = (
        league_away.mean
        or league_pooled
        or global_pooled
        or (DEFAULT_AWAY_GF, DEFAULT_AWAY_GA)
    )

    home_mean = home_rec.mean or pooled or home_prior
    away_mean = away_rec.mean or pooled or away_prior
    return (*home_mean, *away_mean)


class FormBook:
    """逐场累积的主客场战绩簿 + Elo 评分，既能流式生成训练特征，也能产出最终快照。"""

    def __init__(self, elo: EloConfig = DEFAULT_ELO) -> None:
        self.home: Dict[str, VenueRecord] = defaultdict(VenueRecord)
        self.away: Dict[str, VenueRecord] = defaultdict(VenueRecord)
        self.league_home: Dict[str, VenueRecord] = defaultdict(VenueRecord)
        self.league_away: Dict[str, VenueRecord] = defaultdict(VenueRecord)
        self.global_home = VenueRecord()
        self.global_away = VenueRecord()
        self.team_league: Dict[str, str] = {}
        self.elo_cfg = elo
        self.elo: Dict[str, float] = {}

    # -- 查询 ---------------------------------------------------------------

    def team_venues(self, team: Optional[str], league: str = "") -> Tuple[float, float, float, float]:
        """返回该队 (主场场均进, 主场场均失, 客场场均进, 客场场均失)。

        用 .get 而不是下标：home/away 是 defaultdict，下标访问会给未知球队
        建一条空记录，推理期每来一个陌生队名都会把球队总数和联赛数撑大。
        """
        lg_key = league or self.team_league.get(team or "", "")
        empty = VenueRecord()
        return resolve_venues(
            self.home.get(team or "", empty),
            self.away.get(team or "", empty),
            self.league_home.get(lg_key, empty),
            self.league_away.get(lg_key, empty),
            self.global_home,
            self.global_away,
        )

    def has_team(self, team: Optional[str]) -> bool:
        return bool(team) and (team in self.home or team in self.away)

    def features(self, home: str, away: str, league: str = "") -> List[float]:
        return [
            *self.team_venues(home, league),
            *self.team_venues(away, league),
            *self.elo_features(home, away),
        ]

    # -- Elo ---------------------------------------------------------------

    def elo_rating(self, team: Optional[str]) -> float:
        if not team:
            return self.elo_cfg.initial
        return self.elo.get(team, self.elo_cfg.initial)

    def elo_features(self, home: Optional[str], away: Optional[str]) -> List[float]:
        elo_h = self.elo_rating(home)
        elo_a = self.elo_rating(away)
        return [elo_h, elo_a, elo_h - elo_a]

    def elo_expectation(self, home: str, away: str) -> float:
        """主队期望得分（含主场加成），仅用于评估 Elo 自身的判别力。"""
        return expected_score(
            self.elo_rating(home) + self.elo_cfg.home_advantage - self.elo_rating(away)
        )

    # -- 更新 ---------------------------------------------------------------

    def observe(
        self,
        home: str,
        away: str,
        home_goals: int,
        away_goals: int,
        league: str = "",
    ) -> None:
        self._update_elo(home, away, home_goals, away_goals)
        self.home[home].add(home_goals, away_goals)
        self.away[away].add(away_goals, home_goals)
        self.league_home[league].add(home_goals, away_goals)
        self.league_away[league].add(away_goals, home_goals)
        self.global_home.add(home_goals, away_goals)
        self.global_away.add(away_goals, home_goals)
        self.team_league[home] = league
        self.team_league[away] = league

    def _update_elo(self, home: str, away: str, home_goals: int, away_goals: int) -> None:
        cfg = self.elo_cfg
        elo_h = self.elo_rating(home)
        elo_a = self.elo_rating(away)
        we = expected_score(elo_h + cfg.home_advantage - elo_a)
        if home_goals > away_goals:
            actual = 1.0
        elif home_goals == away_goals:
            actual = 0.5
        else:
            actual = 0.0
        delta = cfg.k * goal_multiplier(home_goals - away_goals) * (actual - we)
        self.elo[home] = elo_h + delta
        self.elo[away] = elo_a - delta

    # -- 序列化 -------------------------------------------------------------

    def to_json(self) -> Dict[str, object]:
        # 球队集合取主客场的并集：只打过客场的新队（升班马首个客场）
        # 如果只按 self.home 遍历会在写盘时整个丢掉
        empty = VenueRecord()
        home_rec = self.home
        away_rec = self.away
        return {
            "teams": {
                team: {
                    "league": self.team_league.get(team, ""),
                    "home_gf": round(home_rec.get(team, empty).gf, 4),
                    "home_ga": round(home_rec.get(team, empty).ga, 4),
                    "home_n": home_rec.get(team, empty).n,
                    "away_gf": round(away_rec.get(team, empty).gf, 4),
                    "away_ga": round(away_rec.get(team, empty).ga, 4),
                    "away_n": away_rec.get(team, empty).n,
                }
                for team in sorted(set(home_rec) | set(away_rec))
            },
            "leagues": {
                key: {
                    "home": self.league_home[key].to_json(),
                    "away": self.league_away[key].to_json(),
                }
                for key in sorted(self.league_home)
            },
            "global": {"home": self.global_home.to_json(), "away": self.global_away.to_json()},
            "elo": {
                "params": self.elo_cfg.to_json(),
                "ratings": {
                    team: round(rating, 1) for team, rating in sorted(self.elo.items())
                },
            },
        }


class StaticFormBook(FormBook):
    """推理期快照：从训练脚本导出的 JSON 初始化，之后仍支持增量 observe。

    与 FormBook 的唯一区别是「初始状态来自文件」而不是逐场累积。保留 observe()
    的目的是：一场比赛踢完就把它并入特征，让后续比赛预测立刻反映新结果，
    不必重训 XGBoost（权重不变，变的是喂进模型的场均进失球和 Elo）。

    去重靠三个字段：
        baseline_date       训练数据覆盖到的最后一场日期，这一天及之前的比赛一律跳过
        last_observed_date  增量已处理到的最新日期（只用于展示和裁剪）
        observed_events     eventId -> 该场日期，防止同一场重复累加

    注意 observed_events 是「滑动的 eventId 集合」而不是「只存最后一天」：
    整点自动更新每轮都会把最近几天重新拉一遍，如果只记最后一天的 id，
    昨天已并入的比赛在第二天会被当成新比赛再加一次，场均进失球和 Elo 都会失真。
    """

    def __init__(self, data: Dict[str, object]) -> None:
        elo_block = data.get("elo", {}) or {}
        params = elo_block.get("params", {}) or {}  # type: ignore[union-attr]
        super().__init__(
            EloConfig(
                k=float(params.get("k", DEFAULT_ELO.k)),
                home_advantage=float(params.get("homeAdvantage", DEFAULT_ELO.home_advantage)),
                initial=float(params.get("initial", DEFAULT_ELO.initial)),
            )
        )

        for team, item in (data.get("teams") or {}).items():  # type: ignore[union-attr]
            item = item or {}
            self.home[team] = VenueRecord(
                float(item.get("home_gf", 0) or 0),
                float(item.get("home_ga", 0) or 0),
                float(item.get("home_n", 0) or 0),
            )
            self.away[team] = VenueRecord(
                float(item.get("away_gf", 0) or 0),
                float(item.get("away_ga", 0) or 0),
                float(item.get("away_n", 0) or 0),
            )
            self.team_league[team] = str(item.get("league", "") or "")

        for key, item in (data.get("leagues") or {}).items():  # type: ignore[union-attr]
            item = item or {}
            self.league_home[key] = VenueRecord.from_json(item.get("home", {}))
            self.league_away[key] = VenueRecord.from_json(item.get("away", {}))

        overall = data.get("global", {}) or {}
        self.global_home = VenueRecord.from_json((overall or {}).get("home", {}))
        self.global_away = VenueRecord.from_json((overall or {}).get("away", {}))

        self.elo = {
            team: float(rating)
            for team, rating in ((elo_block.get("ratings", {}) or {}).items())  # type: ignore[union-attr]
        }

        self.updated_at = str(data.get("updatedAt", "") or "")
        self.baseline_date = str(data.get("lastMatchDate", "") or "")
        log = data.get("observeLog") or {}
        self.last_observed_date = str(log.get("lastDate", "") or "")  # type: ignore[union-attr]
        # eventId -> 日期。新格式是 events 映射；旧快照只有 eventIds 列表，
        # 那些 id 都属于 lastDate 当天，按当天回填即可。
        self.observed_events: Dict[str, str] = {}
        events = (log or {}).get("events") or {}
        if isinstance(events, dict):
            self.observed_events = {str(k): str(v) for k, v in events.items()}
        for event_id in (log.get("eventIds") or []):  # type: ignore[union-attr]
            self.observed_events.setdefault(str(event_id), self.last_observed_date)

    def prune_observed(self, keep_days: int = 30) -> int:
        """丢掉过期的 eventId，避免快照随赛季无限膨胀。

        自动更新每轮重拉最近几天，30 天窗口足够覆盖，不会重放旧比赛。
        """
        anchor = self.last_observed_date
        if not anchor or not self.observed_events:
            return 0
        try:
            cutoff = Date.fromisoformat(anchor) - timedelta(days=keep_days)
        except ValueError:
            return 0
        before = len(self.observed_events)
        kept: Dict[str, str] = {}
        for event_id, day in self.observed_events.items():
            try:
                if Date.fromisoformat(str(day)) >= cutoff:
                    kept[event_id] = day
            except ValueError:
                kept[event_id] = day  # 日期坏掉的保守保留
        self.observed_events = kept
        return before - len(kept)

    @property
    def teams(self) -> Dict[str, VenueRecord]:
        """兼容旧接口：外部只把 teams 当作「球队名集合」使用。

        取主客场并集，只打过客场的球队也要在里面（TeamResolver 靠它建索引）。
        """
        merged = dict(self.away)
        merged.update(self.home)
        return merged
    def to_json(self) -> Dict[str, object]:
        payload = super().to_json()
        payload["updatedAt"] = self.updated_at
        # lastMatchDate 保持「训练数据截止日」不动，否则重启后会把增量里
        # 同一天已计入的场次误判成「训练已覆盖」，漏掉当天后续比赛
        payload["lastMatchDate"] = self.baseline_date
        payload["observeLog"] = {
            "lastDate": self.last_observed_date,
            "events": dict(sorted(self.observed_events.items())),
        }
        return payload


# ---------------------------------------------------------------------------
# 数据集读取
# ---------------------------------------------------------------------------


def parse_date(text: str) -> datetime:
    return datetime.strptime(text.strip(), "%d/%m/%Y")


def load_matches(path: Optional[Union[str, Sequence[str]]] = None) -> List[Dict[str, object]]:
    """读入全部训练数据。path 为 None 时读 DATA_PATHS（五大联赛 + 中超）。

    缺失的数据文件会跳过而不是报错，方便只跑五大联赛时做对照。
    """
    if path is None:
        paths: List[str] = list(DATA_PATHS)
    elif isinstance(path, str):
        paths = [path]
    else:
        paths = list(path)

    rows: List[Dict[str, object]] = []
    for one in paths:
        if not os.path.exists(one):
            continue
        with open(one, "r", encoding="utf-8") as fh:
            for raw in csv.DictReader(fh):
                try:
                    rows.append(
                        {
                            "season": raw["season"],
                            "league": raw["league"],
                            "date": parse_date(raw["date"]),
                            "home": raw["home"],
                            "away": raw["away"],
                            "fthg": int(raw["fthg"]),
                            "ftag": int(raw["ftag"]),
                        }
                    )
                except (KeyError, ValueError):
                    continue
    rows.sort(key=lambda r: (r["date"], r["home"]))  # type: ignore[arg-type]
    return rows


def build_training_rows(
    path: Optional[Union[str, Sequence[str]]] = None,
    elo: EloConfig = DEFAULT_ELO,
) -> List[Dict[str, object]]:
    """按时间顺序逐场生成特征，特征是「这场之前」的累计均值与赛前 Elo。"""
    book = FormBook(elo)
    out: List[Dict[str, object]] = []
    for match in load_matches(path):
        feats = book.features(match["home"], match["away"], match["league"])  # type: ignore[arg-type]
        out.append({**match, "features": feats})
        book.observe(
            match["home"],  # type: ignore[arg-type]
            match["away"],  # type: ignore[arg-type]
            match["fthg"],  # type: ignore[arg-type]
            match["ftag"],  # type: ignore[arg-type]
            match["league"],  # type: ignore[arg-type]
        )
    return out


def build_snapshot(
    path: Optional[Union[str, Sequence[str]]] = None,
    elo: EloConfig = DEFAULT_ELO,
) -> FormBook:
    """喂完全部历史，得到「下一场比赛」可用的最新快照。"""
    book = FormBook(elo)
    for match in load_matches(path):
        book.observe(
            match["home"],  # type: ignore[arg-type]
            match["away"],  # type: ignore[arg-type]
            match["fthg"],  # type: ignore[arg-type]
            match["ftag"],  # type: ignore[arg-type]
            match["league"],  # type: ignore[arg-type]
        )
    return book


def load_snapshot(path: str) -> StaticFormBook:
    with open(path, "r", encoding="utf-8") as fh:
        return StaticFormBook(json.load(fh))


if __name__ == "__main__":
    rows = build_training_rows()
    sample = rows[len(rows) // 2]
    print(f"样本 {len(rows)} 场，维度 {len(FEATURE_NAMES)}")
    print("样例:", sample["home"], "vs", sample["away"])
    for name, value in zip(FEATURE_NAMES, sample["features"]):  # type: ignore[arg-type]
        print(f"  {name:<12} {FEATURE_LABELS[name]:<14} {value:.3f}")
