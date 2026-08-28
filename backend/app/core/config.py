"""All configuration and every business threshold.

Nothing in this codebase may hardcode a threshold. Trade marketing changes
"below 75% is critical" roughly monthly, and that must never require a code
change, let alone a model retrain.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_JWT_SECRET = "dev-secret-change-me-in-any-real-deployment"

# Every JWT secret that has ever been committed to this repository. The guard
# below rejects all of them, not just the field default: `.env.example` shipped
# "demo-secret-not-for-production-min-32-bytes" for months, so that is the
# string a real deployment is most likely to inherit by copying the example
# file — and the one the original guard did not catch.
COMMITTED_JWT_SECRETS = frozenset(
    {
        DEFAULT_JWT_SECRET,
        "demo-secret-not-for-production-min-32-bytes",
    }
)

# Environments where seeded demo accounts and committed secrets are acceptable.
# Anything else is somebody else's data.
DISPOSABLE_ENVIRONMENTS = frozenset({"local", "ci", "demo"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "shelfeye-api"
    app_version: str = "0.1.0"
    environment: Literal["local", "ci", "demo", "uat", "production"] = "local"

    database_url: str = "postgresql+asyncpg://shelfeye:shelfeye@localhost:5433/shelfeye"
    redis_url: str = "redis://localhost:6380/0"

    # Object storage — the API issues presigned URLs and never touches bytes.
    s3_endpoint_url: str = "http://localhost:9000"
    s3_public_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "shelfeye"
    s3_secret_key: str = "shelfeye123"
    s3_bucket: str = "shelfeye-raw"
    s3_region: str = "us-east-1"
    presign_expiry_seconds: int = 900

    # ── The ML boundary ──────────────────────────────────────────────────
    # Flipping this from "mock" to "http" is the ENTIRE change required to go
    # from fake detections to the real model. If anything else needs editing,
    # the boundary has leaked.
    ml_client: Literal["mock", "http"] = "http"
    ml_service_url: str = "http://localhost:8001"
    ml_timeout_seconds: float = 15.0
    ml_max_retries: int = 3
    ml_retry_backoff_seconds: tuple[int, ...] = (2, 8, 32)

    # ── Auth ─────────────────────────────────────────────────────────────
    jwt_secret: str = DEFAULT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    jwt_expiry_hours: int = 8

    # ── OSA business rules (B5) ──────────────────────────────────────────
    # Bumping analysis_config_version whenever any value below changes is what
    # keeps historic findings explainable: every shelf_analyses row records the
    # version that produced it.
    analysis_config_version: str = "v1"
    min_confidence: float = 0.35
    low_confidence_threshold: float = 0.55
    row_tolerance_ratio: float = 0.6
    critical_threshold: float = 0.75
    low_threshold: float = 0.90

    # ── Visit rules ──────────────────────────────────────────────────────
    gps_match_radius_meters: float = 150.0

    # ── Retention (columns exist; enforcement deferred) ──────────────────
    retention_days: int = 90

    @model_validator(mode="after")
    def _refuse_the_default_secret_outside_local(self) -> Settings:
        """Boot loudly rather than insecurely.

        Every secret in COMMITTED_JWT_SECRETS is in the repository, so anyone
        holding a clone can mint a valid ADMIN token against an instance that
        started with one. Silently accepting it is how that happens.

        `local`, `ci` and `demo` are exempt: they hold nobody's data, and
        making developers generate a secret to run the test suite is how the
        guard gets commented out instead of satisfied.
        """
        if self.environment in DISPOSABLE_ENVIRONMENTS:
            return self

        if self.jwt_secret in COMMITTED_JWT_SECRETS:
            raise ValueError(
                "JWT_SECRET is a value committed to this repository, so anyone "
                "with a clone can mint an ADMIN token. Generate one with "
                "`openssl rand -hex 32` before running with "
                f"ENVIRONMENT={self.environment}."
            )
        # `.env.example` ships JWT_SECRET blank so nobody inherits a working
        # one by copying it. Blank is not in COMMITTED_JWT_SECRETS, so without
        # this the copied file would sail past the check above and sign tokens
        # with the empty string — a weaker secret than the one being rejected.
        if len(self.jwt_secret) < 32:
            raise ValueError(
                "JWT_SECRET must be at least 32 characters "
                f"(got {len(self.jwt_secret)}). Generate one with "
                "`openssl rand -hex 32` before running with "
                f"ENVIRONMENT={self.environment}."
            )
        return self

    @property
    def sync_database_url(self) -> str:
        """Alembic and Celery use the sync driver."""
        return self.database_url.replace("+asyncpg", "")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
