"""Authentication routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import current_user, get_db
from app.api.v1.schemas import LoginRequest, TokenResponse, UserOut
from app.core.config import settings
from app.core.security import create_access_token, verify_password
from app.db.models import User

router = APIRouter(tags=["auth"])


@router.post("/auth/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    user = (
        await db.execute(select(User).where(User.email == body.email.lower()))
    ).scalar_one_or_none()

    if (
        user is None
        or not user.is_active
        or not verify_password(body.password, user.hashed_password)
    ):
        # Deliberately identical for unknown email and wrong password.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="อีเมลหรือรหัสผ่านไม่ถูกต้อง")

    return TokenResponse(
        access_token=create_access_token(user.id, user.role),
        expires_in=settings.jwt_expiry_hours * 3600,
    )


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)) -> User:
    return user
