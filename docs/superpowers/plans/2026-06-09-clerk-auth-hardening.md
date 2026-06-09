# Clerk Auth Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Clerk the only human credential path when Clerk auth is enabled, and prevent legacy local authorization paths from creating or attaching users in ways that can later interfere with Clerk-linked accounts.

**Architecture:** Keep the local user, RBAC, organization, and API-token models intact. Harden the migration boundary by disabling legacy human account creation in Clerk mode, binding organization joins to the authenticated principal, and preserving Clerk's real email-verification state instead of manufacturing local verification.

**Tech Stack:** FastAPI, SQLModel, pytest, pytest-asyncio, Clerk JWT/profile claims, Next.js auth UI verification gates.

---

## Review Context

The latest Clerk migration commit is `3106bc9 feat: switch auth to Clerk`. The review found three auth-boundary regressions:

- `apps/api/src/routers/users.py` still exposes password-backed user creation routes in Clerk mode.
- `apps/api/src/routers/orgs/orgs.py` and `apps/api/src/services/orgs/join.py` allow a caller to join an organization for an arbitrary request-body `user_id`.
- `apps/api/src/services/auth/clerk.py` treats primary-email presence as verified and stamps `email_verified_at` on new local users even when Clerk did not verify the email.

Do not remove API-token support. `Bearer lh_...` and service-account token handling are programmatic auth paths and should continue to work unless a targeted test proves otherwise.

## Subagent Layout

Use three implementation subagents plus one verifier. Subagents A, B, and C can run in parallel because their implementation files and new test files are separated. Subagent D runs after their patches are merged.

- Subagent A: Disable legacy password-backed user creation in Clerk mode.
- Subagent B: Bind organization join requests to the authenticated user.
- Subagent C: Preserve Clerk email-verification truth.
- Subagent D: Run integration/static verification and report remaining legacy auth surfaces.

Coordinator responsibilities:

- [ ] Create/switch to a working branch, for example `codex/clerk-auth-hardening`.
- [ ] Dispatch Subagents A, B, and C with the prompts below.
- [ ] Merge their outputs, resolving only real conflicts.
- [ ] Dispatch Subagent D after implementation subagents complete.
- [ ] Run the final verification commands in this plan.
- [ ] Report findings and any intentionally retained legacy surfaces.

## Subagent A: Disable Legacy User Creation

Prompt:

> You are fixing the Clerk migration boundary. In Clerk mode, password-backed user creation endpoints must return the existing Clerk-disabled 410 response before doing org join checks, invite rate limits, or service calls. Touch only `apps/api/src/routers/users.py` and a new focused test file. Do not change API-token behavior. Follow TDD: add failing tests, implement, rerun targeted tests, and summarize exact files changed.

Files:

- `apps/api/src/routers/users.py`
- `apps/api/src/tests/security/test_clerk_user_creation_disabled.py` (new)

Steps:

- [ ] Add tests that mount `src.routers.users.router` in a minimal FastAPI app and override `get_db_session`.
- [ ] Patch `src.routers.users.get_auth_provider` to return `"clerk"`.
- [ ] Verify these endpoints return HTTP 410 with detail code `CLERK_AUTH_REQUIRED`:
  - `POST /api/v1/users/1`
  - `POST /api/v1/users/1/invite/ABC12345`
  - `POST /api/v1/users/`
- [ ] Use a payload with `username`, `first_name`, `last_name`, `email`, `password`, `avatar_image`, `bio`, `details`, and `profile`.
- [ ] Run the targeted test and confirm it fails before implementation:

```powershell
cd apps/api
pytest src/tests/security/test_clerk_user_creation_disabled.py -q
```

- [ ] In each create route, call `raise_clerk_credentials_disabled()` as the first executable statement:
  - `api_create_user_with_orgid`
  - `api_create_user_with_orgid_and_invite`
  - `api_create_user_without_org`
- [ ] Rerun the targeted test and confirm it passes.
- [ ] Rerun the existing Clerk security suite:

```powershell
cd apps/api
pytest src/tests/security/test_clerk_auth.py src/tests/security/test_clerk_user_creation_disabled.py -q
```

Expected result:

- Legacy account creation is unreachable in Clerk mode.
- Open organization signup and invite-code signup cannot create local password users under Clerk.
- Existing non-Clerk behavior is unchanged.

## Subagent B: Bind Org Join To Authenticated Principal

Prompt:

> You are closing the organization-join identity-confusion bug. A caller must only join an organization as their authenticated local user, never as an arbitrary `args.user_id`. Touch only the org join router/service and the existing org join service tests. Preserve invite-only and open-join behavior for the matching authenticated user. Follow TDD and summarize exact files changed.

Files:

- `apps/api/src/routers/orgs/orgs.py`
- `apps/api/src/services/orgs/join.py`
- `apps/api/src/tests/services/test_org_join_service.py`

Steps:

- [ ] Add a service test where an anonymous caller tries to join an open org for a real user UUID and receives HTTP 401.
- [ ] Add a service test where authenticated user A tries to join an open org using user B's UUID and receives HTTP 403.
- [ ] Use the existing helpers in `test_org_join_service.py`, including `_make_user`, `_make_org_config`, and the current monkeypatch style for feature limits and usage increments.
- [ ] Run the targeted test and confirm it fails before implementation:

