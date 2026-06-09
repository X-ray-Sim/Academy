import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional
from uuid import uuid4

import httpx
import jwt
from fastapi import Request
from jwt import PyJWKClient
from jwt.exceptions import PyJWTError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.users import User
from src.services.security.account_lockout import update_login_info
from src.services.security.rate_limiting import get_client_ip

logger = logging.getLogger(__name__)

CLERK_PROVIDER = "clerk"
_jwks_clients: dict[str, PyJWKClient] = {}


def get_auth_provider() -> str:
    """Return the configured human-user auth provider.

    Production defaults to Clerk so a public clone cannot silently fall back to
    the old LearnHouse credential system. Tests default to legacy unless they
    explicitly patch this function.
    """
    configured = (
        os.environ.get("VITASIM_AUTH_PROVIDER")
        or os.environ.get("LEARNHOUSE_AUTH_PROVIDER")
    )
    if configured:
        return configured.strip().lower()
    return "legacy" if os.environ.get("TESTING") == "true" else CLERK_PROVIDER


def _csv_env(name: str) -> list[str]:
    raw = os.environ.get(name, "")
    return [value.strip().rstrip("/") for value in raw.split(",") if value.strip()]


def _clerk_issuer() -> str | None:
    issuer = (
        os.environ.get("CLERK_JWT_ISSUER")
        or os.environ.get("CLERK_ISSUER_URL")
    )
    return issuer.rstrip("/") if issuer else None


def _clerk_jwks_url() -> str | None:
    explicit = os.environ.get("CLERK_JWKS_URL")
    if explicit:
        return explicit
    issuer = _clerk_issuer()
    if issuer:
        return f"{issuer}/.well-known/jwks.json"
    return None


def _public_key() -> str | None:
    key = os.environ.get("CLERK_JWT_KEY") or os.environ.get("CLERK_PEM_PUBLIC_KEY")
    return key.replace("\\n", "\n") if key else None


async def verify_clerk_session_token(token: str, request: Request) -> dict[str, Any] | None:
    """Verify a Clerk session JWT and return claims when trusted."""
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256":
            return None

        issuer = _clerk_issuer()
        audience = os.environ.get("CLERK_JWT_AUDIENCE") or None
        options = {
            "require": ["exp", "sub"],
            "verify_aud": bool(audience),
            "verify_iss": bool(issuer),
        }

        key = _public_key()
        if key:
            claims = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                audience=audience,
                issuer=issuer,
                options=options,
            )
        else:
            jwks_url = _clerk_jwks_url()
            if not jwks_url:
                logger.warning("Clerk auth is enabled but no CLERK_JWT_ISSUER or CLERK_JWKS_URL is configured")
                return None
            client = _jwks_clients.setdefault(jwks_url, PyJWKClient(jwks_url))
            signing_key = client.get_signing_key_from_jwt(token).key
            claims = jwt.decode(
                token,
                signing_key,
                algorithms=["RS256"],
                audience=audience,
                issuer=issuer,
                options=options,
            )

        authorized_parties = (
            _csv_env("CLERK_AUTHORIZED_PARTIES")
            or _csv_env("VITASIM_AUTHORIZED_PARTIES")
            or _csv_env("LEARNHOUSE_ALLOWED_ORIGINS")
        )
        azp = claims.get("azp")
        if azp and authorized_parties and azp.rstrip("/") not in authorized_parties:
            return None

        if claims.get("sts") == "pending":
            return None

        return claims
    except PyJWTError:
        return None
    except Exception as exc:
        logger.warning("Clerk token verification failed: %s", exc)
        return None


def _profile_from_claims(claims: dict[str, Any]) -> dict[str, Any]:
    email = (
        claims.get("email")
        or claims.get("primary_email")
        or claims.get("primary_email_address")
    )
    return {
        "id": claims.get("sub"),
        "email": email,
        "username": claims.get("username"),
        "first_name": claims.get("first_name") or claims.get("given_name") or "",
        "last_name": claims.get("last_name") or claims.get("family_name") or "",
        "avatar_image": claims.get("image_url") or claims.get("picture") or "",
        "email_verified": claims.get("email_verified") is True,
    }


