"""足球预测服务：完全 XGBoost（count:poisson）预测进球数 + Dixon-Coles 比分矩阵。

启动：
    python soccer_predictor_api.py            # 本机默认 127.0.0.1:8001
    PORT=8080 python soccer_predictor_api.py  # 云平台：绑定 0.0.0.0:$PORT
    uvicorn soccer_predictor_api:app --port 8001

接口：
    POST /predict/soccer     批量预测（赛前 / 赛中，赛中按当前分钟和比分实时更新）
    POST /observe            手动把完赛结果并入快照（幂等）
    POST /observe/refresh    立刻从 ESPN 拉一轮完赛结果（不用等整点）
    GET  /health             模型状态、验证指标、自动更新调度器状态

自动更新：
    服务启动后拉起一个后台线程，每个整点从 ESPN 拉最近几天的完赛结果并入快照。
    权重不变，变的只是喂进模型的特征（场均进失球 + Elo）。
    关闭方式：AUTO_OBSERVE=0 python soccer_predictor_api.py

模型：
    λ主 / λ客 = XGBoost(双方主/客场场均进/失球 8 特征 + 主客队赛前 Elo / Elo 分差)
    比分矩阵  = λ -> 比分分布 × Dixon-Coles 低比分修正（无任何其他模型参数）

覆盖联赛：
    英超、西甲、德甲、意甲、法甲（football-data.co.uk）+ 中超（ESPN chn.1，见 fetch_csl.py）
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import auto_observe
from team_names import TeamResolver, parse_minute
from xgb_predictor import XGBPoissonModel


@asynccontextmanager
async def lifespan(_: FastAPI):
    """启动整点自动更新线程。MODEL / RESOLVER 在下方模块级初始化，此时已就绪。"""
    auto_observe.start(MODEL, RESOLVER)
    try:
        yield
    finally:
        auto_observe.stop()


app = FastAPI(
    title="完全 XGBoost 足球预测（count:poisson + Dixon-Coles）",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# 入参模型（与 Next.js 侧 payload 保持一致）
# ---------------------------------------------------------------------------


class CompetitorInput(BaseModel):
    id: str
    name: str
    shortName: Optional[str] = None
    abbreviation: Optional[str] = None
    score: Optional[str] = "0"
    homeAway: Optional[str] = "home"
    record: Optional[str] = None
    rank: Optional[int] = None


class MatchInput(BaseModel):
    id: str
    leagueId: str
    sport: str
    state: str = "pre"  # pre | in | post
    displayClock: Optional[str] = None
    competitors: List[CompetitorInput]


class PredictRequest(BaseModel):
    matches: List[MatchInput] = []
    standings: Dict[str, Any] = {}  # 保留字段，当前模型不使用


class FinishedMatch(BaseModel):
    eventId: str
    leagueId: str
    date: str  # ISO 8601（ESPN 的 event.date，UTC）
    home: str
    away: str
    homeGoals: int
    awayGoals: int


class ObserveRequest(BaseModel):
    matches: List[FinishedMatch] = []


# ---------------------------------------------------------------------------
# 模型加载
# ---------------------------------------------------------------------------

MODEL = XGBPoissonModel.load()
RESOLVER = TeamResolver(MODEL.form.teams.keys())
MODEL_NAME = "XGBoost (count:poisson) + Dixon-Coles"

# ESPN 的 leagueId -> 训练数据里的联赛代码。
# 映射错了会给快照新建一个空的联赛分组，把该联赛的兜底均值打散，
# 所以未知联赛宁可不并入（返回 skipped），也不瞎猜。
LEAGUE_CODE = {
    "epl": "E0",
    "laliga": "SP1",
    "bundesliga": "D1",
    "seriea": "I1",
    "ligue1": "F1",
    "csl": "CSL",
}


def _score(value: Optional[str]) -> int:
    try:
        return max(0, int(float(value or 0)))
    except (TypeError, ValueError):
        return 0


def predict_one(match: MatchInput) -> Optional[Dict[str, Any]]:
    if match.sport != "soccer" or match.state == "post" or len(match.competitors) != 2:
        return None

    home = next((c for c in match.competitors if c.homeAway == "home"), match.competitors[0])
    away = next((c for c in match.competitors if c.homeAway == "away"), match.competitors[1])
    if (home.name or "").upper() == "TBD" or (away.name or "").upper() == "TBD":
        return None

    live = match.state == "in"
    return MODEL.predict(
        home_name=home.shortName or home.name,
        away_name=away.shortName or away.name,
        home_team=RESOLVER.resolve(home.name) or RESOLVER.resolve(home.shortName),
        away_team=RESOLVER.resolve(away.name) or RESOLVER.resolve(away.shortName),
        state=match.state,
        minute=parse_minute(match.displayClock, match.state),
        home_goals=_score(home.score) if live else 0,
        away_goals=_score(away.score) if live else 0,
    )


# ---------------------------------------------------------------------------
# 路由
# ---------------------------------------------------------------------------


@app.get("/health")
def health() -> Dict[str, Any]:
    info = MODEL.describe()
    return {
        "status": "ok",
        **info,
        "autoObserve": auto_observe.status(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/predict/soccer")
def predict(req: PredictRequest) -> Dict[str, Any]:
    predictions: Dict[str, Any] = {}
    for match in req.matches:
        result = predict_one(match)
        if result is None:
            continue
        predictions[f"{match.leagueId}-{match.id}"] = result
        predictions[match.id] = result

    return {
        "predictions": predictions,
        "model": MODEL_NAME,
        "rho": round(MODEL.rho, 4),
        "engine": "python-xgboost",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/observe")
def observe(req: ObserveRequest) -> Dict[str, Any]:
    """把已完赛的比赛并入快照，让后续预测立刻反映新结果。

    幂等：同一场重复推送会被 eventId 去重；早于训练数据截止日的比赛一律跳过。
    """
    items: List[Dict[str, Any]] = []
    unknown_league = 0
    unresolved_teams = 0
    bad_date = 0

    for m in req.matches:
        code = LEAGUE_CODE.get(m.leagueId)
        if not code:
            unknown_league += 1
            continue
        home = RESOLVER.resolve(m.home)
        away = RESOLVER.resolve(m.away)
        if not home or not away:
            unresolved_teams += 1
            continue
        try:
            day = (
                datetime.fromisoformat(m.date.replace("Z", "+00:00"))
                .astimezone(timezone.utc)
                .strftime("%Y-%m-%d")
            )
        except ValueError:
            bad_date += 1
            continue
        items.append(
            {
                "eventId": m.eventId,
                "league": code,
                "date": day,
                "home": home,
                "away": away,
                "homeGoals": m.homeGoals,
                "awayGoals": m.awayGoals,
            }
        )

    result = MODEL.observe_matches(items)
    return {
        "received": len(req.matches),
        "accepted": len(items),
        "unknownLeague": unknown_league,
        "unresolvedTeams": unresolved_teams,
        "badDate": bad_date,
        **result,
    }


@app.post("/observe/refresh")
def observe_refresh() -> Dict[str, Any]:
    """立刻从 ESPN 拉一轮完赛结果并入快照，不用等下一个整点。

    调试和「刚踢完一场想马上看新预测」时用；正常情况整点任务会自动做。
    """
    return auto_observe.trigger()


def _serve() -> None:
    """本地直跑。云平台（Wispbyte / Render / Cloud Run 等）会注入 PORT，
    并且要求绑定 0.0.0.0，否则容器外部访问不通。
    Pterodactyl 系面板（Wispbyte 就是）有时用 SERVER_PORT，这里一起兼容。"""
    import os

    import uvicorn

    port_env = (os.environ.get("PORT") or os.environ.get("SERVER_PORT") or "").strip()
    if port_env:
        host = os.environ.get("HOST", "0.0.0.0")
        port = int(port_env)
    else:
        host, port = "127.0.0.1", 8001

    print(f"[serve] listening on http://{host}:{port}", flush=True)
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    _serve()
