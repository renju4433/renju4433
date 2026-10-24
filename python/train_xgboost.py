"""XGBoost 训练：用「双方主/客场场均进/失球 8 特征 + Elo 3 特征」预测两队进球数。

    特征（严格赛前） -> 两个 XGBoost 泊松回归（主队进球 / 客队进球）-> λ主 / λ客
                    -> 把 λ 换算成比分分布与胜平负概率

进球目标函数用 XGBoost 自带的 count:poisson（即泊松损失的梯度提升），
换算环节只有 Dixon-Coles 低比分修正一个系数 rho，rho 在同一批训练数据上
用一维似然搜索确定，不来自任何外部模型。

评估：walk-forward（滚动时间外推）
    对每个测试季 s，只用 < s 的赛季训练，在 s 上打分：
        2324 <- 2223
        2425 <- 2223,2324
        2526 <- 2223,2324,2425
    主指标是胜平负对数损失；各折样本量不同（~1500 场/折），汇总按场次加权（pooled）。
    候选方案与基线做「配对比较」：逐折算差值，再算均值与标准误，
    只有改善超过 1 个标准误才采纳 —— 单片测试集上 0.001 的差异多半是噪声。

场均特征对全部历史等权：不做时间衰减、不做贝叶斯收缩（两者实测都让测试集变差）。

用法：
    python train_xgboost.py
"""

from __future__ import annotations

import json
import math
import os
import statistics
import sys
from datetime import datetime, timezone
from typing import Dict, List, Sequence, Tuple

import numpy as np
from scipy.stats import poisson
from xgboost import XGBRegressor

from features import (
    DATA_PATHS,
    DEFAULT_ELO,
    FEATURE_LABELS,
    FEATURE_NAMES,
    FORM_FEATURE_COUNT,
    EloConfig,
    FormBook,
    build_snapshot,
    build_training_rows,
    load_matches,
)
from scoring import MAX_GOALS, outcome_probs, score_matrix

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "models")
HOME_MODEL_PATH = os.path.join(MODEL_DIR, "xgb_home.json")
AWAY_MODEL_PATH = os.path.join(MODEL_DIR, "xgb_away.json")
META_PATH = os.path.join(MODEL_DIR, "xgb_meta.json")
FORM_PATH = os.path.join(MODEL_DIR, "team_form.json")

# walk-forward 的测试季（每个测试季只用它之前的赛季训练）
FOLD_SEASONS = ["2324", "2425", "2526"]
VALID_RATIO = 0.15  # 每折训练期尾部留一段做 early stopping

# football-data 的联赛代码 -> 中文名（CSL 是后补的中超数据）
LEAGUE_NAMES = {
    "E0": "英超",
    "SP1": "西甲",
    "D1": "德甲",
    "I1": "意甲",
    "F1": "法甲",
    "CSL": "中超",
}

XGB_PARAMS = dict(
    objective="count:poisson",
    n_estimators=1200,
    learning_rate=0.03,
    max_depth=3,
    min_child_weight=8,
    subsample=0.9,
    colsample_bytree=0.9,
    reg_lambda=1.0,
    tree_method="hist",
    early_stopping_rounds=60,
    random_state=42,
)

# Elo 超参数搜索空间与评估用的平局先验（仅用于比较不同 Elo 配置的判别力）
ELO_K_GRID = [16.0, 24.0, 32.0, 40.0, 48.0]
ELO_HFA_GRID = [35.0, 65.0, 95.0, 125.0]
ELO_DRAW_PRIOR = 0.26

# 特征列
BASE_COLS = list(range(0, FORM_FEATURE_COUNT))
ALL_COLS = list(range(len(FEATURE_NAMES)))


def matrix(rows: List[Dict[str, object]], cols: List[int] | None = None) -> np.ndarray:
    X = np.asarray([r["features"] for r in rows], dtype=np.float32)
    return X if cols is None else X[:, cols]


