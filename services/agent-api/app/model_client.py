"""Server-side model transport. Never return upstream bodies or credentials."""
import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException


def generate_reply(config, bot, history, content: str, encryption_key: str) -> str:
    try:
        api_key = Fernet(encryption_key.encode()).decrypt(config.encrypted_api_key.encode()).decode()
    except (ValueError, TypeError, InvalidToken, UnicodeError):
        raise HTTPException(status_code=503, detail="模型密钥无法解密，请重新保存配置") from None
    system = f"你是{bot.name}，职责是{bot.role}。\n{bot.description}"
    messages = [{"role": m.sender, "content": m.content} for m in history
                if m.sender in ("user", "assistant")]
    messages.append({"role": "user", "content": content})
    payload = {"model": bot.model_name or config.model_name, "messages": messages, "stream": False}
    base = config.base_url.rstrip("/")
    if config.provider == "Anthropic":
        url = base + ("/messages" if base.endswith("/v1") else "/v1/messages")
        headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
        payload.update(system=system, max_tokens=4096)
    else:
        url = base + "/chat/completions"
        headers = {"Authorization": f"Bearer {api_key}"}
        messages.insert(0, {"role": "system", "content": system})
    try:
        with httpx.Client(timeout=httpx.Timeout(90, connect=10), follow_redirects=False) as client:
            response = client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        if config.provider == "Anthropic":
            reply = "\n".join(block["text"] for block in data["content"] if block.get("type") == "text")
        else:
            reply = data["choices"][0]["message"]["content"]
        if not isinstance(reply, str) or not reply.strip():
            raise ValueError("empty reply")
        return reply
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="模型响应超时，请重试") from None
    except httpx.HTTPStatusError as error:
        status = error.response.status_code
        detail = "模型认证失败，请检查 API Key" if status in (401, 403) else "模型请求受限，请稍后重试" if status == 429 else f"模型服务返回错误（HTTP {status}）"
        raise HTTPException(status_code=502, detail=detail) from None
    except (httpx.RequestError, ValueError, KeyError, IndexError, TypeError):
        raise HTTPException(status_code=502, detail="模型连接失败或返回内容无效，请检查配置") from None
