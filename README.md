# GrokBot Personal

个人 Windows 多 Bot 平台。仓库采用 Monorepo：`apps/desktop` 是 Tauri 2 + React/TypeScript 客户端；`services/agent-api` 是 FastAPI 后端；`deploy` 是容器配置。

## 第一阶段状态

- 已实现：Bot 创建与查询、消息存储与查询、模型回复与最近 40 条消息上下文、待办任务创建与查询、PostgreSQL 数据模型、访问令牌校验、桌面端三栏界面、SSH 隧道连接、全局模型 API Key 加密存储、GitHub Actions 基础 CI。
- 已配置待发布：Tauri 签名自动更新与手动触发的 Windows Release 工作流。首次发布和客户端实际更新尚未验证。
- 待实现：多 Bot 通信、任务执行器、记忆、云端屏幕、本机操作。
- 原型中的笔记和浏览器测试代码保留在 `app/prototype_tools.py`，未接入第一阶段 API。

## 本地运行

1. 复制 `deploy/.env.example` 为 `deploy/.env`，填写服务令牌、数据库密码和 Fernet 加密密钥。可用 `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` 生成密钥；不要提交 `.env`。密钥丢失后已保存的模型 API Key 无法解密。
2. 在 `deploy` 目录运行 `docker compose -f compose.dev.yaml up -d --build`。API 仅监听本机 `127.0.0.1:8000`。
3. 在 `apps/desktop` 目录运行 `npm ci` 和 `npm run tauri dev`。需要先安装 [Tauri 2 Windows 前置依赖](https://v2.tauri.app/start/prerequisites/)；只查看界面也可运行 `npm run dev`。
4. Windows 桌面端默认使用 SSH：填写本机 `~/.ssh/config` 中的主机别名、远程 API 端口与 `AGENT_ACCESS_TOKEN`。应用通过本机端口 18001 连接服务器；SSH 需预先配置密钥及已信任的主机。网页开发预览可选直接连接。访问令牌仅保留在本次应用会话中。

连接成功后可在设置中填写模型 Provider、HTTPS Base URL、模型名称和 API Key。Key 加密保存在服务端 PostgreSQL；界面和 GET API 只返回“已配置”状态。没有单独指定模型的 Bot 显示全局模型名称。发送消息后通过 `/bots/{bot_id}/chat` 调用模型，成功后同时保存用户消息和 Bot 回复；失败不会写入该轮消息，输入保留可重试。支持 Chat Completions 兼容接口及 Anthropic Messages；Bot 默认继承全局模型，单独指定模型名称时沿用全局服务商和密钥。Base URL 应填写 API 根地址（兼容接口通常以 `/v1` 结尾），不要包含 `/chat/completions`。

协议参考：[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)。本地测试使用模拟模型服务，真实 Token 连通性与桌面端端到端聊天待验证。

Windows Release 仅由 GitHub Actions 的 `Release Windows` 手动工作流触发；成功后公开的 GitHub Release 提供安装包及签名更新文件。安装过支持更新的客户端后，新版本在启动时自动检查并安装。现有 0.2.0 安装包没有更新器，升级到首个带更新器的版本仍需手动安装一次。

运行测试：在 `services/agent-api` 安装 `requirements.txt`、`httpx`、`pytest` 后执行 `python -m pytest tests -q`。CI 使用独立 PostgreSQL 服务运行同一套 API 测试，并构建 Windows 客户端与 Linux 后端镜像。

架构和后续任务见 [docs/architecture.md](docs/architecture.md) 与 [docs/roadmap.md](docs/roadmap.md)。
