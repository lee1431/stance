"""Standalone DDSM API for the G10 server.

All routes live under /ddsm/api/. It does not import or modify the old DSD app.
Bearer tokens are used because llsshh.com and mrdindoin.ddns.net are cross-site.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import closing
from pathlib import Path

from flask import Flask, g, has_request_context, jsonify, request
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
    # Explicit server configuration; never publish these secrets in GitHub.
    raw_centers = json.loads(os.environ.get("DDSM_CENTERS_JSON", "{}"))
    admin_key = os.environ.get("DDSM_ADMIN_ACCESS_KEY", "")
    key_pattern = re.compile(r"^[A-Za-z0-9_-]{43,128}$")
    center_pattern = re.compile(r"^[a-zA-Z0-9-]{1,40}$")
    if not isinstance(raw_centers, dict):
        raise ValueError("DDSM_CENTERS_JSON must be an object")
    centers = {}
    for cid, config in raw_centers.items():
        if not center_pattern.fullmatch(cid) or not isinstance(config, dict) or not key_pattern.fullmatch(config.get("invite", "")):
            raise ValueError("Invalid DDSM center configuration")
        centers[cid] = {"name": str(config.get("name") or cid)[:100], "invite": config["invite"]}
    if centers and not key_pattern.fullmatch(admin_key):
        raise ValueError("DDSM_ADMIN_ACCESS_KEY must be a strong random key")
    center_dir = db_path.parent / (db_path.name + ".centers")
    center_dir.mkdir(mode=0o700, exist_ok=True)
    legacy_enabled = os.environ.get("DDSM_ENABLE_LEGACY_AUTH", "0") == "1"
    app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024
    app.json.ensure_ascii = False
    # Short-lived codes for the single Waitress process; reset on restart.
    code_lock = threading.Lock()
    center_codes = {}  # center -> (code, expiry)
    failed_codes = []
    CODE_TTL = 600
    CODE_FAILURE_LIMIT = 30

    def connect() -> sqlite3.Connection:
        path = getattr(g, "center_db", db_path) if has_request_context() else db_path
        db = sqlite3.connect(str(path), timeout=10)
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
        path = request.path
        header = request.headers.get("Authorization", "")
        token = header[7:] if header.startswith("Bearer ") else ""
        if path in ("/ddsm/api/health", "/ddsm/api/connection/centers", "/ddsm/api/connection/driver", "/ddsm/api/connection/code-login"):
            return None
        match = re.fullmatch(r"(a|d)_([A-Za-z0-9-]{1,40})_([A-Za-z0-9_-]{43,128})", token)
        if match:
            role, cid, key = match.groups()
            if cid not in centers:
                return jsonify(ok=False, error="등록되지 않은 센터입니다."), 403
            if role == "a" and not hmac.compare_digest(key, admin_key):
                return jsonify(ok=False, error="관리자 연결 권한이 없습니다."), 403
            g.center_db = center_dir / (cid + ".sqlite")
            g.center_role = role
            g.center_id = cid
            if path.startswith("/ddsm/api/auth/") or path == "/ddsm/api/admin/unlock":
                return jsonify(ok=False, error="기존 계정 API는 사용할 수 없습니다."), 404
            if role == "a" and path.startswith("/ddsm/api/driver/"):
                return jsonify(ok=False, error="기사 연결 링크를 사용하세요."), 403
        elif not legacy_enabled:
            return jsonify(ok=False, error="센터 연결 링크로 처음 한 번 연결하세요."), 401

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
        role = getattr(g, "center_role", None)
        if role == "a":
            return {"id": 1, "center_admin": True}
        if role == "d":
            digest = hashlib.sha256(request.headers["Authorization"][7:].encode("ascii")).hexdigest()
            with closing(connect()) as db:
                row = db.execute("SELECT user_id FROM ddsm_device_tokens WHERE token_hash=?", (digest,)).fetchone()
            return {"id": row[0], "center_admin": False} if row else None
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
        return jsonify(ok=True, service="ddsm", status="ready", center_connection=True, center_code_login=True)

    @app.get("/ddsm/api/connection/centers")
    def list_centers():
        header = request.headers.get("Authorization", "")
        if not admin_key or not header.isascii() or not hmac.compare_digest(header, "Bearer adm_" + admin_key):
            return jsonify(ok=False, error="관리자 연결 링크가 필요합니다."), 403
        return jsonify(ok=True, centers=[{"id": cid, "name": config["name"], "invite": config["invite"]} for cid, config in centers.items()])

    @app.post("/ddsm/api/connection/driver")
    def connect_driver():
        value = body()
        cid, invite, device = value.get("center"), value.get("invite"), value.get("device")
        if not isinstance(cid, str) or cid not in centers or not isinstance(invite, str) or not isinstance(device, str) or not key_pattern.fullmatch(device):
            return jsonify(ok=False, error="기사 연결 정보가 올바르지 않습니다."), 400
        if not key_pattern.fullmatch(invite) or not hmac.compare_digest(invite, centers[cid]["invite"]):
            return jsonify(ok=False, error="유효하지 않은 기사 연결 링크입니다."), 403
        return register_device(cid, device)

    @app.post("/ddsm/api/connection/code")
    def issue_center_code():
        if getattr(g, "center_role", None) != "a":
            return jsonify(ok=False, error="센터 관리자 권한이 필요합니다."), 403
        cid = g.center_id
        now = int(time.time())
        with code_lock:
            active = center_codes.get(cid)
            if active and active[1] > now and body().get("renew") is not True:
                code, expires = active
            else:
                used = {entry[0] for entry in center_codes.values() if entry[1] > now}
                code = f"{secrets.randbelow(100000000):08d}"
                while code in used:
                    code = f"{secrets.randbelow(100000000):08d}"
                expires = now + CODE_TTL
                center_codes[cid] = (code, expires)
        return jsonify(ok=True, center=cid, name=centers[cid]["name"], code=code, expires_at=expires)

    @app.post("/ddsm/api/connection/code-login")
    def login_center_code():
        value = body()
        code, device = value.get("code"), value.get("device")
        if not isinstance(code, str) or not re.fullmatch(r"[0-9]{8}", code):
            return jsonify(ok=False, error="숫자 8자리 센터 코드를 입력하세요."), 400
        if device is not None and (not isinstance(device, str) or not re.fullmatch(r"[a-f0-9]{64}", device)):
            return jsonify(ok=False, error="기기 연결 정보가 올바르지 않습니다."), 400
        now = int(time.time())
        with code_lock:
            # Global failed-guess budget, independent of proxy IP headers.
            failed_codes[:] = [t for t in failed_codes if t > now - CODE_TTL]
            if len(failed_codes) >= CODE_FAILURE_LIMIT:
                return jsonify(ok=False, error="인증 시도가 많습니다. 잠시 후 다시 시도하세요."), 429
            cid = next((c for c, (k, expiry) in center_codes.items()
                        if expiry > now and hmac.compare_digest(k, code)), None)
            if cid is None:
                failed_codes.append(now)
                return jsonify(ok=False, error="센터 코드가 틀렸거나 만료되었습니다."), 403
        # Resolve center first to reuse the existing per-center device identity.
        # Never return the permanent invitation secret.
        if device is None:
            return jsonify(ok=True, center=cid, name=centers[cid]["name"])
        return register_device(cid, device)

    def register_device(cid, device):
        g.center_db = center_dir / (cid + ".sqlite")
        token = "d_" + cid + "_" + device
        digest = hashlib.sha256(token.encode("ascii")).hexdigest()
        with closing(connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT user_id FROM ddsm_device_tokens WHERE token_hash=?", (digest,)).fetchone()
            if not row:
                if db.execute("SELECT COUNT(*) FROM ddsm_device_tokens").fetchone()[0] >= 5000:
                    return jsonify(ok=False, error="센터 기기 등록 한도를 초과했습니다."), 503
                user_id = db.execute("INSERT INTO users(phone,password_hash) VALUES (?, '!')", ("device:" + digest,)).lastrowid
                db.execute("INSERT INTO ddsm_device_tokens(token_hash,user_id) VALUES (?,?)", (digest,user_id))
            db.commit()
        return jsonify(ok=True, token=token, center=cid, name=centers[cid]["name"])

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

    from admin import initialize
    # Each center has an independent database, including its address registry.
    for cid in centers:
        path = center_dir / (cid + ".sqlite")
        if not path.exists():
            try:
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                os.close(fd)
            except FileExistsError:
                pass
        with closing(sqlite3.connect(str(path), timeout=10)) as db:
            db.execute("PRAGMA foreign_keys=ON")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS ddsm_device_tokens (
                    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS ddsm_driver_days (
                    user_id INTEGER NOT NULL REFERENCES users(id), delivery_date TEXT NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 0, day_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id, delivery_date)
                );
            """)
            db.execute("INSERT OR IGNORE INTO users(id,phone,password_hash) VALUES(1,'center-admin','!')")
            initialize(db)
            db.commit()
    return app


app = create_app()
