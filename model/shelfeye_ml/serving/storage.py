"""Object-store reader. The ML service fetches images itself, by URI."""

from __future__ import annotations

import os

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from shelfeye_ml.serving.preprocess import ImageNotFoundError


class S3Reader:
    def __init__(self) -> None:
        self._client = boto3.client(
            "s3",
            endpoint_url=os.environ.get("S3_ENDPOINT_URL", "http://localhost:9000"),
            aws_access_key_id=os.environ.get("S3_ACCESS_KEY", "shelfeye"),
            aws_secret_access_key=os.environ.get("S3_SECRET_KEY", "shelfeye123"),
            region_name=os.environ.get("S3_REGION", "us-east-1"),
            config=Config(signature_version="s3v4"),
        )

    def get_object(self, bucket: str, key: str) -> bytes:
        try:
            return self._client.get_object(Bucket=bucket, Key=key)["Body"].read()
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("NoSuchKey", "404", "NoSuchBucket"):
                raise ImageNotFoundError(f"s3://{bucket}/{key}") from exc
            raise
