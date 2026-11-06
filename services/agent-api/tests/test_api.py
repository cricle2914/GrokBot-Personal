import os

os.environ["AGENT_ACCESS_TOKEN"] = "test-token"
os.environ.setdefault("DATABASE_URL", "sqlite:///./grokbot-test.db")

from fastapi.testclient import TestClient
from app.main import app


def test_bot_message_task_roundtrip():
    headers = {"Authorization": "Bearer test-token"}
    with TestClient(app) as client:
        assert client.get("/health").status_code == 401
        assert client.get("/health", headers=headers).json()["database"] == "online"
        response = client.post("/bots", headers=headers, json={"name": "测试 Bot", "role": "研究"})
        assert response.status_code == 201
        bot_id = response.json()["id"]
        assert client.get(f"/bots/{bot_id}", headers=headers).json()["name"] == "测试 Bot"
        message = client.post(f"/bots/{bot_id}/messages", headers=headers, json={"content": "你好"})
        assert message.status_code == 201
        task = client.post(f"/bots/{bot_id}/tasks", headers=headers, json={"title": "检查资料"})
        assert task.status_code == 201
        assert task.json()["status"] == "pending"

    with TestClient(app) as client:
        assert any(bot["id"] == bot_id for bot in client.get("/bots", headers=headers).json())
        assert client.get(f"/bots/{bot_id}/messages", headers=headers).json()[-1]["content"] == "你好"
        assert client.get(f"/bots/{bot_id}/tasks", headers=headers).json()[0]["title"] == "检查资料"
        assert client.post("/tools/run", headers=headers, json={"kind": "note", "value": "x"}).status_code == 404