def targets(rows: List[Dict[str, object]]) -> Tuple[np.ndarray, np.ndarray]:
    return (
        np.asarray([r["fthg"] for r in rows], dtype=np.float32),
        np.asarray([r["ftag"] for r in rows], dtype=np.float32),
    )


def poisson_deviance(y: np.ndarray, lam: np.ndarray) -> float:
    lam = np.clip(lam.astype(np.float64), 1e-6, None)
    y = y.astype(np.float64)
    term = np.where(y > 0, y * np.log(y / lam), 0.0)
    return float(np.mean(2.0 * (term - (y - lam))))


# ---------------------------------------------------------------------------
# Elo 超参数（K、主场加成）搜索：只用给定比赛集，指标是纯 Elo 的胜平负对数损失
# ---------------------------------------------------------------------------


def elo_only_logloss(matches: List[Dict[str, object]], cfg: EloConfig) -> float:
    book = FormBook(cfg)
    total = 0.0
    for match in matches:
        we = book.elo_expectation(match["home"], match["away"])  # type: ignore[arg-type]
        p_home = (1.0 - ELO_DRAW_PRIOR) * we
        p_away = (1.0 - ELO_DRAW_PRIOR) * (1.0 - we)
        gh, ga = int(match["fthg"]), int(match["ftag"])  # type: ignore[arg-type]
        prob = p_home if gh > ga else (ELO_DRAW_PRIOR if gh == ga else p_away)
        total -= math.log(max(prob, 1e-12))
        book.observe(
            match["home"],  # type: ignore[arg-type]
            match["away"],  # type: ignore[arg-type]
            gh,
            ga,
            match["league"],  # type: ignore[arg-type]
        )
    return total / max(1, len(matches))


def tune_elo(train_matches: List[Dict[str, object]]) -> Tuple[EloConfig, float]:
    best_cfg, best_ll = DEFAULT_ELO, float("inf")
    for k in ELO_K_GRID:
        for hfa in ELO_HFA_GRID:
            cfg = EloConfig(k=k, home_advantage=hfa)
            ll = elo_only_logloss(train_matches, cfg)
            if ll < best_ll:
                best_cfg, best_ll = cfg, ll
    return best_cfg, best_ll


# ---------------------------------------------------------------------------
# Dixon-Coles 的 rho
# ---------------------------------------------------------------------------


def fit_rho(lambdas: np.ndarray, observed: np.ndarray, grid_step: float = 0.002) -> float:
    """在训练期内用一维搜索确定低比分修正系数 rho（最大化 Dixon-Coles 似然）。"""
    lam_h = np.clip(lambdas[:, 0], 1e-6, None)
    lam_a = np.clip(lambdas[:, 1], 1e-6, None)
    gh = observed[:, 0].astype(int)
    ga = observed[:, 1].astype(int)

    base = poisson.pmf(gh, lam_h) * poisson.pmf(ga, lam_a)
    base = np.clip(base, 1e-12, None)

    def loglik(rho: float) -> float:
        tau = np.ones_like(base)
        m00 = (gh == 0) & (ga == 0)
        m01 = (gh == 0) & (ga == 1)
        m10 = (gh == 1) & (ga == 0)
        m11 = (gh == 1) & (ga == 1)
        tau[m00] = 1.0 - lam_h[m00] * lam_a[m00] * rho
        tau[m01] = 1.0 + lam_h[m01] * rho
        tau[m10] = 1.0 + lam_a[m10] * rho
        tau[m11] = 1.0 - rho
        if np.any(tau <= 0):
            return -np.inf
        return float(np.sum(np.log(base * tau)))

    grid = np.arange(-0.25, 0.2501, grid_step)
    best_rho, best_ll = 0.0, -np.inf
    for rho in grid:
        ll = loglik(float(rho))
        if ll > best_ll:
            best_ll, best_rho = ll, float(rho)
    # 局部细化
    lo, hi = best_rho - grid_step * 2, best_rho + grid_step * 2
    for _ in range(40):
        mid1 = lo + (hi - lo) / 3
        mid2 = hi - (hi - lo) / 3
        if loglik(mid1) < loglik(mid2):
            lo = mid1
        else:
            hi = mid2
    return round((lo + hi) / 2, 5)


