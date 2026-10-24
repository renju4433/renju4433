# 免费部署：Wispbyte（后端）+ Vercel（前端）

整套方案不花钱、不需要信用卡。

- **后端**：Wispbyte 免费容器（512MB 内存 / 1GB 存储 / 单端口 / 24 小时常驻，无需绑卡）
- **前端**：Vercel 免费版（直接读 GitHub 仓库，免卡）

## 为什么必须拆成两个平台

实测模型服务常驻内存 **270MB**（fastapi 50MB + xgboost 与模型 220MB），Wispbyte 免费层只有 512MB。
再塞一个 Next.js 生产进程（约 130–180MB）会顶到 500MB 附近，SSR 渲染峰值就被 OOM 杀掉。
所以 Wispbyte 只放 Python，前端交给 Vercel。

## 一、部署后端到 Wispbyte

### 1. 建服务器

1. 打开 https://wispbyte.com ，用 GitHub 登录（或邮箱注册并验证）
2. 左侧 **Create Server**
3. Server Name 随便填，Server Type 选 **Free Plan**
4. Technology 选 **Python**（镜像固定几种，不支持自定义 Dockerfile）
5. Create Server

### 2. 上传代码

进入服务器的 **Files** 面板。两种方式任选：

**方式 A：上传 zip（推荐）**

```bash
# 本地项目根目录执行，生成 deploy/wispbyte/wispbyte-backend.zip
python deploy/wispbyte/pack.py
```

把 zip 上传到面板根目录，然后右键 / 点 **Unarchive** 解压。
解压后根目录应该直接看到 `soccer_predictor_api.py`、`start.sh`、`models/`、`data/`。

**方式 B：Console 一条命令（代码取自 GitHub）**

在面板 **Console** 里粘贴：

```bash
curl -fsSL https://raw.githubusercontent.com/renju4433/renju4433/main/deploy/wispbyte/bootstrap.sh | bash
```

两者区别：方式 B 每次执行都会用仓库里的 `models/team_form.json` 覆盖快照，
也就是把增量累积的 Elo/场均数据重置回仓库版本。日常建议用方式 A 只做首次上传。

### 3. 改启动命令

**Startup** → 把默认命令整段删掉，改成：

```
bash start.sh
```

保存。`start.sh` 会自己做三件事：找到 python 解释器 → 按
`requirements-prod.txt` 装依赖（装过就跳过，靠 md5 标记判断）→ 启动服务并以
`0.0.0.0:$PORT` 监听。

### 4. 启动并取地址

点 **Start**，首次要装 300MB 左右的依赖（xgboost 139M + scipy 117M + numpy 32M），
约 1–2 分钟；之后重启只跳过安装，几秒起。

面板上会显示分配到的主机/端口（形如 `http://xxx.wispbyte.com` 或 `http://IP:端口`）。
**把这个地址记下来**，下一步要用。

> 后端是 http 也没关系：预测请求由 Vercel 的服务端函数发起，不是浏览器直连，
> 不存在混合内容拦截问题。

### 5. 验证

```bash
curl http://<你的后端地址>/health
```

应返回 `status: ok`、`teams: 149`，并且 `autoObserve.nextRunAt` 指向下一个整点。

## 二、部署前端到 Vercel

1. https://vercel.com 用 GitHub 登录（免费版即可，不绑卡）
2. **Add New → Project** → 选中 `renju4433/renju4433` 仓库 → Import
3. Framework Preset 会自动识别成 Next.js，Build Command 保持默认
4. 展开 **Environment Variables**，加两条（Production / Preview 都勾上）：

| Name | Value |
|---|---|
| `PYTHON_PREDICTOR_URL` | `http://<你的后端地址>/predict/soccer` |
| `PYTHON_OBSERVE_URL` | `http://<你的后端地址>/observe` |

5. **Deploy**，等 1–2 分钟

部署完成后打开 Vercel 给的域名，赛程、积分、预测都应该正常。

## 环境变量

| 变量 | 作用 | 默认值 |
|---|---|---|
| `PYTHON_PREDICTOR_URL` | 前端调用预测接口的地址 | `http://127.0.0.1:8001/predict/soccer` |
| `PYTHON_OBSERVE_URL` | 前端推送完赛结果的地址 | `http://127.0.0.1:8001/observe` |
| `PORT` / `SERVER_PORT` | 后端监听端口（面板注入，不用手动设） | 8001 |
| `AUTO_OBSERVE` | 设为 `0` 关闭整点自动更新 | 开启 |

## 需要知道的限制

- **免费容器每月要在面板登录一次**，否则会被归档（归档不是删除，下次登录即恢复）
- **只暴露一个端口**，所以后端只能单独占用这个容器，不能顺带跑前端
- **1GB 存储**：依赖约 300MB + 代码 1.2MB，够用，但别在容器里囤数据
- **整点自动更新的数据存在容器卷里**，重启不丢；但如果重跑方式 B 的 bootstrap，
  快照会被仓库版本覆盖（增量累积的 Elo 会回到训练态）
- 容器里跑 `train_xgboost.py` 重训不现实（内存不够），重训请在本机做，再把
  `python/models/*.json` 推到仓库

## 本地仍然可以照旧跑

```bash
cd python && python soccer_predictor_api.py   # 127.0.0.1:8001
npm run dev                                    # localhost:3000
```

`start.sh` 和 `requirements-prod.txt` 只在容器里用，不影响本地。
