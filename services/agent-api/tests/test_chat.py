import json
import httpx
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app import model_client

HEADERS = {"Authorization": "Bearer test-token"}


@pytest.mark.parametrize("provider", ["OpenAI-compatible", "Anthropic"])
def test_chat_context_isolation_and_failure(monkeypatch, provider):
    real_client = httpx.Client
    requests = []
    mode = {"value": "ok"}

    def handle(request):
        requests.append(request)
        if mode["value"] == "timeout":
            raise httpx.ReadTimeout("secret-upstream-body", request=request)
        if mode["value"] == "auth":
            return httpx.Response(401, text="secret-test-key")
        if mode["value"] == "empty":
            return httpx.Response(200, json={"choices": []})
        return httpx.Response(200, json={"choices": [{"message": {"content": "你好，我记住了"}}],
                                          "content": [{"type": "text", "text": "你好，我记住了"}]})

    with TestClient(app) as client:
        client.put("/model-config", headers=HEADERS, json={"provider": provider,
                   "base_url": "https://model.example/v1", "model_name": "test-model", "api_key": "secret-test-key"})
        bot = client.post("/bots", headers=HEADERS, json={"name": "小助手", "role": "研究"}).json()["id"]
        other = client.post("/bots", headers=HEADERS, json={"name": "其他"}).json()["id"]
        client.post(f"/bots/{other}/messages", headers=HEADERS, json={"content": "隔离数据"})
        monkeypatch.setattr(model_client.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(handle), **kw))
        path = f"/bots/{bot}/chat"
        assert client.post(path, json={"content": "你好"}).status_code == 401
        first = client.post(path, headers=HEADERS, json={"content": "你好"})
        assert first.status_code == 201
        assert [m["sender"] for m in first.json()] == ["user", "assistant"]
        assert client.post(path, headers=HEADERS, json={"content": "继续"}).status_code == 201
        payload = json.loads(requests[-1].content)
        assert payload["model"] == "test-model"
        assert "隔离数据" not in requests[-1].content.decode()
        assert [m["content"] for m in payload["messages"]][-3:] == ["你好", "你好，我记住了", "继续"]
        assert requests[-1].url.path == ("/v1/messages" if provider == "Anthropic" else "/v1/chat/completions")
        for failure, status in [("timeout", 504), ("auth", 502), ("empty", 502)]:
            mode["value"] = failure
            response = client.post(path, headers=HEADERS, json={"content": "失败消息"})
            assert response.status_code == status
            assert "secret" not in response.text
        messages = client.get(f"/bots/{bot}/messages", headers=HEADERS).json()
        assert len(messages) == 4
        assert client.post(path, headers=HEADERS, json={"content": "  "}).status_code == 422
