"""Original note/browser experiment. Not mounted in the phase-one API.

Tool authorization and audit are required before any future exposure to Bots.
"""

from pathlib import Path
from urllib.parse import urlparse


async def run_test_tool(kind: str, value: str, workspace: Path) -> str:
    workspace.mkdir(parents=True, exist_ok=True)
    if kind == "note":
        with (workspace / "notes.txt").open("a", encoding="utf-8") as file:
            file.write(value.replace("\r", " ").replace("\n", " ") + "\n")
        return "已保存到云端工作目录"
    if kind == "read_notes":
        notes = workspace / "notes.txt"
        return notes.read_text(encoding="utf-8") if notes.exists() else "暂无笔记"
    if kind == "browse":
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("Invalid URL")
        from playwright.async_api import async_playwright
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            try:
                page = await browser.new_page()
                await page.goto(value, wait_until="domcontentloaded", timeout=20000)
                return f"网页标题：{await page.title()}\n最终地址：{page.url}"
            finally:
                await browser.close()
    raise ValueError("Unsupported test tool")
