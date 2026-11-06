import json
import os
import pathlib
import sys
import urllib.error
import urllib.request


def main():
    request = json.load(sys.stdin)
    token = request.get("token", "")
    if not token:
        env_path = pathlib.Path(os.path.expanduser(request.get("env_path") or "~/grokbot-phase1/deploy/.env"))
        try:
            for line in env_path.read_text().splitlines():
                key, sep, value = line.strip().partition("=")
                if sep and key.strip() == "AGENT_ACCESS_TOKEN":
                    token = value.strip().strip("\"'")
                    break
        except OSError:
            pass
    if not token:
        return {"status": 503, "body": {"detail": "SSH 已登录，但未找到云端服务令牌。请在高级设置指定服务配置文件或填写令牌。"}}
    path = request["path"]
    if not path.startswith("/") or path.startswith("//") or "?" in path or "#" in path:
        return {"status": 400, "body": {"detail": "无效的服务路径"}}
    data = request.get("body")
    req = urllib.request.Request(
        f"http://127.0.0.1:{int(request['port'])}{path}",
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method=request.get("method", "GET"),
    )
    # Loopback requests must not use a server-side HTTP proxy or follow redirects.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(req, timeout=100) as response:
            return {"status": response.status, "body": json.load(response)}
    except urllib.error.HTTPError as error:
        try:
            body = json.load(error)
        except (ValueError, UnicodeError):
            body = {"detail": "云端服务返回无效内容"}
        return {"status": error.code, "body": body}
    except (OSError, ValueError):
        return {"status": 503, "body": {"detail": "SSH 已登录，但 Bot 服务未就绪；请检查服务状态和高级设置中的 API 端口。"}}


if __name__ == "__main__":
    try:
        result = main()
    except Exception:
        result = {"status": 503, "body": {"detail": "无法检查云端 Bot 服务"}}
    print(json.dumps(result, ensure_ascii=True))
