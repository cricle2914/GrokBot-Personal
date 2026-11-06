import os
from cryptography.fernet import Fernet

os.environ["AGENT_ACCESS_TOKEN"] = "test-token"
os.environ["MODEL_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
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


def test_global_model_key_is_encrypted_and_not_returned():
    from app.db import SessionLocal
    from app.models import ModelConfig

    headers = {"Authorization": "Bearer test-token"}
    payload = {"provider": "OpenAI-compatible", "base_url": "https://model.example/v1",
               "model_name": "example-model", "api_key": "example-test-key"}
    with TestClient(app) as client:
        assert client.put("/model-config", json=payload).status_code == 401
        saved = client.put("/model-config", headers=headers, json=payload)
        assert saved.status_code == 200
        assert saved.json() == {"provider": "OpenAI-compatible", "base_url": "https://model.example/v1",
                                "model_name": "example-model", "has_api_key": True}
        assert "example-test-key" not in client.get("/model-config", headers=headers).text
        assert client.put("/model-config", headers=headers, json={**payload, "base_url": "http://model.example/v1"}).status_code == 422
        assert client.put("/model-config", headers=headers, json={**payload, "api_key": None, "model_name": "new-model"}).status_code == 200
    with SessionLocal() as db:
        config = db.get(ModelConfig, 1)
        assert config is not None
        assert "example-test-key" not in config.encrypted_api_key
        assert Fernet(os.environ["MODEL_ENCRYPTION_KEY"].encode()).decrypt(config.encrypted_api_key.encode()) == b"example-test-key"
