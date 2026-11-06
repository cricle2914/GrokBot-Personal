import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from cryptography.fernet import Fernet
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .model_client import generate_reply
from .db import Base, engine, get_db
from .models import Bot, Message, ModelConfig, Task
from .schemas import BotCreate, BotRead, MessageCreate, MessageRead, ModelConfigRead, ModelConfigWrite, TaskCreate, TaskRead

WORKSPACE = Path(os.getenv("AGENT_WORKSPACE", "./workspace"))
ACCESS_TOKEN = os.getenv("AGENT_ACCESS_TOKEN", "")
MODEL_ENCRYPTION_KEY = os.getenv("MODEL_ENCRYPTION_KEY", "")


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="GrokBot Personal API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "http://127.0.0.1:1420", "http://tauri.localhost", "tauri://localhost"],
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Authorization", "Content-Type"],
)


def authorize(authorization: str | None = Header(default=None)) -> None:
    if not ACCESS_TOKEN:
        raise HTTPException(status_code=503, detail="AGENT_ACCESS_TOKEN is not configured")
    if not authorization or not secrets.compare_digest(authorization, f"Bearer {ACCESS_TOKEN}"):
        raise HTTPException(status_code=401, detail="Invalid access token")


def find_bot(db: Session, bot_id: str) -> Bot:
    bot = db.get(Bot, bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    return bot


def read_model_config(config: ModelConfig | None) -> ModelConfigRead | None:
    if config is None:
        return None
    return ModelConfigRead(provider=config.provider, base_url=config.base_url,
                           model_name=config.model_name, has_api_key=bool(config.encrypted_api_key))


@app.get("/model-config", response_model=ModelConfigRead | None, dependencies=[Depends(authorize)])
def get_model_config(db: Session = Depends(get_db)):
    return read_model_config(db.get(ModelConfig, 1))


@app.put("/model-config", response_model=ModelConfigRead, dependencies=[Depends(authorize)])
def put_model_config(body: ModelConfigWrite, db: Session = Depends(get_db)):
    parsed = urlparse(body.base_url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.fragment or parsed.query:
        raise HTTPException(status_code=422, detail="Model API URL must be HTTPS")
    if not MODEL_ENCRYPTION_KEY:
        raise HTTPException(status_code=503, detail="Model encryption is not configured")
    try:
        cipher = Fernet(MODEL_ENCRYPTION_KEY.encode())
    except (ValueError, TypeError) as error:
        raise HTTPException(status_code=503, detail="Model encryption key is invalid") from error
    config = db.get(ModelConfig, 1)
    if not config and not body.api_key:
        raise HTTPException(status_code=422, detail="API key is required for first setup")
    if not config:
        config = ModelConfig(id=1, provider=body.provider, base_url=body.base_url,
                             model_name=body.model_name, encrypted_api_key="")
        db.add(config)
    config.provider = body.provider
    config.base_url = body.base_url
    config.model_name = body.model_name
    if body.api_key:
        config.encrypted_api_key = cipher.encrypt(body.api_key.encode()).decode()
    db.commit()
    return read_model_config(config)


@app.post("/model-config/test", dependencies=[Depends(authorize)])
def test_model_config(body: ModelConfigWrite, db: Session = Depends(get_db)):
    parsed = urlparse(body.base_url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.fragment or parsed.query:
        raise HTTPException(status_code=422, detail="Model API URL must be HTTPS")
    saved = db.get(ModelConfig, 1)
    try:
        cipher = Fernet(MODEL_ENCRYPTION_KEY.encode())
    except (ValueError, TypeError):
        raise HTTPException(status_code=503, detail="Model encryption is not configured") from None
    if not body.api_key and not saved:
        raise HTTPException(status_code=422, detail="API key is required")
    config = ModelConfig(provider=body.provider, base_url=body.base_url, model_name=body.model_name,
                         encrypted_api_key=cipher.encrypt(body.api_key.encode()).decode() if body.api_key else saved.encrypted_api_key)
    bot = Bot(name="连接测试", role="回复简短确认", description="")
    generate_reply(config, bot, [], "Reply with OK.", MODEL_ENCRYPTION_KEY)
    return {"status": "ok"}


@app.get("/health", dependencies=[Depends(authorize)])
def health(db: Session = Depends(get_db)) -> dict:
    db.execute(text("SELECT 1"))
    return {"status": "online", "database": "online"}


@app.post("/bots", response_model=BotRead, status_code=201, dependencies=[Depends(authorize)])
def create_bot(body: BotCreate, db: Session = Depends(get_db)):
    bot = Bot(**body.model_dump())
    db.add(bot)
    db.commit()
    db.refresh(bot)
    return bot


@app.get("/bots", response_model=list[BotRead], dependencies=[Depends(authorize)])
def list_bots(db: Session = Depends(get_db)):
    return db.scalars(select(Bot).order_by(Bot.created_at, Bot.id)).all()


@app.get("/bots/{bot_id}", response_model=BotRead, dependencies=[Depends(authorize)])
def get_bot(bot_id: str, db: Session = Depends(get_db)):
    return find_bot(db, bot_id)


@app.post("/bots/{bot_id}/messages", response_model=MessageRead, status_code=201, dependencies=[Depends(authorize)])
def create_message(bot_id: str, body: MessageCreate, db: Session = Depends(get_db)):
    find_bot(db, bot_id)
    message = Message(bot_id=bot_id, sender="user", content=body.content)
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


@app.post("/bots/{bot_id}/chat", response_model=list[MessageRead], status_code=201, dependencies=[Depends(authorize)])
def chat(bot_id: str, body: MessageCreate, db: Session = Depends(get_db)):
    bot = find_bot(db, bot_id)
    if not body.content.strip():
        raise HTTPException(status_code=422, detail="Message cannot be blank")
    config = db.get(ModelConfig, 1)
    if not config:
        raise HTTPException(status_code=409, detail="请先保存全局模型配置")
    if bot.model_provider and bot.model_provider != config.provider:
        raise HTTPException(status_code=409, detail="Bot 服务商与全局配置不一致，请使用全局服务商")
    history = list(reversed(db.scalars(select(Message).where(Message.bot_id == bot_id)
                   .order_by(Message.created_at.desc(), Message.id.desc()).limit(40)).all()))
    reply = generate_reply(config, bot, history, body.content.strip(), MODEL_ENCRYPTION_KEY)
    # Only persist a complete turn; failed requests can be retried without duplicate messages.
    user_message = Message(bot_id=bot_id, sender="user", content=body.content.strip())
    db.add(user_message)
    db.flush()
    assistant_message = Message(bot_id=bot_id, sender="assistant", content=reply)
    db.add(assistant_message)
    db.commit()
    db.refresh(user_message)
    db.refresh(assistant_message)
    return [user_message, assistant_message]


@app.get("/bots/{bot_id}/messages", response_model=list[MessageRead], dependencies=[Depends(authorize)])
def list_messages(bot_id: str, db: Session = Depends(get_db)):
    find_bot(db, bot_id)
    return list(reversed(db.scalars(select(Message).where(Message.bot_id == bot_id).order_by(Message.created_at.desc(), Message.id.desc()).limit(200)).all()))


@app.post("/bots/{bot_id}/tasks", response_model=TaskRead, status_code=201, dependencies=[Depends(authorize)])
def create_task(bot_id: str, body: TaskCreate, db: Session = Depends(get_db)):
    find_bot(db, bot_id)
    task = Task(bot_id=bot_id, title=body.title, status="pending")
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@app.get("/bots/{bot_id}/tasks", response_model=list[TaskRead], dependencies=[Depends(authorize)])
def list_tasks(bot_id: str, db: Session = Depends(get_db)):
    find_bot(db, bot_id)
    return db.scalars(select(Task).where(Task.bot_id == bot_id).order_by(Task.created_at.desc(), Task.id.desc()).limit(100)).all()


