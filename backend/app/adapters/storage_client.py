"""Object storage. The API issues presigned URLs; bytes never pass through it.

A shelf photo is 2-5 MB and reps upload eight of them per store in a burst.
Proxying that through the API process would turn a stateless service into a
bandwidth bottleneck for no benefit — the client can talk to S3 directly.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from uuid import UUID

import boto3
from botocore.client import Config

from app.core.config import settings


class StorageClient:
    def __init__(self) -> None:
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name=settings.s3_region,
            config=Config(signature_version="s3v4"),
        )
        # Presigned URLs are handed to a phone, which cannot resolve the
        # in-cluster hostname. Signing against the public endpoint keeps the
        # signature valid from outside.
        self._public = boto3.client(
            "s3",
            endpoint_url=settings.s3_public_endpoint_url,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name=settings.s3_region,
            config=Config(signature_version="s3v4"),
        )

    @staticmethod
    def build_object_key(capture_id: UUID, content_type: str, shelf_bay_label: str = "") -> str:
        """Date-partitioned key that keeps the bay label visible.

        The label is part of the key rather than metadata so an object in the
        bucket can be traced back to a shelf without a database lookup — and so
        the mock ML client, which selects its scenario from the URI, is
        reachable through the real API rather than only from unit tests.
        """
        ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}.get(
            content_type, "jpg"
        )
        slug = re.sub(r"[^A-Za-z0-9_-]+", "-", shelf_bay_label).strip("-").lower()
        now = datetime.now(UTC)
        prefix = f"{now:%Y/%m/%d}"
        return f"{prefix}/cap_{capture_id}{'_' + slug if slug else ''}.{ext}"

    def presign_put(self, object_key: str, content_type: str) -> str:
        return self._public.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": settings.s3_bucket,
                "Key": object_key,
                "ContentType": content_type,
            },
            ExpiresIn=settings.presign_expiry_seconds,
        )

    def presign_get(self, object_key: str) -> str:
        return self._public.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.s3_bucket, "Key": object_key},
            ExpiresIn=settings.presign_expiry_seconds,
        )

    @staticmethod
    def to_uri(object_key: str) -> str:
        """The form the ML service receives — it resolves this itself."""
        return f"s3://{settings.s3_bucket}/{object_key}"

    def ensure_bucket(self) -> None:
        buckets = {b["Name"] for b in self._client.list_buckets().get("Buckets", [])}
        if settings.s3_bucket not in buckets:
            self._client.create_bucket(Bucket=settings.s3_bucket)


_storage: StorageClient | None = None


def get_storage() -> StorageClient:
    global _storage
    if _storage is None:
        _storage = StorageClient()
    return _storage
