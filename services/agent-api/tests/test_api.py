import os
from pathlib import Path

os.environ["AGENT_ACCESS_TOKEN"] = "test-token"
os.environ["AGENT_WORKSPACE"] = "/tmp/grokbot-test-workspace"

from fastapi.testclient import TestClient
from app.main import app


def test_note_persists_and_auth_is_required():
    client = TestClient(app)
    assert client.get("/health").status_code == 401
    headers = {"Authorization": "Bearer test-token"}
    notes = Path(os.environ["AGENT_WORKSPACE"]) / "notes.txt"
    if notes.exists(): notes.unlink()
    assert client.post("/tasks", headers=headers, json={"kind": "note", "value": "hello cloud"}).status_code == 200
    result = client.post("/tasks", headers=headers, json={"kind": "read_notes", "value": "read"})
    assert result.json()["result"] == "hello cloud\n"
