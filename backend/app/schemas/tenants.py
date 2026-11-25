from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field


IndustryType = Literal["telecom", "helpdesk", "banking", "education"]


class TenantCreate(BaseModel):
    slug: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9-]+$")
    name: str = Field(min_length=2, max_length=160)
    industry: IndustryType


class TenantOut(BaseModel):
    id: str
    slug: str
    name: str
    industry: str
    status: str
    created_at: datetime


class EndUserCreate(BaseModel):
    external_reference: Optional[str] = Field(default=None, min_length=2, max_length=128)
    name: str = Field(min_length=2, max_length=160)
    email: Optional[str] = Field(default=None, max_length=255)
    phone_reference: Optional[str] = Field(default=None, max_length=64)
    role: str = Field(default="customer", min_length=2, max_length=64)
    metadata_json: Dict[str, Any] = Field(default_factory=dict)


class EndUserOut(BaseModel):
    id: str
    tenant_id: str
    external_reference: str
    name: str
    email: Optional[str]
    phone_reference: Optional[str]
    role: str
    status: str
    metadata_json: Dict[str, Any]
    created_at: datetime
    enrollment_status: Optional[str] = None
