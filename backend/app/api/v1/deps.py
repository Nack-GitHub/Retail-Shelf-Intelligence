"""Shared FastAPI dependencies: session, auth, role guards."""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db.models import User
from app.db.session import SessionFactory
from app.domain.enums import Role

bearer = HTTPBearer(auto_error=True)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionFactory() as session:
        yield session


async def current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or expired token"
        ) from None

    user = (await db.execute(select(User).where(User.id == payload["sub"]))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unknown user")
    return user


def owns_or_supervises(user: User, owner_id: uuid.UUID) -> bool:
    """May this user act on something that belongs to `owner_id`?

    A rep may act on their own work and nothing else. Management roles may act
    across the area — they review and correct, which is their job.

    This exists because "authenticated" was being used as if it meant
    "authorised": any logged-in user could attach a capture, and therefore an
    OSA score and a set of findings, to somebody else's visit at a store they
    had never been to.
    """
    if user.role in {Role.MANAGER.value, Role.ADMIN.value, Role.DATA.value}:
        return True
    return owner_id == user.id


def require_roles(*roles: Role):
    """Guard a route to specific roles."""

    async def _guard(user: User = Depends(current_user)) -> User:
        if user.role not in {r.value for r in roles}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"role {user.role} may not access this resource",
            )
        return user

    return _guard