def evaluate_wdl(
    lambdas: np.ndarray,
    rows: List[Dict[str, object]],
    rho: float,
) -> Dict[str, float]:
    eps = 1e-12
    log_loss = 0.0
    brier = 0.0
    hits = 0
    cs_loss = 0.0
    for (lam_h, lam_a), row in zip(lambdas, rows):
        grid = score_matrix(max(0.05, float(lam_h)), max(0.05, float(lam_a)), rho)
        probs = outcome_probs(grid)
        win, draw, loss = probs["win"], probs["draw"], probs["loss"]
        gh, ga = int(row["fthg"]), int(row["ftag"])
        if gh > ga:
            observed, p_hit = (1.0, 0.0, 0.0), win
        elif gh == ga:
            observed, p_hit = (0.0, 1.0, 0.0), draw
        else:
            observed, p_hit = (0.0, 0.0, 1.0), loss
        log_loss -= math.log(max(p_hit, eps))
        brier += sum((p - o) ** 2 for p, o in zip((win, draw, loss), observed))
        best = max(win, draw, loss)
        if p_hit == best:
            hits += 1
        bh, ba = min(MAX_GOALS, gh), min(MAX_GOALS, ga)
        cs_loss -= math.log(max(float(grid[bh, ba]), eps))
    n = max(1, len(rows))
    return {
        "wdlLogLoss": round(log_loss / n, 5),
        "brier": round(brier / n, 5),
        "accuracy": round(hits / n, 4),
        "correctScoreLogLoss": round(cs_loss / n, 5),
    }


def fit_pair(
    X_fit: np.ndarray,
    yh_fit: np.ndarray,
    ya_fit: np.ndarray,
    X_val: np.ndarray,
    yh_val: np.ndarray,
    ya_val: np.ndarray,
    verbose: bool = False,
) -> Dict[str, XGBRegressor]:
    models: Dict[str, XGBRegressor] = {}
    for side, (y_fit, y_val) in {"home": (yh_fit, yh_val), "away": (ya_fit, ya_val)}.items():
        model = XGBRegressor(**XGB_PARAMS)
        model.fit(X_fit, y_fit, eval_set=[(X_val, y_val)], verbose=False)
        models[side] = model
        if verbose:
            print(
                f"    {side}: best_iter={getattr(model, 'best_iteration', None)} "
                f"valid_dev={float(model.best_score):.5f}"
            )
    return models


# ---------------------------------------------------------------------------
# walk-forward 评估
# ---------------------------------------------------------------------------


def fold_cutoffs(rows: List[Dict[str, object]], test_season: str) -> Dict[str, object]:
    """每个联赛在本折测试集里的最早日期。

    为什么按联赛分别截断：中超是单年赛季（3~11 月），五大联赛是跨年赛季
    （8 月~次年 5 月），两者用同一个 season 标签永远对不齐。如果统一用
    「测试集最早日期」截断，中超 2~3 月开赛就会把上一折五大联赛 2~5 月的
    比赛全部挤出训练集。按联赛各自截断既严格无泄漏，又不损失样本。
    """
    cuts: Dict[str, object] = {}
    for row in rows:
        if str(row["season"]) != test_season:
            continue
        league = str(row["league"])
        day = row["date"]
        if league not in cuts or day < cuts[league]:
            cuts[league] = day
    return cuts


def train_pool(rows: List[Dict[str, object]], test_season: str) -> List[Dict[str, object]]:
    """该折可用的训练集：同一联赛内，只取该联赛测试集起点之前的比赛。"""
    cuts = fold_cutoffs(rows, test_season)
    if not cuts:
        return []
    fallback = min(cuts.values())
    return [r for r in rows if r["date"] < cuts.get(str(r["league"]), fallback)]


def split_fold(rows: List[Dict[str, object]], test_season: str):
    """返回 (fit, valid, test, train)，训练集严格早于该折测试集。"""
    test_rows = [r for r in rows if str(r["season"]) == test_season]
    train_rows = train_pool(rows, test_season)
    split = int(len(train_rows) * (1 - VALID_RATIO))
    return train_rows[:split], train_rows[split:], test_rows, train_rows


