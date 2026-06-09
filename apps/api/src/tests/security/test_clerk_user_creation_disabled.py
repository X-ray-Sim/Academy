from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers.users import router as users_router


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(users_router, prefix="/api/v1/users")
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as c:
        yield c


@pytest.fixture
def user_creation_payload():
    return {
        "username": "clerk-disabled",
        "first_name": "Clerk",
        "last_name": "Disabled",
        "email": "clerk-disabled@example.com",
        "password": "legacy-password",
        "avatar_image": "https://example.com/avatar.png",
        "bio": "Legacy password-backed signup should be disabled.",
        "details": {"department": "security"},
        "profile": {"timezone": "UTC"},
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/api/v1/users/1", "post"),
        ("/api/v1/users/1/invite/ABC12345", "post"),
        ("/api/v1/users/", "post"),
    ],
)
async def test_clerk_mode_disables_legacy_password_backed_user_creation(
    client,
    user_creation_payload,
    path,
    method,
):
    with (
        patch("src.routers.users.get_auth_provider", return_value="clerk"),
        patch(
            "src.routers.users.get_org_join_mechanism",
            new_callable=AsyncMock,
            side_effect=AssertionError("org join check should not run in Clerk mode"),
        ) as get_org_join_mechanism_mock,
        patch(
            "src.routers.users.check_invite_acceptance_rate_limit",
            side_effect=AssertionError("invite rate limit should not run in Clerk mode"),
        ) as check_invite_rate_limit_mock,
        patch(
            "src.routers.users.create_user",
            new_callable=AsyncMock,
            side_effect=AssertionError("create_user should not run in Clerk mode"),
        ) as create_user_mock,
        patch(
            "src.routers.users.create_user_with_invite",
            new_callable=AsyncMock,
            side_effect=AssertionError("create_user_with_invite should not run in Clerk mode"),
        ) as create_user_with_invite_mock,
        patch(
            "src.routers.users.create_user_without_org",
            new_callable=AsyncMock,
            side_effect=AssertionError("create_user_without_org should not run in Clerk mode"),
        ) as create_user_without_org_mock,
    ):
        response = await getattr(client, method)(path, json=user_creation_payload)

    assert response.status_code == 410
    assert response.json()["detail"]["code"] == "CLERK_AUTH_REQUIRED"
    get_org_join_mechanism_mock.assert_not_awaited()
    check_invite_rate_limit_mock.assert_not_called()
    create_user_mock.assert_not_awaited()
    create_user_with_invite_mock.assert_not_awaited()
    create_user_without_org_mock.assert_not_awaited()
