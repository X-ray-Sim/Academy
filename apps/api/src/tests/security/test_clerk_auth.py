from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.users import User
from src.routers.admin import router as admin_router
from src.routers.auth import router as auth_router
from src.routers.users import router as users_router
from src.security.auth import get_current_user


@pytest.fixture
def request_factory():
    def _request(token: str = "clerk-session-token"):
        request = Mock()
        request.headers = {
            "Authorization": f"Bearer {token}",
            "Origin": "https://vitasim.app",
        }
        request.cookies = {}
        request.path_params = {}
        request.state = SimpleNamespace()
        request.client = SimpleNamespace(host="127.0.0.1")
        return request

    return _request


@pytest.fixture
def clerk_claims():
    return {
        "sub": "user_clerk_123",
        "sid": "sess_123",
        "iss": "https://clerk.vitasim.app",
        "azp": "https://vitasim.app",
        "exp": 4_102_444_800,
        "nbf": 1,
    }


@pytest.mark.asyncio
async def test_clerk_token_links_existing_local_user_by_email(db, request_factory, clerk_claims):
    user = User(
        id=101,
        username="existing",
        first_name="Existing",
        last_name="User",
        email="existing@vitasim.app",
        password="old-hash",
        user_uuid="user_existing",
        email_verified=False,
        creation_date=str(datetime.now(timezone.utc)),
        update_date=str(datetime.now(timezone.utc)),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    profile = {
        "id": "user_clerk_123",
        "email": "existing@vitasim.app",
        "username": "existing",
        "first_name": "Existing",
        "last_name": "User",
        "avatar_image": "https://img.clerk.com/avatar.png",
        "email_verified": True,
    }

    with patch("src.security.auth.get_auth_provider", return_value="clerk"), patch(
        "src.security.auth.verify_clerk_session_token",
        new_callable=AsyncMock,
        return_value=clerk_claims,
    ), patch(
        "src.security.auth.get_clerk_user_profile",
        new_callable=AsyncMock,
        return_value=profile,
    ):
        current_user = await get_current_user(request_factory(), db)

    assert current_user.id == user.id
    assert current_user.email == "existing@vitasim.app"

    linked = (await db.execute(select(User).where(User.id == user.id))).scalars().first()
    assert linked.external_auth_provider == "clerk"
    assert linked.external_auth_id == "user_clerk_123"
    assert linked.email_verified is True
    assert linked.signup_method == "clerk"


@pytest.mark.asyncio
async def test_clerk_token_creates_local_app_user_without_password(db, request_factory, clerk_claims):
    profile = {
        "id": "user_clerk_456",
        "email": "new@vitasim.app",
        "username": "new-user",
        "first_name": "New",
        "last_name": "User",
        "avatar_image": "",
        "email_verified": True,
    }

    with patch("src.security.auth.get_auth_provider", return_value="clerk"), patch(
        "src.security.auth.verify_clerk_session_token",
        new_callable=AsyncMock,
        return_value={**clerk_claims, "sub": "user_clerk_456"},
    ), patch(
        "src.security.auth.get_clerk_user_profile",
        new_callable=AsyncMock,
        return_value=profile,
    ):
        current_user = await get_current_user(request_factory(), db)

    created = (await db.execute(select(User).where(User.email == "new@vitasim.app"))).scalars().first()
    assert created is not None
    assert current_user.id == created.id
    assert created.password == ""
    assert created.external_auth_provider == "clerk"
    assert created.external_auth_id == "user_clerk_456"
    assert created.signup_method == "clerk"


@pytest.mark.asyncio
async def test_clerk_token_from_untrusted_party_is_anonymous(db, request_factory):
    with patch("src.security.auth.get_auth_provider", return_value="clerk"), patch(
        "src.security.auth.verify_clerk_session_token",
        new_callable=AsyncMock,
        return_value=None,
    ):
        current_user = await get_current_user(request_factory("bad-token"), db)

    assert current_user.user_uuid == "user_anonymous"


@pytest.mark.asyncio
async def test_password_login_is_disabled_when_clerk_owns_credentials(db):
    app = FastAPI()
    app.include_router(auth_router, prefix="/api/v1/auth")
    app.dependency_overrides[get_db_session] = lambda: db

    with patch("src.routers.auth.get_auth_provider", return_value="clerk"):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/auth/login",
                data={"username": "user@vitasim.app", "password": "secret"},
            )

    assert response.status_code == 410
    assert response.json()["detail"]["code"] == "CLERK_AUTH_REQUIRED"


@pytest.mark.asyncio
async def test_password_management_endpoints_are_disabled_when_clerk_owns_credentials(db):
    app = FastAPI()
    app.include_router(users_router, prefix="/api/v1/users")
    app.dependency_overrides[get_db_session] = lambda: db

    with patch("src.routers.users.get_auth_provider", return_value="clerk"):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            change_response = await client.put(
                "/api/v1/users/change_password/1",
                json={"old_password": "old-password", "new_password": "new-password"},
            )
            reset_response = await client.post(
                "/api/v1/users/reset_password/send_reset_code",
                json={"email": "user@vitasim.app", "org_id": 1},
            )

    assert change_response.status_code == 410
    assert change_response.json()["detail"]["code"] == "CLERK_AUTH_REQUIRED"
    assert reset_response.status_code == 410
    assert reset_response.json()["detail"]["code"] == "CLERK_AUTH_REQUIRED"


@pytest.mark.asyncio
async def test_admin_legacy_token_and_magic_link_endpoints_are_disabled_when_clerk_owns_credentials(db):
    app = FastAPI()
    app.include_router(admin_router, prefix="/api/v1/admin")
    app.dependency_overrides[get_db_session] = lambda: db

    with patch("src.routers.admin.get_auth_provider", return_value="clerk"):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            token_response = await client.post(
                "/api/v1/admin/acme/auth/token",
                json={"user_id": 1},
            )
            magic_issue_response = await client.post(
                "/api/v1/admin/acme/auth/magic-link",
                json={"user_id": 1, "redirect_to": "/"},
            )
            magic_consume_response = await client.get(
                "/api/v1/admin/acme/auth/magic-consume?token=legacy-token",
            )

    assert token_response.status_code == 410
    assert token_response.json()["detail"]["code"] == "CLERK_AUTH_REQUIRED"
    assert magic_issue_response.status_code == 410
    assert magic_issue_response.json()["detail"]["code"] == "CLERK_AUTH_REQUIRED"
    assert magic_consume_response.status_code == 410
    assert "Clerk authentication" in magic_consume_response.text
