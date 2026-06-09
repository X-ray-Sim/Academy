"""Add Clerk identity fields to users

Revision ID: a0b1c2d3e4f5
Revises: z5a6b7c8d9e0
Create Date: 2026-06-09
"""
from typing import Sequence, Union

from alembic import op


revision: str = "a0b1c2d3e4f5"
down_revision: Union[str, None] = "z5a6b7c8d9e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS external_auth_provider VARCHAR')
    op.execute('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS external_auth_id VARCHAR')
    op.execute('CREATE INDEX IF NOT EXISTS ix_user_external_auth_provider ON "user" (external_auth_provider)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_user_external_auth_id ON "user" (external_auth_id)')
    op.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS ux_user_external_auth_provider_id '
        'ON "user" (external_auth_provider, external_auth_id) '
        'WHERE external_auth_provider IS NOT NULL AND external_auth_id IS NOT NULL'
    )


def downgrade() -> None:
    op.execute('DROP INDEX IF EXISTS ux_user_external_auth_provider_id')
    op.execute('DROP INDEX IF EXISTS ix_user_external_auth_id')
    op.execute('DROP INDEX IF EXISTS ix_user_external_auth_provider')
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS external_auth_id')
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS external_auth_provider')
