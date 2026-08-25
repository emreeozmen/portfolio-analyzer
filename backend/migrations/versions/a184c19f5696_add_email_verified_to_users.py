"""add email_verified to users

Revision ID: a184c19f5696
Revises: 92ef9f924934
Create Date: 2026-08-25 19:04:18.175802

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a184c19f5696'
down_revision: Union[str, None] = '92ef9f924934'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default so existing rows are backfilled to False at the DB level by the
    # ALTER itself — adding a NOT NULL column with no default fails outright against a
    # users table that already has rows (autogenerate doesn't add this on its own).
    # Dropped again below once the backfill has happened, matching the app-level
    # default in models/user.py rather than leaving a stray DB-level default around
    # for future inserts to rely on implicitly.
    op.add_column('users', sa.Column('email_verified', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column('users', 'email_verified', server_default=None)


def downgrade() -> None:
    op.drop_column('users', 'email_verified')
