import os
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="GrokBot Personal Agent API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "http://tauri.localhost", "tauri://localhost"],
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

WORKSPACE = Path(os.getenv("AGENT_WORKSPACE", "/data/workspace"))
ACCESS_TOKEN = os.getenv("AGENT_ACCESS_TOKEN", "")


def authorize(authorization: str | None = Header(default=None)) -> None:
    if not ACCESS_TOKEN:
        raise HTTPException(status_code=503, detail="AGENT_ACCESS_TOKEN is not configured")
    if authorization != f"Bearer {ACCESS_TOKEN}":
        raise HTTPException(status_code=401, detail="Invalid access token")


class TaskRequest(BaseModel):
    kind: str
    value: str = Field(min_length=1, max_length=2048)


@app.get("/health", dependencies=[Depends(authorize)])
def health() -> dict:
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    return {"status": "online", "workspace": str(WORKSPACE)}


@app.post("/tasks", dependencies=[Depends(authorize)])
async def run_task(task: TaskRequest) -> dict:
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    if task.kind == "note":
        notes = WORKSPACE / "notes.txt"
        with notes.open("a", encoding="utf-8") as file:
            file.write(task.value.replace("\r", " ").replace("\n", " ") + "\n")
        return {"kind": "note", "result": "已保存到云端工作目录的 notes.txt"}
    if task.kind == "read_notes":
        notes = WORKSPACE / "notes.txt"
        return {"kind": "read_notes", "result": notes.read_text(encoding="utf-8") if notes.exists() else "暂无笔记"}
    if task.kind == "browse":
        parsed = urlparse(task.value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise HTTPException(status_code=400, detail="请输入有效的 http(s) URL")
        from playwright.async_api import async_playwright

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            try:
                page = await browser.new_page()
                await page.goto(task.value, wait_until="domcontentloaded", timeout=20000)
                title = await page.title()
                return {"kind": "browse", "result": f"网页标题：{title}\n最终地址：{page.url}"}
            finally:
                await browser.close()
    raise HTTPException(status_code=400, detail="不支持的任务类型")
