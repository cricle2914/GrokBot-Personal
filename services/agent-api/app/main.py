import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .db import Base, engine, get_db
from .models import Bot, Message, Task
from .schemas import BotCreate, BotRead, MessageCreate, MessageRead, TaskCreate, TaskRead

WORKSPACE = Path(os.getenv("AGENT_WORKSPACE", "./workspace"))
ACCESS_TOKEN = os.getenv("AGENT_ACCESS_TOKEN", "")


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="GrokBot Personal API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "http://127.0.0.1:1420", "http://tauri.localhost", "tauri://localhost"],
    allow_methods=["GET", "POST"],
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


@app.get("/bots/{bot_id}/messages", response_model=list[MessageRead], dependencies=[Depends(authorize)])
def list_messages(bot_id: str, db: Session = Depends(get_db)):
    find_bot(db, bot_id)
    return db.scalars(select(Message).where(Message.bot_id == bot_id).order_by(Message.created_at, Message.id).limit(200)).all()


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


