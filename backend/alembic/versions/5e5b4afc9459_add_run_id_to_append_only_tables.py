"""add run_id to append-only tables

Revision ID: 5e5b4afc9459
Revises: 81d007f7686b
Create Date: 2026-08-22 23:36:56.427102
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '5e5b4afc9459'
down_revision = '81d007f7686b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add run_id, backfilling existing rows before enforcing NOT NULL.

    Historic rows predate the concept of a run. Each gets its own generated id
    rather than a shared sentinel: they came from separate inference runs, and
    inventing a single shared run would be a lie the read path would act on.
    """
    for table in ("detections", "shelf_analyses", "gap_findings"):
        op.add_column(table, sa.Column("run_id", sa.UUID(), nullable=True))

    # Group historic rows by the analysis they belong to where we can, and give
    # everything else a per-capture run so a result never mixes two runs.
    op.execute("UPDATE shelf_analyses SET run_id = gen_random_uuid() WHERE run_id IS NULL")
    op.execute("""
        UPDATE detections d SET run_id = a.run_id
        FROM shelf_analyses a
        WHERE d.capture_id = a.capture_id AND d.run_id IS NULL
    """)
    op.execute("""
        UPDATE gap_findings g SET run_id = a.run_id
        FROM shelf_analyses a
        WHERE g.capture_id = a.capture_id AND g.run_id IS NULL
    """)
    # Orphans with no analysis at all.
    op.execute("UPDATE detections SET run_id = gen_random_uuid() WHERE run_id IS NULL")
    op.execute("UPDATE gap_findings SET run_id = gen_random_uuid() WHERE run_id IS NULL")

    for table in ("detections", "shelf_analyses", "gap_findings"):
        op.alter_column(table, "run_id", nullable=False)

    op.create_index("ix_findings_run", "gap_findings", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_findings_run", table_name="gap_findings")
    for table in ("detections", "shelf_analyses", "gap_findings"):
        op.drop_column(table, "run_id")