def eval_fold(
    rows: List[Dict[str, object]],
    test_season: str,
    cols: List[int],
) -> Dict[str, object]:
    fit_rows, valid_rows, test_rows, train_rows = split_fold(rows, test_season)
    if not fit_rows or not test_rows:
        return {}

    models = fit_pair(
        matrix(fit_rows, cols), *targets(fit_rows),
        matrix(valid_rows, cols), *targets(valid_rows),
    )

    def lam(subset: List[Dict[str, object]]) -> np.ndarray:
        X = matrix(subset, cols)
        return np.column_stack([models["home"].predict(X), models["away"].predict(X)])

    rho = fit_rho(lam(train_rows), np.column_stack(targets(train_rows)))

    lam_test = lam(test_rows)
    yh_test, ya_test = targets(test_rows)
    mae = (
        float(np.mean(np.abs(lam_test[:, 0] - yh_test)))
        + float(np.mean(np.abs(lam_test[:, 1] - ya_test)))
    ) / 2

    # 分联赛指标：混训后要能看清「中超自己的准确度」与「有没有拖累五大联赛」
    by_league: Dict[str, Dict[str, object]] = {}
    for league in sorted({str(r["league"]) for r in test_rows}):
        idx = [i for i, r in enumerate(test_rows) if str(r["league"]) == league]
        sub_rows = [test_rows[i] for i in idx]
        sub_lam = lam_test[idx]
        sub_mae = (
            float(np.mean(np.abs(sub_lam[:, 0] - yh_test[idx])))
            + float(np.mean(np.abs(sub_lam[:, 1] - ya_test[idx])))
        ) / 2
        by_league[league] = {
            "n": len(sub_rows),
            "lambdaMAE": round(sub_mae, 4),
            **evaluate_wdl(sub_lam, sub_rows, rho),
        }

    return {
        "season": test_season,
        "n": len(test_rows),
        "trainMatches": len(train_rows),
        "lambdaMAE": round(mae, 4),
        "poissonDeviance": round(
            (poisson_deviance(yh_test, lam_test[:, 0]) + poisson_deviance(ya_test, lam_test[:, 1])) / 2,
            5,
        ),
        **evaluate_wdl(lam_test, test_rows, rho),
        "byLeague": by_league,
        "rho": rho,
    }


def walk_forward(
    rows: List[Dict[str, object]],
    cols: List[int],
    seasons: Sequence[str] = tuple(FOLD_SEASONS),
) -> List[Dict[str, object]]:
    out = []
    for season in seasons:
        res = eval_fold(rows, season, cols)
        if res:
            out.append(res)
    return out


def aggregate(folds: List[Dict[str, object]]) -> Dict[str, object]:
    """按场次加权汇总各折（pooled），并给出折间标准误。"""
    n = sum(int(f["n"]) for f in folds)
    keys = ("wdlLogLoss", "brier", "accuracy", "correctScoreLogLoss", "lambdaMAE", "poissonDeviance")
    pooled = {k: round(sum(float(f[k]) * int(f["n"]) for f in folds) / n, 5) for k in keys}
    lls = [float(f["wdlLogLoss"]) for f in folds]
    out: Dict[str, object] = {
        "n": n,
        **pooled,
        "foldLogLoss": [round(x, 5) for x in lls],
    }
    if len(lls) > 1:
        out["stderr"] = round(statistics.stdev(lls) / math.sqrt(len(lls)), 5)
    return out