```powershell
cd apps/api
pytest src/tests/services/test_org_join_service.py -q
```

- [ ] Change `api_join_an_org` in `apps/api/src/routers/orgs/orgs.py` to depend on `get_authenticated_user` instead of `get_current_user`.
- [ ] In `join_org`, after resolving the target `User` and before checking `email_verified`, enforce:
  - Anonymous users receive HTTP 401.
  - The authenticated user's `id` and `user_uuid` must match the resolved target user.
  - Mismatched users receive HTTP 403 with a clear detail message.
- [ ] Use attribute checks such as `getattr(current_user, "id", None)` and `getattr(current_user, "user_uuid", None)` so API-token-like principals do not accidentally pass as a human user.
- [ ] Preserve existing behavior for invalid target users, missing organizations, invite-only checks, already-member checks, and unverified emails.
- [ ] Rerun the targeted service tests.

Expected result:

- `/orgs/join` cannot attach a different local user to an organization.
- Anonymous Clerk failures cannot fall through into open-org join.
- Valid open and invite joins still work for the authenticated user.

## Subagent C: Preserve Clerk Email Verification

Prompt:

> You are fixing Clerk email-verification mapping. The local user should be marked verified only when Clerk says the email is verified. Do not infer verification from primary-email presence. Touch only Clerk auth mapping code and a new focused test file. Follow TDD and summarize exact files changed.

Files:

- `apps/api/src/services/auth/clerk.py`
- `apps/api/src/tests/security/test_clerk_email_verification.py` (new)

Steps:

- [ ] Add a test for `get_or_create_user_from_clerk_claims` where claims include an email and `email_verified: False`.
- [ ] Assert the created local user has `email_verified is False` and `email_verified_at is None`.
- [ ] Add a test where claims require `profile_loader`, and the loaded Clerk profile has `email_verified: False`.
- [ ] Assert that profile-loaded user also remains locally unverified.
- [ ] Run the targeted test and confirm it fails before implementation:

```powershell
cd apps/api
pytest src/tests/security/test_clerk_email_verification.py -q
```

- [ ] Update `_profile_from_claims` so `email_verified` comes from claims when present and defaults to `False`, not `True`.
- [ ] Update `get_clerk_user_profile` so it returns Clerk's actual verification boolean instead of `email_verified or bool(primary_email)`.
- [ ] When creating a new local user from Clerk, set `email_verified_at` only if `profile["email_verified"]` is true.
- [ ] Keep the existing update path that backfills `email_verified_at` when an already-linked user is verified and lacks a timestamp.
- [ ] Rerun the targeted test and the existing Clerk auth tests:

```powershell
cd apps/api
pytest src/tests/security/test_clerk_auth.py src/tests/security/test_clerk_email_verification.py -q
```

Expected result:

- Clerk-unverified emails remain locally unverified.
- Signup/UI gates that depend on local `email_verified` receive accurate state.
- Existing verified Clerk users still get a verification timestamp.

## Subagent D: Final Verification And Legacy Surface Audit

Prompt:

> You are the verification subagent. Do not implement new behavior unless a previous change is obviously incomplete and limited to the planned files. Run the focused tests, scan remaining auth surfaces, and report whether old human-auth paths can still interfere with Clerk. Separate intended API-token or logout compatibility from risky legacy credential code.

Files to inspect:

- `apps/api/src/routers/auth.py`
- `apps/api/src/routers/users.py`
- `apps/api/src/routers/admin.py`
- `apps/api/src/security/auth.py`
- `apps/api/src/services/auth/clerk.py`
- `apps/api/src/services/orgs/join.py`
- `apps/web/app/api/auth/[...path]/route.ts`

Commands:

```powershell
cd apps/api
pytest src/tests/security/test_clerk_auth.py src/tests/security/test_clerk_user_creation_disabled.py src/tests/security/test_clerk_email_verification.py src/tests/services/test_org_join_service.py -q
```

```powershell
rg -n "CLERK_AUTH_REQUIRED|raise_clerk_credentials_disabled|UserCreate|create_user_without_org|create_user_with_invite|create_user\\(|get_current_user|join_org|email_verified_at|email_verified" apps/api/src apps/web/app
```

Audit checklist:

- [ ] Password login, refresh, email verification, password reset, OAuth start/callback, JWT admin, magic link, and password change endpoints are still disabled in Clerk mode.
- [ ] User creation endpoints now also return `CLERK_AUTH_REQUIRED` in Clerk mode.
- [ ] Organization join requires an authenticated user and rejects mismatched `args.user_id`.
- [ ] Clerk email verification is not inferred from primary email alone.
- [ ] API-token support remains intact and is documented as intentional.
- [ ] Web legacy auth proxy still returns 410 for legacy auth paths except logout cookie cleanup.

## Final Coordinator Verification

Run after all subagents complete:

```powershell
cd apps/api
pytest src/tests/security/test_clerk_auth.py src/tests/security/test_clerk_user_creation_disabled.py src/tests/security/test_clerk_email_verification.py src/tests/services/test_org_join_service.py -q
```

If the focused suite passes and no unexpected legacy human-auth paths remain, report:

- Files changed.
- Tests run.
- Any remaining intentional legacy compatibility.
- Any broader test suite not run.

If any test fails, do not paper over it. Capture the exact failing test, explain the likely cause, and either fix within the planned file boundary or return the blocker to the coordinator.
