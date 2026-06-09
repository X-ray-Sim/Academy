from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlmodel import select

from src.db.users import User
from src.services.auth.clerk import get_or_create_user_from_clerk_claims


@pytest.fixture
def request_factory():
    def _request():
        request = Mock()
        request.headers = {"Origin": "https://vitasim.app"}
        request.cookies = {}
        request.path_params = {}
        request.state = SimpleNamespace()
        request.client = SimpleNamespace(host="127.0.0.1")
        return request

    return _request


@pytest.mark.asyncio
async def test_clerk_claims_do_not_verify_local_user_when_email_unverified(db, request_factory):
    user = await get_or_create_user_from_clerk_claims(
        request_factory(),
        db,
        {
            "sub": "user_clerk_unverified_claims",
            "email": "unverified-claims@vitasim.app",
            "email_verified": False,
            "username": "unverified-claims",
        },
    )

    created = (
        await db.execute(
            select(User).where(User.email == "unverified-claims@vitasim.app")
        )
    ).scalars().first()

    assert user is not None
    assert created is not None
    assert created.id == user.id
    assert created.email_verified is False
    assert created.email_verified_at is None


@pytest.mark.asyncio
async def test_clerk_unverified_existing_user_clears_stale_verification_timestamp(db, request_factory):
    existing = User(
        username="previously-verified",
        first_name="Previously",
        last_name="Verified",
        email="previously-verified@vitasim.app",
        password="old-hash",
        user_uuid="user_previously_verified",
        email_verified=True,
        email_verified_at=datetime.now(timezone.utc).isoformat(),
        creation_date=str(datetime.now(timezone.utc)),
        update_date=str(datetime.now(timezone.utc)),
    )
    db.add(existing)
    await db.commit()
    await db.refresh(existing)

    user = await get_or_create_user_from_clerk_claims(
        request_factory(),
        db,
        {
            "sub": "user_clerk_existing_unverified",
            "email": "previously-verified@vitasim.app",
            "email_verified": False,
            "username": "previously-verified",
        },
    )

    updated = (
        await db.execute(
            select(User).where(User.email == "previously-verified@vitasim.app")
        )
    ).scalars().first()

    assert user is not None
    assert updated is not None
    assert updated.id == existing.id
    assert updated.id == user.id
    assert updated.email_verified is False
    assert updated.email_verified_at is None


@pytest.mark.asyncio
async def test_clerk_profile_loader_does_not_verify_local_user_when_email_unverified(db, request_factory):
    async def profile_loader(clerk_user_id: str):
        assert clerk_user_id == "user_clerk_unverified_profile"
        return {
            "id": clerk_user_id,
            "email": "unverified-profile@vitasim.app",
            "username": "unverified-profile",
            "first_name": "",
            "last_name": "",
            "avatar_image": "",
            "email_verified": False,
        }

    user = await get_or_create_user_from_clerk_claims(
        request_factory(),
        db,
        {"sub": "user_clerk_unverified_profile"},
        profile_loader=profile_loader,
    )

    created = (
        await db.execute(
            select(User).where(User.email == "unverified-profile@vitasim.app")
        )
    ).scalars().first()

    assert user is not None
    assert created is not None
    assert created.id == user.id
    assert created.email_verified is False
    assert created.email_verified_at is None