def aggregate_by_league(folds: List[Dict[str, object]]) -> Dict[str, Dict[str, object]]:
    """把各折的分联赛指标按场次汇总。

    混训后最重要的两个问题：中超自己预测得准不准、有没有把五大联赛拖下水。
    整体 pooled 指标答不了这两个问题，必须拆开看。
    """
    out: Dict[str, Dict[str, object]] = {}
    leagues = sorted({str(lg) for f in folds for lg in (f.get("byLeague") or {})})
    keys = ("wdlLogLoss", "brier", "accuracy", "correctScoreLogLoss", "lambdaMAE")
    for league in leagues:
        items = [
            (f["byLeague"][league], int(f["byLeague"][league]["n"]))  # type: ignore[index]
            for f in folds
            if league in (f.get("byLeague") or {})
        ]
        n = sum(cnt for _, cnt in items)
        if n == 0:
            continue
        out[league] = {
            "n": n,
            **{
                k: round(sum(float(item[k]) * cnt for item, cnt in items) / n, 5)  # type: ignore[index]
                for k in keys
            },
        }
    return out


def paired_delta(
    candidate: List[Dict[str, object]], reference: List[Dict[str, object]]
) -> Tuple[float, float]:
    """逐折配对差值（候选 − 基线）的均值与标准误。"""
    deltas = [
        float(a["wdlLogLoss"]) - float(b["wdlLogLoss"])
        for a, b in zip(candidate, reference)
    ]
    mean = sum(deltas) / len(deltas)
    if len(deltas) < 2:
        return mean, float("inf")
    se = statistics.stdev(deltas) / math.sqrt(len(deltas))
    return mean, se


def fmt_delta(delta: float, se: float) -> str:
    if not math.isfinite(se):
        return f"{delta:+.5f}"
    verdict = "显著" if abs(delta) > se else "不显著"
    return f"{delta:+.5f} ± {se:.5f} ({verdict})"


