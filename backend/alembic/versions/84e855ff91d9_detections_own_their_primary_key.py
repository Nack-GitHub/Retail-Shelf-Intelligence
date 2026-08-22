"""detections own their primary key

Revision ID: 84e855ff91d9
Revises: 5e5b4afc9459
Create Date: 2026-08-22 23:38:24.031282
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '84e855ff91d9'
down_revision = '5e5b4afc9459'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Backfill source_detection_id from the old id before enforcing NOT NULL.

    Historic rows used the ML service's id as their primary key, so that value
    IS their source id — copying it preserves the trace back to the inference
    response while the primary key becomes ours from here on.
    """
    op.add_column("detections", sa.Column("source_detection_id", sa.UUID(), nullable=True))
    op.execute("UPDATE detections SET source_detection_id = id WHERE source_detection_id IS NULL")
    op.alter_column("detections", "source_detection_id", nullable=False)
    op.create_index("ix_detections_source", "detections", ["source_detection_id"])


def downgrade() -> None:
    op.drop_index("ix_detections_source", table_name="detections")
    op.drop_column("detections", "source_detection_id")
