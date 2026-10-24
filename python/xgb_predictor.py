"""推理：8 个主客场特征 + 3 个 Elo 特征 -> XGBoost 的 λ主 / λ客 -> 比分矩阵（含 Dixon-Coles 低比分修正）。

与纯泊松模型的区别只在「怎么得到 λ」：
    纯泊松：  λ主 = exp(μ + 主场优势 + 进攻[主] + 防守[客])
    XGBoost： λ主 = 模型(双方主客场场均进/失球 + 主客队赛前 Elo + Elo 分差)

Elo 评分来自训练脚本导出的 team_form.json 快照（K、主场加成也在里面）。

快照不是死的：一场比赛踢完后，observe_matches() 会把结果并入内存里的
场均进失球和 Elo 并写回文件，所以后面的比赛预测会立刻反映新结果。
XGBoost 权重本身不动 —— 变的只是喂进模型的特征。

拿到 λ 之后走同一条路：低比分修正 -> 比分矩阵 -> 胜平负概率。
赛中仍然是「剩余时间按 (90-分钟)/90 折算 + 叠加当前比分」。
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import xgboost as xgb

from features import FEATURE_LABELS, FEATURE_NAMES, StaticFormBook
from scoring import matrix_payload, outcome_probs, score_matrix

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "models")
HOME_MODEL_PATH = os.path.join(MODEL_DIR, "xgb_home.json")
AWAY_MODEL_PATH = os.path.join(MODEL_DIR, "xgb_away.json")
META_PATH = os.path.join(MODEL_DIR, "xgb_meta.json")
FORM_PATH = os.path.join(MODEL_DIR, "team_form.json")

DEFAULT_RHO = -0.022
MIN_LAMBDA = 0.15


class XGBPoissonModel:
    def __init__(
        self,
        home_booster: xgb.Booster,
        away_booster: xgb.Booster,
        form: StaticFormBook,
        meta: Dict[str, Any],
    ) -> None:
        self.home_booster = home_booster
        self.away_booster = away_booster
        self.form = form
        self.meta = meta
        self.rho = float(meta.get("rho", DEFAULT_RHO))

        # 模型实际用到的列：以 meta 为准，允许只部署子集（例如只跑场均基线）
        active = [n for n in (meta.get("features") or FEATURE_NAMES) if n in FEATURE_NAMES]
        self.feature_names = active or list(FEATURE_NAMES)
        self.feature_index = [FEATURE_NAMES.index(n) for n in self.feature_names]
        # FastAPI 默认在线程池里跑同步接口，预测和增量更新可能并发，必须加锁
        self._lock = threading.Lock()

    # -- 加载 ---------------------------------------------------------------

    @classmethod
    def load(cls) -> "XGBPoissonModel":
        if not (os.path.exists(HOME_MODEL_PATH) and os.path.exists(AWAY_MODEL_PATH)):
            raise FileNotFoundError("缺少 XGBoost 模型文件，请先运行 train_xgboost.py")

        def read_booster(path: str) -> xgb.Booster:
            booster = xgb.Booster()
            booster.load_model(path)
            return booster

        with open(META_PATH, "r", encoding="utf-8") as fh:
            meta = json.load(fh)
        with open(FORM_PATH, "r", encoding="utf-8") as fh:
            form = StaticFormBook(json.load(fh))
        return cls(read_booster(HOME_MODEL_PATH), read_booster(AWAY_MODEL_PATH), form, meta)

    # -- 预测 ---------------------------------------------------------------

    def features(self, home: Optional[str], away: Optional[str]) -> np.ndarray:
        values = self.form.features(home, away)
        return np.asarray([[values[i] for i in self.feature_index]], dtype=np.float32)

    def lambdas(self, home: Optional[str], away: Optional[str]) -> Tuple[float, float]:
        X = self.features(home, away)
        dm = xgb.DMatrix(X)
        lam_h = max(MIN_LAMBDA, float(self.home_booster.predict(dm)[0]))
        lam_a = max(MIN_LAMBDA, float(self.away_booster.predict(dm)[0]))
        return lam_h, lam_a

    def feature_payload(self, home: Optional[str], away: Optional[str]) -> Dict[str, float]:
        values = self.form.features(home, away)
        return {
            name: round(float(values[i]), 3)
            for name, i in zip(self.feature_names, self.feature_index)
        }

    def elo_payload(self, home: Optional[str], away: Optional[str]) -> Dict[str, float]:
        elo_h = round(self.form.elo_rating(home), 1)
        elo_a = round(self.form.elo_rating(away), 1)
        return {"home": elo_h, "away": elo_a, "diff": round(elo_h - elo_a, 1)}

    def predict(
        self,
        home_name: str,
        away_name: str,
        home_team: Optional[str],
        away_team: Optional[str],
        state: str = "pre",
        minute: float = 0.0,
        home_goals: int = 0,
        away_goals: int = 0,
    ) -> Dict[str, Any]:
        lam_h_full, lam_a_full = self.lambdas(home_team, away_team)

        if state == "in":
            share = max(0.0, min(1.0, (90.0 - minute) / 90.0))
            lam_h, lam_a = max(0.02, lam_h_full * share), max(0.02, lam_a_full * share)
            grid = score_matrix(lam_h, lam_a, self.rho, off_h=int(home_goals), off_a=int(away_goals))
            exp_h, exp_a = float(home_goals) + lam_h, float(away_goals) + lam_a
        else:
            share = 1.0
            lam_h, lam_a = lam_h_full, lam_a_full
            grid = score_matrix(lam_h, lam_a, self.rho)
            exp_h, exp_a = lam_h, lam_a

        probs = outcome_probs(grid)
        win_p = int(round(probs["win"] * 100))
        draw_p = int(round(probs["draw"] * 100))
        loss_p = max(0, 100 - win_p - draw_p)

        if draw_p >= win_p and draw_p >= loss_p:
            outcome, winner = "平", "平局"
        elif win_p >= loss_p:
            outcome, winner = "胜", home_name
        else:
            outcome, winner = "负", away_name

        payload: Dict[str, Any] = {
            "hasDraw": True,
            "winProb": win_p,
            "drawProb": draw_p,
            "lossProb": loss_p,
            "predictedOutcome": outcome,
            "predictedWinnerName": winner,
            "expectedGoals": {"home": round(exp_h, 2), "away": round(exp_a, 2)},
            "scoreHeatmap": matrix_payload(grid),
            "model": "XGBoost (count:poisson) + Dixon-Coles",
            "rho": round(self.rho, 4),
            "features": self.feature_payload(home_team, away_team),
            "elo": self.elo_payload(home_team, away_team),
            "matchedTeams": {"home": bool(self.form.has_team(home_team)), "away": bool(self.form.has_team(away_team))},
        }
        if state == "in":
            payload["live"] = {
                "minute": round(minute, 1),
                "remainingShare": round(share, 3),
                "score": {"home": int(home_goals), "away": int(away_goals)},
            }
        return payload

    # -- 增量更新（完赛结果并入快照）----------------------------------------

    def observe_matches(self, items: List[Dict[str, Any]]) -> Dict[str, Any]:
        """把一批完赛结果并入内存快照并写回文件。

        items 每项：{eventId, league, date:'YYYY-MM-DD', home, away, homeGoals, awayGoals}
        league 必须是训练数据里的联赛代码（E0/SP1/D1/I1/F1/CSL），
        否则会新建一个空的联赛分组，把该联赛的兜底均值打散。

        返回 {applied, skipped, lastDate, updatedAt}。
        """
        if not items:
            return {"applied": 0, "skipped": 0, "lastDate": self.form.last_observed_date,
                    "updatedAt": self.form.updated_at}

        with self._lock:
            form = self.form
            applied = skipped = 0
            # Elo 对顺序敏感，同一天多场必须按时间顺序并入。
            # ts 是可选的精确开球时间（自动更新会带上）；前端推送没有这个字段，
            # 退回按 eventId 排（ESPN 的 id 递增，近似等于赛程顺序）。
            ordered = sorted(
                items,
                key=lambda it: (str(it["date"]), str(it.get("ts") or ""), str(it["eventId"])),
            )

            for it in ordered:
                day = str(it["date"])
                event_id = str(it["eventId"])
                # 训练数据已经覆盖的日期直接跳过，避免重复累加
                if form.baseline_date and day <= form.baseline_date:
                    skipped += 1
                    continue
                # 已并入过的比赛跳过。按 eventId 全局去重，不能只看最后一天：
                # 自动更新每轮都会重拉最近几天，昨天的比赛在今天还会出现。
                if event_id in form.observed_events:
                    skipped += 1
                    continue

                form.observe(
                    str(it["home"]),
                    str(it["away"]),
                    int(it["homeGoals"]),
                    int(it["awayGoals"]),
                    str(it["league"]),
                )
                form.observed_events[event_id] = day
                if day > form.last_observed_date:
                    form.last_observed_date = day
                applied += 1

            if applied:
                form.prune_observed()
                form.updated_at = datetime.now(timezone.utc).isoformat()
                self._persist()

            return {
                "applied": applied,
                "skipped": skipped,
                "lastDate": form.last_observed_date,
                "updatedAt": form.updated_at,
            }

    def _persist(self) -> None:
        """原子写回快照，避免写一半进程被杀导致文件损坏。

        临时文件名带 pid：万一同时有多个进程（uvicorn 多 worker）在写，
        也不会互相踩同一个 tmp 文件，最后由 os.replace 竞争出唯一结果。
        """
        payload = self.form.to_json()
        tmp_path = f"{FORM_PATH}.{os.getpid()}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=1)
        os.replace(tmp_path, FORM_PATH)

    # -- 说明 ---------------------------------------------------------------

    def describe(self) -> Dict[str, Any]:
        metrics = (self.meta or {}).get("metrics", {})
        return {
            "model": "XGBoost (count:poisson) + Dixon-Coles",
            "rho": round(self.rho, 4),
            "features": self.feature_names,
            "featureLabels": {n: FEATURE_LABELS[n] for n in self.feature_names},
            "trainedAt": self.meta.get("trainedAt"),
            "trainMatches": self.meta.get("trainMatches"),
            "testMatches": self.meta.get("testMatches"),
            "testSeason": self.meta.get("testSeason"),
            "metrics": metrics,
            "elo": self.meta.get("elo"),
            "leagues": self.meta.get("leagues"),
            "byLeague": self.meta.get("byLeague"),
            "teams": len(self.form.teams),
            "snapshot": {
                "baselineDate": self.form.baseline_date,
                "lastObservedDate": self.form.last_observed_date,
                "updatedAt": self.form.updated_at,
                "observedEvents": len(self.form.observed_events),
            },
            "homeBestIteration": self.meta.get("homeBestIteration"),
            "awayBestIteration": self.meta.get("awayBestIteration"),
        }
