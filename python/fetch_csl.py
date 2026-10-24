"""抓取中超（ESPN chn.1）历史完赛数据，输出成训练用的 CSV。

为什么单独抓：训练数据集（football-data.co.uk 五大联赛）不含中超，
所以模型的 11 个特征对中超球队全部会落到兜底值。补上历史比赛后，
场均进失球和 Elo 才有真实信息。

输出字段与 features.load_matches 需要的完全一致：
    season, league, date, home, away, fthg, ftag

season 用跨年标签（"2324" / "2425" / "2526" / "2627"）与五大联赛对齐，
方便沿用同一套 walk-forward 分折；具体防泄漏由按日期截断保证。
league 统一写 "CSL"。
"""

from __future__ import annotations

import csv
import json
import os
import re
import ssl
import sys
import urllib.request
from datetime import datetime, timezone
from typing import Dict, List, Optional

API = "https://site.api.espn.com/apis/site/v2/sports/soccer/chn.1/scoreboard"

OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "csl_matches.csv")

# 中超单年赛季 -> 跨年赛季标签（与五大联赛分折口径对齐）
SEASON_MAP: Dict[int, str] = {
    2023: "2324",
    2024: "2425",
    2025: "2526",
    2026: "2627",
}

_DROP_SUFFIX = re.compile(r"\s+(fc|cf|afc|sc)$", re.IGNORECASE)
_DROP_WORDS = re.compile(r"\s+professional$", re.IGNORECASE)

# 显式别名：ESPN 各赛季写法不一致、或清理后留下重名风险的球队
#   Zhejiang Professional FC -> Zhejiang Professional -> Zhejiang
#   Dalian / Shenzhen 单独出现在 2023 赛季（两家都在 2024 年初解散），
#   与后来的 Dalian Yingbo / Shenzhen Xinpengcheng 是不同球队，必须保持区分，
#   因此给它俩补上后缀，避免 fuzzy 匹配串到新队。
ALIASES: Dict[str, str] = {
    "Zhejiang Professional": "Zhejiang",
    "Zhejiang": "Zhejiang",
    "Henan Songshan Longmen": "Henan",
    "Dalian": "Dalian Pro",
    "Shenzhen": "Shenzhen FC",
    "Sichuan Jiuniu": "Sichuan Jiuniu",
}


def canon_team(raw: str) -> Optional[str]:
    """把 ESPN 队名规范成稳定的内部名。

    "SHANGHAI SHENHUA FC" -> "Shanghai Shenhua"
    "Zhejiang Professional FC" -> "Zhejiang"
    """
    if not raw:
        return None
    text = raw.strip()
    # 全大写（含空格）时转成词首大写
    if text.isupper():
        text = text.title()
    # 循环清理，处理 "Zhejiang Professional FC" 这种一个后缀套一个后缀的情况
    while True:
        cleaned = _DROP_WORDS.sub("", _DROP_SUFFIX.sub("", text))
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if cleaned == text:
            break
        text = cleaned
    return ALIASES.get(text, text) or None


def fetch_year(year: int) -> List[Dict[str, object]]:
    url = f"{API}?dates={year}&limit=400"
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=40, context=ctx) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    rows: List[Dict[str, object]] = []
    for event in payload.get("events", []):
        comp = (event.get("competitions") or [{}])[0]
        state = (((event.get("status") or {}).get("type") or {}).get("state") or "")
        if state != "post":
            continue
        competitors = comp.get("competitors") or []
        if len(competitors) != 2:
            continue
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if home is None or away is None:
            continue
        try:
            fthg = int(home.get("score"))
            ftag = int(away.get("score"))
        except (TypeError, ValueError):
            continue

        home_name = canon_team((home.get("team") or {}).get("displayName") or (home.get("team") or {}).get("name") or "")
        away_name = canon_team((away.get("team") or {}).get("displayName") or (away.get("team") or {}).get("name") or "")
        if not home_name or not away_name:
            continue

        played = datetime.fromisoformat(event["date"].replace("Z", "+00:00")).astimezone(timezone.utc)
        rows.append(
            {
                "season": SEASON_MAP[year],
                "league": "CSL",
                "date": played.strftime("%d/%m/%Y"),
                "home": home_name,
                "away": away_name,
                "fthg": fthg,
                "ftag": ftag,
            }
        )
    return rows


def main() -> None:
    years = sorted(SEASON_MAP)
    all_rows: List[Dict[str, object]] = []
    for year in years:
        try:
            rows = fetch_year(year)
        except Exception as exc:  # noqa: BLE001
            print(f"{year}: 抓取失败 {exc}", file=sys.stderr)
            continue
        print(f"{year}: {len(rows)} 场完赛")
        all_rows.extend(rows)

    # 去重（同一场可能被相邻赛季查询返回）
    seen = set()
    unique: List[Dict[str, object]] = []
    for row in all_rows:
        key = (row["date"], row["home"], row["away"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(row)
    unique.sort(key=lambda r: datetime.strptime(str(r["date"]), "%d/%m/%Y"))

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["season", "league", "date", "home", "away", "fthg", "ftag"])
        writer.writeheader()
        writer.writerows(unique)

    teams = sorted({str(r["home"]) for r in unique} | {str(r["away"]) for r in unique})
    print(f"\n写入 {OUT_PATH}：{len(unique)} 场，{len(teams)} 支球队")
    for team in teams:
        n = sum(1 for r in unique if r["home"] == team or r["away"] == team)
        print(f"  {team:<28} {n} 场")


if __name__ == "__main__":
    main()
