"""Server-owned DSD workspace storage.

Register on the EXISTING authenticated Flask app, so identity and sessions are
shared with /api/auth/me. Nothing in this module creates public anonymous data.

Example:
    from workspace_api import register_workspace_api
    register_workspace_api(app, "/path/to/private/dsd-workspace.sqlite3",
                           url_prefix="/api")

The existing login must set session["user_id"] and session["csrf_token"], or
pass user_id_resolver / csrf_validator adapters matching existing auth.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Callable

from flask import Blueprint, jsonify, request, session

MAX_BYTES = 12 * 1024 * 1024
MAX_ENTRIES = 30000
MAX_VALUE_BYTES = 5 * 1024 * 1024


def register_workspace_api(
    app,
    db_path: str,
    *,
    url_prefix: str = "/api",
    user_id_resolver: Callable | None = None,
    csrf_validator: Callable | None = None,
):
    """Register one authenticated, revision-checked JSON workspace per user.

    This is the initial migration boundary, not a multi-user center sharing
    model. Center-level permissions require normalized tables in a next phase.
    """
    if not os.path.isabs(db_path):
        raise ValueError("db_path must be absolute and outside the public web root")
    os.makedirs(os.path.dirname(db_path), mode=0o700, exist_ok=True)

    def connect():
        db = sqlite3.connect(db_path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=10000")
        return db

    with connect() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute(
            """CREATE TABLE IF NOT EXISTS dsd_workspaces (
                user_id TEXT PRIMARY KEY,
                revision INTEGER NOT NULL CHECK (revision >= 1),
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )

    bp = Blueprint("dsd_workspace", __name__)

    def identity():
        value = user_id_resolver() if user_id_resolver else session.get("user_id")
        if not isinstance(value, (str, int)) or not str(value).strip():
            return None
        value = str(value)
        return value if len(value) <= 128 else None

    def allow_write():
        if csrf_validator:
            return bool(csrf_validator(request))
        expected = session.get("csrf_token")
        provided = request.headers.get("X-CSRF-Token", "")
        return (
            isinstance(expected, str)
            and len(expected) >= 16
            and isinstance(provided, str)
            and hmac.compare_digest(expected, provided)
        )

    def respond(payload, status=200):
        response = jsonify(payload)
        response.status_code = status
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    def validate(entries):
        if not isinstance(entries, dict) or len(entries) > MAX_ENTRIES:
            return "저장 항목 형식 또는 개수가 올바르지 않습니다."
        size = 0
        for key, value in entries.items():
            if (
                not isinstance(key, str)
                or len(key) > 256
                or not (key.startswith("dsd:") or key == "deliveryMapClientId")
                or not isinstance(value, str)
            ):
                return "DSD 저장 항목만 허용됩니다."
            encoded_size = len(value.encode("utf-8"))
            if encoded_size > MAX_VALUE_BYTES:
                return "개별 저장 항목이 너무 큽니다."
            size += encoded_size + len(key.encode("utf-8"))
            if size > MAX_BYTES:
                return "작업 공간 용량(12MB)을 초과했습니다."
        return None

    @bp.route("/workspace", methods=["GET", "PUT"])
    def workspace():
        user_id = identity()
        if user_id is None:
            return respond({"error": "로그인이 필요합니다."}, 401)

        if request.method == "GET":
            with connect() as db:
                row = db.execute(
                    "SELECT revision, payload, updated_at FROM dsd_workspaces WHERE user_id=?",
                    (user_id,),
                ).fetchone()
            if row is None:
                return respond({"revision": 0, "entries": {}, "updated_at": None})
            return respond({
                "revision": row["revision"],
                "entries": json.loads(row["payload"]),
                "updated_at": row["updated_at"],
            })

        if not allow_write():
            return respond({"error": "CSRF 검증에 실패했습니다."}, 403)
        if request.content_length is not None and request.content_length > MAX_BYTES + 1048576:
            return respond({"error": "요청 크기가 너무 큽니다."}, 413)
        if not request.is_json:
            return respond({"error": "JSON 요청만 허용됩니다."}, 415)
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return respond({"error": "JSON 형식이 올바르지 않습니다."}, 400)
        revision = body.get("revision")
        entries = body.get("entries")
        if type(revision) is not int or revision < 0:
            return respond({"error": "revision이 올바르지 않습니다."}, 400)
        invalid = validate(entries)
        if invalid:
            return respond({"error": invalid}, 400)

        payload = json.dumps(entries, ensure_ascii=False, separators=(",", ":"))
        if len(payload.encode("utf-8")) > MAX_BYTES:
            return respond({"error": "JSON 용량 제한을 초과했습니다."}, 413)
        digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        updated_at = datetime.now(timezone.utc).isoformat()
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT revision FROM dsd_workspaces WHERE user_id=?", (user_id,)
            ).fetchone()
            current = existing["revision"] if existing else 0
            if current != revision:
                db.rollback()
                return respond({
                    "error": "다른 기기에서 먼저 수정했습니다. 서버 자료를 다시 확인하세요.",
                    "code": "REVISION_CONFLICT",
                    "revision": current,
                }, 409)
            new_revision = current + 1
            if existing:
                db.execute(
                    """UPDATE dsd_workspaces
                       SET revision=?, payload=?, updated_at=? WHERE user_id=?""",
                    (new_revision, payload, updated_at, user_id),
                )
            else:
                db.execute(
                    """INSERT INTO dsd_workspaces(user_id, revision, payload, updated_at)
                       VALUES (?, ?, ?, ?)""",
                    (user_id, new_revision, payload, updated_at),
                )
            db.commit()

        return respond({
            "ok": True, "revision": new_revision,
            "updated_at": updated_at, "sha256": digest,
        })

    app.register_blueprint(bp, url_prefix=url_prefix)
    return bp
