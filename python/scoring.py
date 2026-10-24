"""比分概率矩阵：把「主客队期望进球 λ」转换成比分分布、胜平负概率。

这里只有数学，没有任何模型参数：λ 由 XGBoost 推理（xgb_predictor.py）给出，
本模块只负责把 λ 换算成比分分布、胜平负概率与比分热力图。

低比分修正（Dixon & Coles 1997）只改四个格子：
    tau(0,0)=1-lh*la*rho   tau(1,1)=1-rho
    tau(1,0)=1+la*rho      tau(0,1)=1+lh*rho    其余为 1
"""

from __future__ import annotations

import math
from typing import Dict

import numpy as np

MAX_GOALS = 10  # 比分矩阵 0..10，最后一行/列表示 10+
TRUNC_GOALS = 14  # 内部截断，更长的尾巴并入最后一格

_LOG_FACT = np.array([math.lgamma(i + 1.0) for i in range(TRUNC_GOALS + 1)])


def poisson_pmf(lam: float, n: int = TRUNC_GOALS) -> np.ndarray:
    lam = max(float(lam), 1e-9)
    k = np.arange(n + 1, dtype=np.float64)
    return np.exp(-lam + k * math.log(lam) - _LOG_FACT[: n + 1])


def dixon_coles_tau(x: int, y: int, lam: float, mu: float, rho: float) -> float:
    if rho == 0.0:
        return 1.0
    if x == 0 and y == 0:
        return 1.0 - lam * mu * rho
    if x == 0 and y == 1:
        return 1.0 + lam * rho
    if x == 1 and y == 0:
        return 1.0 + mu * rho
    if x == 1 and y == 1:
        return 1.0 - rho
    return 1.0


def safe_rho(rho: float, lam_h: float, lam_a: float) -> float:
    """夹到所有 tau > 0 的区间，避免负概率。"""
    lam_h = max(lam_h, 1e-6)
    lam_a = max(lam_a, 1e-6)
    lo = max(-0.95 / lam_h, -0.95 / lam_a)
    hi = min(0.95 / (lam_h * lam_a), 0.95)
    return float(np.clip(rho, lo, hi)) if lo <= hi else 0.0


def score_matrix(
    lam_h: float,
    lam_a: float,
    rho: float = 0.0,
    max_goals: int = MAX_GOALS,
    off_h: int = 0,
    off_a: int = 0,
) -> np.ndarray:
    """比分概率矩阵；off_h/off_a 为赛中已进球数。"""
    r = safe_rho(rho, lam_h, lam_a)
    pmf_h = poisson_pmf(lam_h)
    pmf_a = poisson_pmf(lam_a)
    grid = np.zeros((max_goals + 1, max_goals + 1))

    for i in range(TRUNC_GOALS + 1):
        if pmf_h[i] <= 0.0:
            continue
        tau0 = dixon_coles_tau(i, 0, lam_h, lam_a, r)
        tau1 = dixon_coles_tau(i, 1, lam_h, lam_a, r)
        for j in range(TRUNC_GOALS + 1):
            tau = tau0 if j == 0 else tau1 if j == 1 else 1.0
            gi = min(max_goals, i + off_h)
            gj = min(max_goals, j + off_a)
            grid[gi, gj] += pmf_h[i] * pmf_a[j] * tau

    total = float(grid.sum())
    return grid / total if total > 0 else grid


def outcome_probs(grid: np.ndarray) -> Dict[str, float]:
    idx = np.arange(grid.shape[0])
    return {
        "win": float(grid[np.greater.outer(idx, idx)].sum()),
        "draw": float(np.trace(grid)),
        "loss": float(grid[np.less.outer(idx, idx)].sum()),
    }


def matrix_payload(grid: np.ndarray) -> Dict[str, object]:
    n = grid.shape[0]
    matrix = [[round(float(grid[i, j]) * 100.0, 1) for j in range(n)] for i in range(n)]
    top = []
    for i in range(n):
        for j in range(n):
            li = f"{i}+" if i == n - 1 else str(i)
            lj = f"{j}+" if j == n - 1 else str(j)
            top.append({"score": f"{li}:{lj}", "prob": matrix[i][j]})
    top.sort(key=lambda x: x["prob"], reverse=True)
    return {"maxGoals": n - 1, "matrix": matrix, "topScores": top[:5]}