def main() -> None:
    # --no-csl 只跑五大联赛，用于对比「中超加入前后」五大联赛自身指标有没有被拖累
    include_csl = "--no-csl" not in sys.argv
    data_paths = [DATA_PATHS[0]] if not include_csl else list(DATA_PATHS)
    all_matches = load_matches(data_paths)
    seasons = sorted({str(m["season"]) for m in all_matches})
    leagues = sorted({str(m["league"]) for m in all_matches})
    print(f"数据：{len(all_matches)} 场，联赛 {','.join(leagues)}")

    # 1) 每折各自搜索 Elo 超参数（只用该折训练期，避免评估泄漏）
    print("按折搜索 Elo 超参数（每折只用该折训练期）：")
    elo_by_fold: Dict[str, EloConfig] = {}
    for season in FOLD_SEASONS:
        subset = train_pool(all_matches, season)
        cfg, ll = tune_elo(subset)
        elo_by_fold[season] = cfg
        print(
            f"  {season}: 训练 {len(subset)} 场 -> K={cfg.k:g} 主场加成={cfg.home_advantage:g} "
            f"(纯 Elo logloss {ll:.5f})"
        )

    # 2) 两套特征组合各走一遍 walk-forward（每折用自己的 Elo 配置建特征）
    rows_by_fold = {
        season: build_training_rows(data_paths, elo_by_fold[season]) for season in FOLD_SEASONS
    }
    results: Dict[str, List[Dict[str, object]]] = {}
    aggs: Dict[str, Dict[str, object]] = {}
    for label, cols in (("场均(8)", BASE_COLS), (f"场均+Elo({len(ALL_COLS)})", ALL_COLS)):
        folds: List[Dict[str, object]] = []
        for season in FOLD_SEASONS:
            res = eval_fold(rows_by_fold[season], season, cols)
            if res:
                folds.append(res)
        results[label] = folds
        aggs[label] = aggregate(folds)

    print("\nwalk-forward 结果（主指标=胜平负 logloss）：")
    header = (
        f"  {'方案':<16}{'pooled ll':>11}{'折间se':>9}"
        + "".join(f"{s:>9}" for s in FOLD_SEASONS)
        + f"{'MAE':>9}{'Brier':>9}{'acc':>8}"
    )
    print(header)
    print("  " + "-" * (len(header) - 2))
    for label, agg in aggs.items():
        print(
            f"  {label:<16}{agg['wdlLogLoss']:>11.5f}{agg.get('stderr', 0):>9.5f}"
            + "".join(f"{float(f['wdlLogLoss']):>9.5f}" for f in results[label])
            + f"{agg['lambdaMAE']:>9.4f}{agg['brier']:>9.5f}{agg['accuracy']:>8.3f}"
        )

    base_label, full_label = "场均(8)", f"场均+Elo({len(ALL_COLS)})"
    delta, delta_se = paired_delta(results[full_label], results[base_label])
    elo_verdict = fmt_delta(delta, delta_se)
    print(f"\nElo 增量（配对）：{elo_verdict}")
    adopt_elo = delta < 0 and abs(delta) > delta_se
    final_label = full_label if adopt_elo else base_label
    chosen_agg = aggs[final_label]
    chosen_folds = results[final_label]
    decision = (
        f"采用 {final_label}：胜平负 logloss {chosen_agg['wdlLogLoss']:.5f}"
        + (f"，较场均基线 {elo_verdict}" if final_label == full_label else "（Elo 增量不显著）")
    )
    print(f"决策：{decision}")

    # 2b) 分联赛表现：中超自己准不准、五大联赛有没有被拖累
    by_league = aggregate_by_league(chosen_folds)
    print("\n分联赛 pooled 指标（最终方案）：")
    header2 = f"  {'联赛':<8}{'场次':>7}{'ll':>10}{'MAE':>9}{'Brier':>9}{'acc':>8}"
    print(header2)
    print("  " + "-" * (len(header2) - 2))
    for code, item in by_league.items():
        print(
            f"  {LEAGUE_NAMES.get(code, code):<8}{item['n']:>7}{item['wdlLogLoss']:>10.5f}"
            f"{item['lambdaMAE']:>9.4f}{item['brier']:>9.5f}{item['accuracy']:>8.3f}"
        )

    # 3) 生产模型：用全部历史训练（评估已由 walk-forward 完成，
    #    部署时不该再丢一个赛季的信息）
    print("\n训练生产模型（全部赛季，尾部 15% 仅用于 early stopping）：")
    elo_cfg, elo_ll = tune_elo(all_matches)
    print(
        f"  Elo: K={elo_cfg.k:g} 主场加成={elo_cfg.home_advantage:g} "
        f"初始分={elo_cfg.initial:g} -> logloss={elo_ll:.5f}"
    )
    rows_all = build_training_rows(data_paths, elo_cfg)
    cols = ALL_COLS if final_label == full_label else BASE_COLS
    split = int(len(rows_all) * (1 - VALID_RATIO))
    fit_rows, valid_rows = rows_all[:split], rows_all[split:]
    models = fit_pair(
        matrix(fit_rows, cols), *targets(fit_rows),
        matrix(valid_rows, cols), *targets(valid_rows),
        verbose=True,
    )

    def lam_all(subset: List[Dict[str, object]]) -> np.ndarray:
        X = matrix(subset, cols)
        return np.column_stack([models["home"].predict(X), models["away"].predict(X)])

    rho = fit_rho(lam_all(rows_all), np.column_stack(targets(rows_all)))
    print(f"  rho={rho}")

    os.makedirs(MODEL_DIR, exist_ok=True)
    models["home"].get_booster().save_model(HOME_MODEL_PATH)  # type: ignore[union-attr]
    models["away"].get_booster().save_model(AWAY_MODEL_PATH)  # type: ignore[union-attr]

    snapshot = build_snapshot(data_paths, elo_cfg)
    snapshot_payload = snapshot.to_json()
    # 推理端靠这个日期判断哪些比赛还没进快照，从而只做增量观察、不重复累加
    snapshot_payload["lastMatchDate"] = max(m["date"] for m in all_matches).strftime("%Y-%m-%d")  # type: ignore[arg-type]
    # 重训后快照直接来自训练数据，没有增量记录，observeLog 留空
    snapshot_payload["updatedAt"] = datetime.now(timezone.utc).isoformat()
    with open(FORM_PATH, "w", encoding="utf-8") as fh:
        json.dump(snapshot_payload, fh, ensure_ascii=False, indent=1)
    print(f"  快照覆盖到 {snapshot_payload['lastMatchDate']}")

    active_names = [FEATURE_NAMES[i] for i in cols]
    importance = {
        name: round(float(v), 4)
        for name, v in zip(active_names, models["home"].feature_importances_)  # type: ignore[union-attr]
    }
    importance_away = {
        name: round(float(v), 4)
        for name, v in zip(active_names, models["away"].feature_importances_)  # type: ignore[union-attr]
    }
    elo_names = FEATURE_NAMES[FORM_FEATURE_COUNT:]
    importance_groups = {
        "venue": round(sum(importance.get(n, 0.0) for n in FEATURE_NAMES[:FORM_FEATURE_COUNT]), 4),
        "elo": round(sum(importance.get(n, 0.0) for n in elo_names), 4),
    }

    meta = {
        "model": "XGBoost (count:poisson) + Dixon-Coles",
        "objective": "count:poisson",
        "features": active_names,
        "featureLabels": {k: FEATURE_LABELS[k] for k in active_names},
        "leagues": leagues,
        "byLeague": by_league,
        "elo": {
            **elo_cfg.to_json(),
            "tuningLogLoss": round(elo_ll, 5),
            "featureImportanceTotal": importance_groups["elo"],
            "ratingRange": {
                "min": round(min(snapshot.elo.values()), 1) if snapshot.elo else elo_cfg.initial,
                "max": round(max(snapshot.elo.values()), 1) if snapshot.elo else elo_cfg.initial,
            },
            "topTeams": [
                {"team": team, "elo": round(rating, 1)}
                for team, rating in sorted(snapshot.elo.items(), key=lambda kv: -kv[1])[:8]
            ],
        },
        "rho": rho,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "trainMatches": len(rows_all),
        "testMatches": int(chosen_agg["n"]),  # walk-forward 的样本外场次合计
        "testSeason": FOLD_SEASONS[-1],
        "seasons": seasons,
        "homeBestIteration": int(getattr(models["home"], "best_iteration", 0) or 0),  # type: ignore[union-attr]
        "awayBestIteration": int(getattr(models["away"], "best_iteration", 0) or 0),  # type: ignore[union-attr]
        "featureImportanceHome": importance,
        "featureImportanceAway": importance_away,
        "featureImportanceGroups": importance_groups,
        "evaluation": {
            "scheme": "walk-forward",
            "description": "按联赛分别做日期截断：每折训练集只取该联赛测试集起点之前的比赛",
            "folds": FOLD_SEASONS,
            "primaryMetric": "wdlLogLoss（按场次加权 pooled）",
            "decision": decision,
            "eloDelta": {"mean": round(delta, 5), "stderr": round(delta_se, 5) if math.isfinite(delta_se) else None},
            "featureSetComparison": [
                {
                    "scheme": label,
                    "pooledLogLoss": agg["wdlLogLoss"],
                    "foldLogLoss": agg["foldLogLoss"],
                    "stderr": agg.get("stderr"),
                    "brier": agg["brier"],
                    "accuracy": agg["accuracy"],
                    "lambdaMAE": agg["lambdaMAE"],
                    "poissonDeviance": agg["poissonDeviance"],
                }
                for label, agg in aggs.items()
            ],
            "foldDetail": chosen_folds,
            "byLeague": by_league,
        },
        "metrics": {
            "xgboost": {k: v for k, v in chosen_agg.items() if k != "foldLogLoss"},
            "baselineNoElo": aggs[base_label],
        },
    }
    with open(META_PATH, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)

    print(f"\n已保存：{HOME_MODEL_PATH}\n        {AWAY_MODEL_PATH}\n        {META_PATH}\n        {FORM_PATH}")
    print("特征重要度（主队进球模型）:")
    for name, value in sorted(importance.items(), key=lambda kv: -kv[1]):
        print(f"  {name:<12} {FEATURE_LABELS[name]:<14} {value:.3f}")
    print(f"分组重要度：{importance_groups}")


if __name__ == "__main__":
    main()
