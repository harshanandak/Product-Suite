"""Replaceable storage boundary for hosted audio/object handling."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import boto3
from botocore.client import Config


def compute_retention_expires_at(retention_days: int, *, now: datetime | None = None) -> datetime | None:
    if retention_days < 0:
        return None
    if retention_days == 0:
        return now or datetime.now(timezone.utc)
    current_time = now or datetime.now(timezone.utc)
    return current_time + timedelta(days=retention_days)


def should_archive_raw_audio(settings: Any) -> bool:
    return settings.storage_backend != "local" and settings.raw_audio_retention_days != 0


@dataclass(frozen=True)
class StoredObject:
    backend: str
    storage_path: str
    download_url: str
    retention_expires_at: datetime | None


class StorageAdapter:
    backend = "local"

    def provider_ready(self) -> bool:
        return True

    def build_audio_object_key(self, *, meeting_id: str, chunk_index: int, filename: str) -> str:
        extension = Path(filename).suffix or ".bin"
        return f"meetings/{meeting_id}/audio/raw/{chunk_index:05d}-{uuid4().hex}{extension}"

    def store_audio_chunk(
        self,
        *,
        meeting_id: str,
        chunk_index: int,
        filename: str,
        content_type: str,
        payload: bytes,
        retention_days: int,
    ) -> StoredObject:
        raise NotImplementedError

    def create_audio_upload_target(
        self,
        *,
        meeting_id: str,
        filename: str,
        content_type: str,
        retention_days: int,
        expires_in_seconds: int = 900,
    ) -> dict[str, Any]:
        raise NotImplementedError


class LocalStorageAdapter(StorageAdapter):
    backend = "local"

    def __init__(self, *, base_path: str) -> None:
        self._base_path = Path(base_path)

    def store_audio_chunk(
        self,
        *,
        meeting_id: str,
        chunk_index: int,
        filename: str,
        content_type: str,
        payload: bytes,
        retention_days: int,
    ) -> StoredObject:
        object_key = self.build_audio_object_key(meeting_id=meeting_id, chunk_index=chunk_index, filename=filename)
        output_path = self._base_path / object_key
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(payload)
        retention_expires_at = compute_retention_expires_at(retention_days)
        return StoredObject(
            backend=self.backend,
            storage_path=object_key,
            download_url=output_path.resolve().as_uri(),
            retention_expires_at=retention_expires_at,
        )

    def create_audio_upload_target(
        self,
        *,
        meeting_id: str,
        filename: str,
        content_type: str,
        retention_days: int,
        expires_in_seconds: int = 900,
    ) -> dict[str, Any]:
        del content_type, retention_days, expires_in_seconds
        object_key = self.build_audio_object_key(meeting_id=meeting_id, chunk_index=0, filename=filename)
        output_path = (self._base_path / object_key).resolve()
        return {
            "backend": self.backend,
            "object_key": object_key,
            "upload_mode": "server-managed",
            "upload_url": output_path.as_uri(),
        }


class R2StorageAdapter(StorageAdapter):
    backend = "r2"

    def __init__(
        self,
        *,
        account_id: str,
        bucket_name: str,
        access_key_id: str,
        secret_access_key: str,
        public_base_url: str = "",
    ) -> None:
        self._account_id = account_id
        self._bucket_name = bucket_name
        self._public_base_url = public_base_url.rstrip("/")
        self._client = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            region_name="auto",
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            config=Config(signature_version="s3v4"),
        )

    def provider_ready(self) -> bool:
        return bool(self._account_id and self._bucket_name)

    def _resolve_download_url(self, object_key: str) -> str:
        if self._public_base_url:
            return f"{self._public_base_url}/{object_key}"
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket_name, "Key": object_key},
            ExpiresIn=900,
        )

    def store_audio_chunk(
        self,
        *,
        meeting_id: str,
        chunk_index: int,
        filename: str,
        content_type: str,
        payload: bytes,
        retention_days: int,
    ) -> StoredObject:
        object_key = self.build_audio_object_key(meeting_id=meeting_id, chunk_index=chunk_index, filename=filename)
        self._client.put_object(
            Bucket=self._bucket_name,
            Key=object_key,
            Body=payload,
            ContentType=content_type,
        )
        retention_expires_at = compute_retention_expires_at(retention_days)
        return StoredObject(
            backend=self.backend,
            storage_path=object_key,
            download_url=self._resolve_download_url(object_key),
            retention_expires_at=retention_expires_at,
        )

    def create_audio_upload_target(
        self,
        *,
        meeting_id: str,
        filename: str,
        content_type: str,
        retention_days: int,
        expires_in_seconds: int = 900,
    ) -> dict[str, Any]:
        del retention_days
        object_key = self.build_audio_object_key(meeting_id=meeting_id, chunk_index=0, filename=filename)
        upload_url = self._client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self._bucket_name,
                "Key": object_key,
                "ContentType": content_type,
            },
            ExpiresIn=expires_in_seconds,
        )
        return {
            "backend": self.backend,
            "object_key": object_key,
            "upload_mode": "direct",
            "upload_url": upload_url,
            "headers": {"Content-Type": content_type},
            "expires_in_seconds": expires_in_seconds,
        }


def build_storage_adapter(settings: Any) -> StorageAdapter:
    if settings.storage_backend == "r2":
        return R2StorageAdapter(
            account_id=settings.r2_account_id,
            bucket_name=settings.r2_bucket_name,
            access_key_id=settings.r2_access_key_id,
            secret_access_key=settings.r2_secret_access_key,
            public_base_url=settings.r2_public_base_url,
        )
    return LocalStorageAdapter(base_path=settings.storage_base_path)
