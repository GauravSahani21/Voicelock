"""sandbox and n8n automation

Revision ID: a1b2c3d4e5f6
Revises: 9039ded9f205
Create Date: 2026-11-25 23:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "9039ded9f205"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sandbox_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("verification_session_id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("operator_id", sa.String(length=36), nullable=True),
        sa.Column("actor_reference", sa.String(length=160), nullable=False),
        sa.Column("industry", sa.String(length=32), nullable=False),
        sa.Column("scenario_id", sa.String(length=64), nullable=False),
        sa.Column("scenario_title", sa.String(length=160), nullable=False),
        sa.Column("requested_action", sa.String(length=128), nullable=False),
        sa.Column("resource_reference", sa.String(length=255), nullable=False),
        sa.Column("attack_type", sa.String(length=64), nullable=False),
        sa.Column("input_type", sa.String(length=32), nullable=False),
        sa.Column("decision_outcome", sa.String(length=32), nullable=True),
        sa.Column("challenge_valid", sa.Boolean(), nullable=True),
        sa.Column("aletheia_summary", sa.String(length=128), nullable=True),
        sa.Column("eidos_summary", sa.String(length=128), nullable=True),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("audit_event_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["operator_id"], ["operator_accounts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["verification_session_id"], ["verification_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("verification_session_id"),
    )
    op.create_index("ix_sandbox_industry_decision", "sandbox_sessions", ["industry", "decision_outcome"], unique=False)
    op.create_index("ix_sandbox_operator_created", "sandbox_sessions", ["operator_id", "created_at"], unique=False)
    op.create_index("ix_sandbox_tenant_created", "sandbox_sessions", ["tenant_id", "created_at"], unique=False)
    op.create_index(op.f("ix_sandbox_sessions_decision_outcome"), "sandbox_sessions", ["decision_outcome"], unique=False)
    op.create_index(op.f("ix_sandbox_sessions_industry"), "sandbox_sessions", ["industry"], unique=False)
    op.create_index(op.f("ix_sandbox_sessions_operator_id"), "sandbox_sessions", ["operator_id"], unique=False)
    op.create_index(op.f("ix_sandbox_sessions_scenario_id"), "sandbox_sessions", ["scenario_id"], unique=False)
    op.create_index(op.f("ix_sandbox_sessions_tenant_id"), "sandbox_sessions", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_sandbox_sessions_user_id"), "sandbox_sessions", ["user_id"], unique=False)
    op.create_index(op.f("ix_sandbox_sessions_verification_session_id"), "sandbox_sessions", ["verification_session_id"], unique=True)

    op.create_table(
        "webhook_deliveries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=True),
        sa.Column("tenant_id", sa.String(length=36), nullable=True),
        sa.Column("industry", sa.String(length=32), nullable=True),
        sa.Column("target_url", sa.String(length=512), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("response_snippet", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["session_id"], ["verification_sessions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id"),
    )
    op.create_index("ix_webhook_created", "webhook_deliveries", ["created_at"], unique=False)
    op.create_index("ix_webhook_status_next_retry", "webhook_deliveries", ["status", "next_retry_at"], unique=False)
    op.create_index(op.f("ix_webhook_deliveries_event_id"), "webhook_deliveries", ["event_id"], unique=True)
    op.create_index(op.f("ix_webhook_deliveries_event_type"), "webhook_deliveries", ["event_type"], unique=False)
    op.create_index(op.f("ix_webhook_deliveries_industry"), "webhook_deliveries", ["industry"], unique=False)
    op.create_index(op.f("ix_webhook_deliveries_session_id"), "webhook_deliveries", ["session_id"], unique=False)
    op.create_index(op.f("ix_webhook_deliveries_status"), "webhook_deliveries", ["status"], unique=False)
    op.create_index(op.f("ix_webhook_deliveries_tenant_id"), "webhook_deliveries", ["tenant_id"], unique=False)

    op.create_table(
        "automation_configs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("updated_by", sa.String(length=160), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("automation_configs")
    op.drop_table("webhook_deliveries")
    op.drop_table("sandbox_sessions")
