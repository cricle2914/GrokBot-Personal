# GrokBot Personal

个人 Windows 多 Bot 平台。仓库采用 Monorepo：`apps/desktop` 是 Tauri 2 + React/TypeScript 客户端；`services/agent-api` 是 FastAPI 后端；`deploy` 是容器配置。

## 第一阶段状态

- 已实现：Bot 创建与查询、用户消息存储与查询、待办任务创建与查询、PostgreSQL 数据模型、访问令牌校验、桌面端三栏界面、GitHub Actions 基础 CI。
- 待实现：模型推理、Bot 自动回复、多 Bot 通信、任务执行器、记忆、云端屏幕、本机操作、自动更新。
- 原型中的笔记和浏览器测试代码保留在 `app/prototype_tools.py`，未接入第一阶段 API。

## 本地运行

1. 复制 `deploy/.env.example` 为 `deploy/.env`，替换两个测试用值。密码使用字母数字，避免连接 URL 转义问题。不要提交 `.env`。
2. 在 `deploy` 目录运行 `docker compose -f compose.dev.yaml up -d --build`。API 仅监听本机 `127.0.0.1:8000`。
3. 在 `apps/desktop` 目录运行 `npm ci` 和 `npm run tauri dev`。需要先安装 [Tauri 2 Windows 前置依赖](https://v2.tauri.app/start/prerequisites/)；只查看界面也可运行 `npm run dev`。
4. 在桌面端设置中填写服务地址和 `AGENT_ACCESS_TOKEN`。访问令牌仅保留在本次应用会话中。

运行测试：在 `services/agent-api` 安装 `requirements.txt`、`httpx`、`pytest` 后执行 `python -m pytest tests -q`。CI 使用独立 PostgreSQL 服务运行同一套 API 测试，并构建 Windows 客户端与 Linux 后端镜像。

架构和后续任务见 [docs/architecture.md](docs/architecture.md) 与 [docs/roadmap.md](docs/roadmap.md)。
