from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class BotCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    role: str = Field(default="个人助手", max_length=120)
    description: str = Field(default="", max_length=4000)
    model_provider: str | None = Field(default=None, max_length=80)
    model_name: str | None = Field(default=None, max_length=120)


class BotRead(BotCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=20000)


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    bot_id: str
    sender: str
    content: str
    created_at: datetime


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=240)


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    bot_id: str
    title: str
    status: str
    created_at: datetime
