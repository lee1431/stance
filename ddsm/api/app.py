"""Standalone DDSM API for the G10 server.

All routes live under /ddsm/api/. It does not import or modify the old DSD app.
Bearer tokens are used because llsshh.com and mrdindoin.ddns.net are cross-site.
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import closing
from pathlib import Path

from flask import Flask, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

PHONE_PATTERN = re.compile(r"^01[016789][0-9]{7,8}$")
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{40,200}$")
LOGIN_LIMIT = 8
WINDOW_SECONDS = 600
_throttle: dict[tuple[str, str], list[float]] = {}
_throttle_lock = threading.Lock()


def clean_phone(value: object) -> str:
    return re.sub(r"\D", "", value) if isinstance(value, str) else ""


def create_app() -> Flask:
    app = Flask(__name__)
    allowed_origin = os.environ.get("DDSM_ORIGIN", "https://llsshh.com").rstrip("/")
    db_path = Path(os.environ.get(
        "DDSM_DB_PATH", str(Path(__file__).resolve().parent / "ddsm.db")
    ))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024
    app.json.ensure_ascii = False

    def connect() -> sqlite3.Connection:
        db = sqlite3.connect(str(db_path), timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=10000")
        db.execute("PRAGMA foreign_keys=ON")
        return db

    with closing(connect()) as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS ddsm_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ddsm_tokens_expiry
                ON ddsm_tokens(expires_at);
        """)
        db.commit()

    @app.after_request
    def response_headers(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        if request.headers.get("Origin") == allowed_origin:
            response.headers["Access-Control-Allow-Origin"] = allowed_origin
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            response.headers["Access-Control-Max-Age"] = "3600"
            response.headers["Vary"] = "Origin"
        return response

    @app.before_request
    def verify_origin():
        origin = request.headers.get("Origin")
        if origin and origin != allowed_origin:
            return jsonify(ok=False, error="허용되지 않은 요청 출처입니다."), 403
        # CLI requests need no Origin; browser preflight is handled by Flask.
        if request.method == "OPTIONS":
            return app.make_default_options_response()

    def throttled(phone: str) -> bool:
        key = (request.remote_addr or "unknown", phone)
        now = time.monotonic()
        with _throttle_lock:
            recent = [t for t in _throttle.get(key, []) if t > now - WINDOW_SECONDS]
            _throttle[key] = recent
            if len(recent) >= LOGIN_LIMIT:
                return True
            recent.append(now)
            return False

    def token_digest():
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return None
        token = header[7:].strip()
        return hashlib.sha256(token.encode("ascii")).hexdigest() if TOKEN_PATTERN.fullmatch(token) else None

    def authenticated_user():
        digest = token_digest()
        if not digest:
            return None
        with closing(connect()) as db:
            row = db.execute(
                """SELECT u.id, u.phone FROM ddsm_tokens t
                   JOIN users u ON u.id=t.user_id
                   WHERE t.token_hash=? AND t.expires_at>?""",
                (digest, int(time.time())),
            ).fetchone()
        return dict(row) if row else None

    def body():
        value = request.get_json(silent=True)
        return value if isinstance(value, dict) else {}

    @app.get("/ddsm/api/health")
    def health():
        return jsonify(ok=True, service="ddsm", status="ready")

    @app.post("/ddsm/api/auth/register")
    def register():
        value = body()
        phone = clean_phone(value.get("phone"))
        password = value.get("password")
        if not PHONE_PATTERN.fullmatch(phone) or not isinstance(password, str) or not 1 <= len(password) <= 16:
            return jsonify(ok=False, error="전화번호와 1~16자 비밀번호를 확인하세요."), 400
        if throttled(phone):
            return jsonify(ok=False, error="가입 요청이 많습니다. 잠시 후 다시 시도하세요."), 429
        with closing(connect()) as db:
            try:
                db.execute(
                    "INSERT INTO users (phone, password_hash) VALUES (?,?)",
                    (phone, generate_password_hash(password, method="scrypt")),
                )
                db.commit()
            except sqlite3.IntegrityError:
                return jsonify(ok=False, error="이미 가입한 번호입니다. 로그인하세요."), 409
        return jsonify(ok=True, phone=phone), 201

    @app.post("/ddsm/api/auth/login")
    def login():
        value = body()
        phone = clean_phone(value.get("phone"))
        password = value.get("password")
        if not PHONE_PATTERN.fullmatch(phone) or not isinstance(password, str) or not 1 <= len(password) <= 16:
            return jsonify(ok=False, error="휴대폰 번호 또는 비밀번호를 확인하세요."), 400
        if throttled(phone):
            return jsonify(ok=False, error="로그인 시도가 많습니다. 잠시 후 다시 시도하세요."), 429
        with closing(connect()) as db:
            user = db.execute(
                "SELECT id,password_hash FROM users WHERE phone=?", (phone,)
            ).fetchone()
        if not user or not check_password_hash(user["password_hash"], password):
            return jsonify(ok=False, error="전화번호 또는 비밀번호가 일치하지 않습니다."), 401
        token = secrets.token_urlsafe(48)
        digest = hashlib.sha256(token.encode("ascii")).hexdigest()
        expires_at = int(time.time()) + 12 * 3600
        with closing(connect()) as db:
            db.execute("DELETE FROM ddsm_tokens WHERE expires_at<=?", (int(time.time()),))
            db.execute(
                "INSERT INTO ddsm_tokens(token_hash,user_id,expires_at) VALUES (?,?,?)",
                (digest, user["id"], expires_at),
            )
            db.commit()
        return jsonify(ok=True, phone=phone, access_token=token, expires_at=expires_at)

    @app.get("/ddsm/api/auth/me")
    def me():
        user = authenticated_user()
        if not user:
            return jsonify(ok=False, authenticated=False), 401
        return jsonify(ok=True, authenticated=True, phone=user["phone"])

    @app.post("/ddsm/api/auth/logout")
    def logout():
        digest = token_digest()
        if digest:
            with closing(connect()) as db:
                db.execute("DELETE FROM ddsm_tokens WHERE token_hash=?", (digest,))
                db.execute("DELETE FROM ddsm_admin_tokens WHERE token_hash=?", (digest,))
                db.commit()
        return jsonify(ok=True)

    from admin import install_admin
    from driver import install_driver
    install_admin(app, connect, authenticated_user, throttled, token_digest)
    install_driver(app, connect, authenticated_user)
    return app


app = create_app()
