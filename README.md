# 足球赛事实时预测

基于 XGBoost 的足球比分/胜平负预测应用。Next.js 前端负责赛事展示，独立的 Python 服务负责建模与推理。

## 它做什么

- 展示英超、西甲、中超的赛程、实时比分、积分榜与比赛详情（数据来自 ESPN 公开接口）
- 对每场比赛给出**胜/平/负概率**、**预期进球（λ）** 与**比分概率矩阵**
- 比赛进行中按当前分钟数和比分实时折算剩余时间
- 已完赛的结果会自动并入球队状态，后续比赛的预测随之滚动更新

## 架构

```
浏览器
  └─ Next.js (3000)
       ├─ /api/espn/*      → ESPN 公开接口（赛程 / 比分 / 积分榜 / 详情）
       └─ /api/espn/predict → Python 预测服务 (8001)
                                ├─ XGBoost count:poisson ×2（主队 λ / 客队 λ）
                                ├─ Dixon-Coles 低比分修正 → 比分矩阵
                                └─ 整点任务：拉取完赛结果并入球队状态
```

## 快速开始

需要两个进程。

**1. Python 预测服务**（依赖 xgboost / fastapi，建议 Python 3.10）

```bash
cd python
pip install -r requirements.txt
python soccer_predictor_api.py        # 127.0.0.1:8001
```

**2. 前端**

```bash
npm install
npm run dev                           # 127.0.0.1:3000
```

`python/models/` 里已包含训练好的模型和球队状态快照，无需先训练即可启动。

## 免费部署

不花钱、不绑卡的两段式部署：

| 部分 | 平台 | 免费额度 |
|---|---|---|
| Python 预测服务 | [Wispbyte](https://wispbyte.com) | 512MB 内存 / 1GB 存储 / 24 小时常驻 |
| Next.js 前端 | [Vercel](https://vercel.com) | Hobby 计划 |

服务实测常驻 270MB，所以 Wispbyte 只承载后端，前端交给 Vercel。
完整步骤（建服务器 → 传代码 → 改启动命令 → 配环境变量）见
[`deploy/wispbyte/README.md`](deploy/wispbyte/README.md)。

前端只需两个环境变量指向后端：

```
PYTHON_PREDICTOR_URL=http://<wispbyte-地址>/predict/soccer
PYTHON_OBSERVE_URL=http://<wispbyte-地址>/observe
```

## 模型

### 特征（11 维）

| 组 | 特征 |
|---|---|
| 主队场地战绩 | 主场场均进球 / 失球、客场场均进球 / 失球 |
| 客队场地战绩 | 同上 4 项 |
| Elo | 主队评分、客队评分、分差 |

`elo_diff` 是最强单特征（重要度 0.275）。Elo 采用 World Football Elo 规则：K=32、主场加成 65、净胜球系数 1 / 1.5 / (11+净胜球)/8，初始 1500，赛前取值、赛后更新，因此不存在信息泄漏。

场均进失球样本不足时逐级回退：该场地 → 该队两场地合并 → 该联赛同场地 → 该联赛合并 → 全库 → 常量。

### 从 λ 到比分

主客队各训练一个 `count:poisson` 目标函数，输出即为两队预期进球 λ；再用 λ 构造比分分布矩阵，叠加 Dixon-Coles 低比分修正（ρ ≈ -0.030）拉正 0-0 / 1-1 等低比分的概率。

### 评估

walk-forward 三折（逐折用该折之前的数据训练，只用该折数据评估），三折样本外合计 5342 场，按场次加权汇总：

| 指标 | 值 |
|---|---|
| 胜平负 logloss | 0.99992 |
| Brier | 0.59694 |
| MAE（总进球） | 0.9196 |
| 准确率（胜平负取最大） | 0.518 |
| 比分 logloss | 2.947 |
| Elo 相对场均基线的增益 | −0.00839 ± 0.00222（显著） |

中超自身的 logloss 为 0.97389、准确率 0.542，是各联赛中最好预测的。

## 状态自动更新

模型权重是静态的，但喂进模型的特征不是。服务启动后会在每个整点拉取 ESPN 最近几天的完赛结果，把比分并入球队的场均进失球与 Elo 并写回快照 —— 只更新特征，不重训模型。

- 起点取 `max(今天-7天, 上次水位-1天)`，服务停机几天后会自动补齐空档
- 按 `eventId` 全局去重，重复拉取安全
- `POST /observe/refresh` 可手动立刻拉一轮
- `GET /health` 的 `autoObserve` 字段可查看调度状态
- `AUTO_OBSERVE=0` 关闭该任务

## 目录结构

```
python/
  soccer_predictor_api.py   FastAPI 服务（/predict/soccer、/observe、/health）
  auto_observe.py           整点自动更新与调度
  xgb_predictor.py          推理与快照持久化
  features.py               特征工程、Elo、快照结构
  scoring.py                Dixon-Coles 比分矩阵
  team_names.py             ESPN 队名归一化
  train_xgboost.py          训练与 walk-forward 评估
  fetch_csl.py              中超历史数据抓取
  data/                     训练数据（五大联赛 + 中超）
  models/                   模型与球队状态快照
src/
  app/api/espn/             赛程、比分、积分榜、预测等接口
  lib/espn-service.ts       ESPN 数据获取与规整
  components/               页面组件
```

## 数据来源

赛程与比分来自 ESPN 公开接口；历史训练数据来自 football-data.co.uk（五大联赛）与 ESPN（中超）。仅供学习与研究使用。
