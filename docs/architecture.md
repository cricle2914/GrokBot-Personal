# 架构与边界

## 第一阶段实现

```text
Windows 客户端 (Tauri + React)
    │  SSH 隧道 + HTTP + 服务访问令牌
    ▼
FastAPI ─── PostgreSQL
    │          └─ Bot / Message / Task / 加密的全局模型配置
    └─ 原型工具（默认关闭）
```

桌面端提供 Bot 列表、会话、任务和详情视图。第一阶段的“发送消息”只把用户消息写入 PostgreSQL；没有模型调用或 Bot 自动回复。任务记录创建后为 `pending`，尚无执行器。云端屏幕和资料库界面明确标为未接入。

部署配置使用独立的 PostgreSQL 容器及 Docker volume。API 默认只绑定主机回环地址。现有服务器上的其他数据库容器不属于本项目的持久化层，也不被本项目迁移或删除。

## 后续目标架构（尚未实现）

```text
Windows 客户端
    │
FastAPI / 鉴权
    ├─ Bot Registry / 权限
    ├─ Message Bus / 群聊 / 能力发现
    ├─ Task Scheduler / 恢复 / Watchdog
    ├─ Provider Adapters / 模型 API
    └─ Tool Runtime / 审计 / 人工审批
             ├─ Bot 独立工作目录
             ├─ Playwright + Xvfb（按需）
             └─ 临时隔离容器（高风险任务）
    │
PostgreSQL：Bot、会话、消息、任务、记忆与持久任务队列
```

Bot 是逻辑身份，不对应 Linux 用户或常驻容器。多个 Bot 共享服务器；每个 Bot 的记忆、会话、工作目录和权限独立。Bot 可直接互相通信，Primary Bot 仅是默认入口。计划限制初期并发 Agent 为 2、图形浏览器为 1，配置可调整；当前阶段不运行这些组件。

后续消息与任务协议需包含唯一 ID、幂等处理、关联关系、循环检测、最大委派深度、超时、限额和跨 Bot 权限检查。模型输出只能提出工具调用请求，不能绕过权限与审批。Shell、文件、浏览器和临时容器工具都要记录审计事件；Agent 不使用宿主机 root，不挂载整个宿主机文件系统，也不接触 Docker Socket。

模型 Provider Adapter 与自动回复尚未实现。当前可保存全局 Provider、HTTPS Base URL、模型名称和加密 API Key；未单独设置模型的 Bot 继承全局配置。模型密钥只在保存时传入，不由读取 API 返回。

## 发布规则

Push/PR 只执行测试与构建检查。Windows Release 由手动触发的独立工作流创建公开的 GitHub Release、签名安装包与 `latest.json`。客户端从公开的 GitHub Release 检查更新。首次发布及真实客户端更新仍待验证。云端服务不会由测试通过自动部署。
