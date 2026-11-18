"""DDSM authentication API (independent from the existing DSD server).

Install: pip install -r requirements.txt
Set DDSM_SECRET_KEY, DDSM_ORIGIN and DDSM_DB_PATH; serve behind HTTPS.
Proxy /ddsm/api/* to this Flask service without stripping the path.
"""
from __future__ import annotations

import hmac
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import closing
from datetime import timedelta
from pathlib import Path

from flask import Flask, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

PHONE_PATTERN = re.compile(r"^01[016789][0-9]{7,8}$")
LOGIN_LIMIT = 8
WINDOW_SECONDS = 600
_throttle: dict[tuple[str, str], list[float]] = {}
_throttle_lock = threading.Lock()


def clean_phone(value: object) -> str:
    return re.sub(r"\D", "", value) if isinstance(value, str) else ""


def create_app() -> Flask:
    app = Flask(__name__)
    secret_key = os.environ.get("DDSM_SECRET_KEY")
    if not secret_key or len(secret_key) < 32:
        raise RuntimeError("Set a random DDSM_SECRET_KEY (32+ characters) in the server environment.")
    app.config.update(
        SECRET_KEY=secret_key,
        SESSION_COOKIE_NAME="ddsm_auth",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_PATH="/ddsm/api",
        PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
        MAX_CONTENT_LENGTH=10 * 1024 * 1024,
        JSON_AS_ASCII=False,
    )
    allowed_origin = os.environ.get("DDSM_ORIGIN", "https://llsshh.com").rstrip("/")
    db_path = Path(os.environ.get("DDSM_DB_PATH", str(Path(__file__).resolve().parent / "ddsm.db")))
    db_path.parent.mkdir(parents=True, exist_ok=True)

    def connect() -> sqlite3.Connection:
        conn = sqlite3.connect(str(db_path), timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=10000")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    with closing(connect()) as db:
        db.execute(
            """CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"""
        )
        db.commit()

    @app.after_request
    def headers(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.before_request
    def same_origin():
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if request.headers.get("Origin") != allowed_origin:
                return jsonify(ok=False, error="요청 출처를 확인할 수 없습니다."), 403

    def body():
        value = request.get_json(silent=True)
        return value if isinstance(value, dict) else {}

    def throttled(phone: str) -> bool:
        # Basic single-process backstop; ALSO enable proxy/IP rate limiting
        # when running multiple workers or accepting public traffic.
        key = (request.remote_addr or "unknown", phone)
        now = time.monotonic()
        with _throttle_lock:
            recent = [x for x in _throttle.get(key, []) if x > now - WINDOW_SECONDS]
            _throttle[key] = recent
            if len(recent) >= LOGIN_LIMIT:
                return True
            recent.append(now)
            return False

    def require_session():
        user_id = session.get("uid")
        csrf = session.get("csrf")
        if not isinstance(user_id, int) or not csrf:
            return None
        return user_id

    @app.get("/ddsm/api/health")
    def health():
        return jsonify(ok=True, service="ddsm-auth", status="ready")

    @app.post("/ddsm/api/auth/register")
    def register():
        data = body()
        phone = clean_phone(data.get("phone"))
        password = data.get("password")
        if not PHONE_PATTERN.fullmatch(phone) or not isinstance(password, str) or not 1 <= len(password) <= 16:
            return jsonify(ok=False, error="휴대폰 번호와 1~16자 비밀번호를 확인하세요."), 400
        if throttled(phone):
            return jsonify(ok=False, error="요청이 많습니다. 잠시 후 다시 시도하세요."), 429
        hashed = generate_password_hash(password, method="scrypt")
        with closing(connect()) as db:
            try:
                cursor = db.execute("INSERT INTO users (phone, password_hash) VALUES (?, ?)", (phone, hashed))
                db.commit()
            except sqlite3.IntegrityError:
                return jsonify(ok=False, error="이미 가입된 번호입니다. 로그인해 주세요."), 409
            user_id = cursor.lastrowid
        session.clear()
        session["uid"] = user_id
        session["csrf"] = secrets.token_urlsafe(32)
        session.permanent = True
        return jsonify(ok=True, phone=phone, csrf=session["csrf"]), 201

    @app.post("/ddsm/api/auth/login")
    def login():
        data = body()
        phone = clean_phone(data.get("phone"))
        password = data.get("password")
        if not PHONE_PATTERN.fullmatch(phone) or not isinstance(password, str) or not 1 <= len(password) <= 16:
            return jsonify(ok=False, error="전화번호 또는 비밀번호를 확인하세요."), 400
        if throttled(phone):
            return jsonify(ok=False, error="요청이 많습니다. 잠시 후 다시 시도하세요."), 429
        with closing(connect()) as db:
            user = db.execute("SELECT id, password_hash FROM users WHERE phone = ?", (phone,)).fetchone()
        if not user or not check_password_hash(user["password_hash"], password):
            return jsonify(ok=False, error="전화번호 또는 비밀번호가 일치하지 않습니다."), 401
        session.clear()
        session["uid"] = int(user["id"])
        session["csrf"] = secrets.token_urlsafe(32)
        session.permanent = True
        return jsonify(ok=True, phone=phone, csrf=session["csrf"])

    @app.get("/ddsm/api/auth/me")
    def me():
        uid = require_session()
        if uid is None:
            return jsonify(ok=False, authenticated=False), 401
        with closing(connect()) as db:
            user = db.execute("SELECT phone FROM users WHERE id = ?", (uid,)).fetchone()
        if not user:
            session.clear()
            return jsonify(ok=False, authenticated=False), 401
        return jsonify(ok=True, authenticated=True, phone=user["phone"], csrf=session["csrf"])

    @app.post("/ddsm/api/auth/logout")
    def logout():
        uid = require_session()
        submitted = request.headers.get("X-CSRF-Token", "")
        if uid is None or not hmac.compare_digest(submitted, session["csrf"]):
            return jsonify(ok=False, error="인증이 필요합니다."), 403
        session.clear()
        return jsonify(ok=True)

    from admin import install_admin
    install_admin(app, connect, require_session, throttled)
    return app


# WSGI entrypoint for waitress.
app = create_app()
