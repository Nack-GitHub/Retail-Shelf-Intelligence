"""Synchronous session factory for worker code.

Celery tasks are synchronous; using the sync driver here avoids running an
event loop inside a worker process for no benefit.
"""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

sync_engine = create_engine(settings.sync_database_url, pool_pre_ping=True)
SyncSessionFactory = sessionmaker(bind=sync_engine, class_=Session, expire_on_commit=False)