async def get_clerk_user_profile(clerk_user_id: str) -> dict[str, Any] | None:
    """Fetch the Clerk user profile through the Clerk Backend API."""
    secret_key = os.environ.get("CLERK_SECRET_KEY")
    if not secret_key:
        return None

    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(
            f"https://api.clerk.com/v1/users/{clerk_user_id}",
            headers={"Authorization": f"Bearer {secret_key}"},
        )

    if response.status_code != 200:
        logger.warning("Clerk user lookup failed for %s with status %s", clerk_user_id, response.status_code)
        return None

    data = response.json()
    email_addresses = data.get("email_addresses") or []
    primary_email_id = data.get("primary_email_address_id")
    primary_email = None
    email_verified = False
    for email_entry in email_addresses:
        if email_entry.get("id") == primary_email_id:
            primary_email = email_entry.get("email_address")
            verification = email_entry.get("verification") or {}
            email_verified = verification.get("status") == "verified"
            break
    if not primary_email and email_addresses:
        primary_email = email_addresses[0].get("email_address")

    return {
        "id": data.get("id"),
        "email": primary_email,
        "username": data.get("username"),
        "first_name": data.get("first_name") or "",
        "last_name": data.get("last_name") or "",
        "avatar_image": data.get("image_url") or "",
        "email_verified": email_verified,
    }


def _username_seed(profile: dict[str, Any]) -> str:
    candidate = (
        profile.get("username")
        or f"{profile.get('first_name', '')}{profile.get('last_name', '')}"
        or str(profile.get("email", "")).split("@")[0]
        or "user"
    )
    candidate = re.sub(r"[^a-zA-Z0-9_-]+", "", candidate).strip("_-")
    return candidate[:40] or "user"


async def _unique_username(db_session: AsyncSession, seed: str) -> str:
    candidate = seed
    counter = 1
    while True:
        existing = (await db_session.execute(
            select(User).where(User.username == candidate)
        )).scalars().first()
        if not existing:
            return candidate
        counter += 1
        candidate = f"{seed}{counter}"


async def get_or_create_user_from_clerk_claims(
    request: Request,
    db_session: AsyncSession,
    claims: dict[str, Any],
    profile_loader: Callable[[str], Awaitable[dict[str, Any] | None]] = get_clerk_user_profile,
) -> User | None:
    clerk_user_id = claims.get("sub")
    if not clerk_user_id:
        return None

    user = (await db_session.execute(
        select(User).where(
            (User.external_auth_provider == CLERK_PROVIDER)
            & (User.external_auth_id == clerk_user_id)
        )
    )).scalars().first()

    profile = _profile_from_claims(claims)
    if not profile.get("email"):
        loaded_profile = await profile_loader(clerk_user_id)
        if loaded_profile:
            profile = loaded_profile

    email = str(profile.get("email") or "").strip().lower()
    if not user and email:
        user = (await db_session.execute(
            select(User).where(User.email == email)
        )).scalars().first()

    now = datetime.now(timezone.utc)
    if user:
        user.external_auth_provider = CLERK_PROVIDER
        user.external_auth_id = clerk_user_id
        user.signup_method = CLERK_PROVIDER
        user.email_verified = profile.get("email_verified") is True
        if user.email_verified and not user.email_verified_at:
            user.email_verified_at = now.isoformat()
        elif not user.email_verified:
            user.email_verified_at = None
        if profile.get("avatar_image") and not user.avatar_image:
            user.avatar_image = profile["avatar_image"]
        user.update_date = str(now)
    else:
        if not email:
            return None
        username = await _unique_username(db_session, _username_seed(profile))
        user = User(
            username=username,
            first_name=profile.get("first_name") or "",
            last_name=profile.get("last_name") or "",
            email=email,
            avatar_image=profile.get("avatar_image") or "",
            password="",
            user_uuid=f"user_{uuid4()}",
            email_verified=profile.get("email_verified") is True,
            email_verified_at=now.isoformat() if profile.get("email_verified") is True else None,
            signup_method=CLERK_PROVIDER,
            external_auth_provider=CLERK_PROVIDER,
            external_auth_id=clerk_user_id,
            creation_date=str(now),
            update_date=str(now),
        )

    client_ip = get_client_ip(request)
    await update_login_info(user, client_ip, db_session)

    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user
