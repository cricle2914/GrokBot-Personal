# GrokBot-Personal

个人 Windows AI Agent 桌面应用。桌面端使用 Tauri + React/TypeScript，云端服务使用 Python/FastAPI，CI 使用 GitHub Actions。规划使用 Tauri 自动更新，模型通过用户配置的 API Token 接入，执行环境是用户自己的云服务器。

## 最小验证版

当前可验证连接、在云端持久保存笔记，以及在云端浏览器打开网页并返回标题。当前没有模型接入、通用 Agent、电脑控制或自动更新；这些不属于本次最小验证范围。

### 本地试运行

在 `services/agent-api` 下设置 `AGENT_ACCESS_TOKEN` 和 `AGENT_WORKSPACE`，安装 `requirements.txt`，执行 `python -m playwright install chromium`，再运行 `uvicorn app.main:app --host 127.0.0.1 --port 8000`。访问令牌请自行生成，不要提交到仓库。

在 `apps/desktop` 下运行 `npm ci`、`npm run dev`，浏览器打开 `http://127.0.0.1:1420`。安装 Rust 与 Tauri 的 Windows 依赖后，可运行 `npm run tauri dev`。私有仓库的 GitHub Actions 会尝试构建 Windows 安装包并运行后端测试。

### 云服务器

`deploy/compose.yaml` 预留了容器部署配置，工作目录使用 Docker volume 持久化。API 只绑定服务器本机的 `127.0.0.1:8000`；远程访问需要另行配置 HTTPS 入口和认证，不能直接暴露这个端口。

仓库内不保存真实密钥、服务器地址或凭据。
