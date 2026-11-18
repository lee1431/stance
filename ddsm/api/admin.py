"""DDSM center-only Excel import, recurring destination registry, and daily map APIs.

Importing this module never exposes delivery data: every endpoint requires a
server-approved administrator and a separate administrator password.
"""
from __future__ import annotations

import csv
import hashlib
import hmac
import io
import json
import os
import re
import sqlite3
import unicodedata
from datetime import date as date_type, datetime
from itertools import islice

from flask import jsonify, request, session
from werkzeug.security import check_password_hash

MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_ROWS = 15000
MAX_COLUMNS = 160
MAX_SHEETS = 20

# Canonical labels: unrecognized spreadsheet columns remain available in raw_json.
ALIASES = {
    "waybill": ["운송장번호", "운송장", "송장번호", "송장", "화물번호", "바코드", "trackingnumber", "trackingno", "waybill", "invoice"],
    "address": ["수취인주소", "수령인주소", "받는분주소", "받는사람주소", "배송지주소", "도착주소", "배달주소", "배송주소", "주소", "도로명주소", "지번주소", "destinationaddress"],
    "recipient": ["수취인명", "수취인", "수령인명", "수령인", "받는분", "받는사람", "받을사람", "상호명", "거래처명", "업체명", "납품처", "배송처", "고객명", "recipient", "consignee", "receiver", "customer"],
    "sender": ["발송인명", "발송인", "보내는분", "보내는사람", "송하인", "출고처", "송화인", "sender", "shipper"],
    "phone": ["수취인전화번호", "수취인연락처", "받는분전화", "받는분연락처", "연락처", "핸드폰", "휴대폰번호", "전화번호", "수령인전화", "receiverphone", "consigneephone"],
    "item": ["물품명", "품목명", "상품명", "제품명", "내용품", "내용물", "품명", "품목", "itemname", "productname", "description"],
    "cod": ["착불금액", "착불비용", "착불운임", "착불액", "받을금액", "수금액", "codamount", "cod"],
    "driver": ["배정기사", "담당기사", "배송기사", "배달기사", "기사명", "배정자", "driver"],
    "status": ["배송상태", "배송여부", "완료여부", "배송완료", "처리상태", "상태", "deliverystatus"],
}
LABEL_INDEX = {}
for _field, _names in ALIASES.items():
    for _name in _names:
        LABEL_INDEX[re.sub(r"[\W_]+", "", _name.casefold())] = _field


def compact(text):
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", str(text or "")).casefold())


def cell_text(value):
    if value is None:
        return ""
    if isinstance(value, (datetime, date_type)):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()[:2048]


def canonical_key(header):
    label = compact(header)
    if label in LABEL_INDEX:
        return LABEL_INDEX[label]
    # A qualified heading such as '받는분(상호명)' should still map.
    candidates = [(len(alias), field) for alias, field in LABEL_INDEX.items()
                  if len(alias) >= 3 and alias in label]
    return max(candidates, default=(0, None))[1]


def pick_columns(headers):
    result = {}
    # Exact matches first; qualified matches are secondary.
    for index, header in enumerate(headers):
        field = LABEL_INDEX.get(compact(header))
        if field and field not in result:
            result[field] = index
    for index, header in enumerate(headers):
        field = canonical_key(header)
        if field and field not in result:
            result[field] = index
    return result


def unique_headers(values):
    result, used = [], {}
    for index, value in enumerate(values):
        header = cell_text(value).strip() or f"컬럼 {index + 1}"
        seen = used.get(header, 0) + 1
        used[header] = seen
        result.append(header if seen == 1 else f"{header} ({seen})")
    return result


def parse_grid(sheet_name, rows):
    sample = list(islice(rows, 15))
    if not sample:
        return []
    candidates = []
    for index, row in enumerate(sample):
        nonempty = sum(bool(cell_text(x)) for x in row)
        aliases = sum(bool(canonical_key(cell_text(x))) for x in row if cell_text(x))
        if nonempty:
            candidates.append((aliases * 20 + min(nonempty, 15), -index, index))
    if not candidates:
        return []
    header_at = max(candidates)[2]
    raw_headers = list(sample[header_at])
    if len(raw_headers) > MAX_COLUMNS:
        raise ValueError(f"{sheet_name}: 열이 {MAX_COLUMNS}개를 초과합니다.")
    headers = unique_headers(raw_headers)
    fields = pick_columns(headers)
    outputs = []
    def walk():
        for offset, row in enumerate(sample[header_at + 1:], start=header_at + 2):
            yield offset, row
        for offset, row in enumerate(rows, start=len(sample) + 1):
            yield offset, row
    for row_number, values in walk():
        if len(values) > MAX_COLUMNS and any(cell_text(v) for v in values[MAX_COLUMNS:]):
            raise ValueError(f"{sheet_name}: 원본에 과도한 열이 있습니다.")
        cells = [cell_text(values[i]) if i < len(values) else "" for i in range(len(headers))]
        if not any(cells):
            continue
        # Ignore exact repeated header rows, not arbitrary unrecognized columns.
        if cells == headers:
            continue
        row = dict(zip(headers, cells))
        standard = {field: cells[i] for field, i in fields.items()}
        outputs.append({"sheet": sheet_name, "row_number": row_number, "raw": row, "standard": standard})
        if len(outputs) > MAX_ROWS:
            raise ValueError("파일당 최대 15,000행을 초과했습니다.")
    return outputs


def parse_file(filename, content):
    name = filename.lower()
    outputs = []
    if name.endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True, keep_links=False)
        try:
            for sheet in wb.worksheets[:MAX_SHEETS]:
                outputs.extend(parse_grid(sheet.title, iter(sheet.values)))
                if len(outputs) > MAX_ROWS:
                    raise ValueError("파일당 최대 15,000행을 초과했습니다.")
            if len(wb.worksheets) > MAX_SHEETS:
                raise ValueError("시트는 최대 20개까지 가져올 수 있습니다.")
        finally:
            wb.close()
    elif name.endswith(".xls"):
        import xlrd
        book = xlrd.open_workbook(file_contents=content)
        if book.nsheets > MAX_SHEETS:
            raise ValueError("시트는 최대 20개까지 가져올 수 있습니다.")
        for sheet in book.sheets():
            outputs.extend(parse_grid(sheet.name, (sheet.row_values(i) for i in range(sheet.nrows))))
            if len(outputs) > MAX_ROWS:
                raise ValueError("파일당 최대 15,000행을 초과했습니다.")
    elif name.endswith(".csv"):
        csv_text = None
        for encoding in ("utf-8-sig", "cp949", "euc-kr"):
            try:
                csv_text = content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        if csv_text is None:
            raise ValueError("CSV 인코딩을 읽을 수 없습니다. UTF-8 또는 CP949를 이용하세요.")
        outputs.extend(parse_grid("CSV", csv.reader(io.StringIO(csv_text))))
    else:
        raise ValueError("XLSX, XLSM, XLS, CSV 파일만 지원합니다.")
    if not outputs:
        raise ValueError("가져올 데이터 행이 없습니다. 엑셀 헤더와 내용을 확인하세요.")
    return outputs


def valid_date(text):
    if not isinstance(text, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return False
    try:
        return date_type.fromisoformat(text).isoformat() == text
    except ValueError:
        return False


def destination_id_for(db, name, address):
    normalized_name = compact(name)
    normalized_address = compact(address)
    if normalized_address:
        identity = hashlib.sha256((normalized_address + "|" + normalized_name).encode("utf-8")).hexdigest()
        db.execute(
            """INSERT INTO destinations (identity_key, business_name, address, name_key, address_key,
                         last_seen_at)
               VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(identity_key) DO UPDATE SET last_seen_at=CURRENT_TIMESTAMP""",
            (identity, name, address, normalized_name, normalized_address),
        )
        return db.execute("SELECT id FROM destinations WHERE identity_key=?", (identity,)).fetchone()[0]
    if normalized_name:
        # Business-only entries: only auto-link when EXACTLY one historic destination
        # with the same name exists. Never silently choose between homonyms.
        rows = db.execute("SELECT id FROM destinations WHERE name_key=? LIMIT 2", (normalized_name,)).fetchall()
        if len(rows) == 1:
            return rows[0][0]
    return None


def initialize(db):
    db.executescript(
        """CREATE TABLE IF NOT EXISTS destinations (
            id INTEGER PRIMARY KEY,
            identity_key TEXT NOT NULL UNIQUE,
            business_name TEXT NOT NULL DEFAULT '',
            address TEXT NOT NULL,
            name_key TEXT NOT NULL,
            address_key TEXT NOT NULL,
            lat REAL, lng REAL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_destination_name ON destinations(name_key);
        CREATE TABLE IF NOT EXISTS import_batches (
            id INTEGER PRIMARY KEY,
            delivery_date TEXT NOT NULL,
            filename TEXT NOT NULL,
            total_rows INTEGER NOT NULL,
            uploaded_by INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS admin_deliveries (
            id INTEGER PRIMARY KEY,
            delivery_date TEXT NOT NULL,
            row_key TEXT NOT NULL,
            waybill TEXT NOT NULL DEFAULT '',
            business_name TEXT NOT NULL DEFAULT '',
            sender_name TEXT NOT NULL DEFAULT '',
            source_address TEXT NOT NULL DEFAULT '',
            recipient_phone TEXT NOT NULL DEFAULT '',
            item_name TEXT NOT NULL DEFAULT '',
            cod_amount TEXT NOT NULL DEFAULT '',
            driver_name TEXT NOT NULL DEFAULT '',
            delivery_status TEXT NOT NULL DEFAULT '',
            destination_id INTEGER REFERENCES destinations(id),
            raw_json TEXT NOT NULL,
            sheet_name TEXT NOT NULL,
            source_row INTEGER NOT NULL,
            source_file TEXT NOT NULL,
            import_id INTEGER REFERENCES import_batches(id),
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(delivery_date, row_key)
        );
        CREATE INDEX IF NOT EXISTS idx_delivery_date ON admin_deliveries(delivery_date);
        CREATE INDEX IF NOT EXISTS idx_delivery_destination ON admin_deliveries(destination_id);"""
    )


def install_admin(app, connect, require_session, throttled):
    with connect() as db:
        initialize(db)
        db.commit()

    admin_phones = {
        re.sub(r"\D", "", p) for p in os.getenv("DDSM_ADMIN_PHONES", "").split(",") if p.strip()
    }
    admin_hash = os.getenv("DDSM_ADMIN_PASSWORD_HASH", "")

    def auth():
        uid = require_session()
        if uid is None:
            return None
        with connect() as db:
            user = db.execute("SELECT phone FROM users WHERE id=?", (uid,)).fetchone()
        if not user or user["phone"] not in admin_phones or session.get("ddsm_admin") is not True:
            return None
        return uid

    def protected():
        if auth() is None:
            return jsonify(ok=False, error="관리자 로그인이 필요합니다."), 403
        return None

    def writable():
        denied = protected()
        if denied:
            return denied
        supplied = request.headers.get("X-CSRF-Token", "")
        expected = session.get("csrf", "")
        if not supplied or not expected or not hmac.compare_digest(supplied, expected):
            return jsonify(ok=False, error="요청 검증 토큰이 올바르지 않습니다."), 403
        return None

    @app.get("/ddsm/api/admin/me")
    def admin_me():
        uid = auth()
        return (jsonify(ok=True, admin=True, csrf=session.get("csrf")) if uid
                else (jsonify(ok=False, admin=False), 403))

    @app.post("/ddsm/api/admin/unlock")
    def admin_unlock():
        uid = require_session()
        if uid is None:
            return jsonify(ok=False, error="사용자 로그인이 필요합니다."), 401
        with connect() as db:
            user = db.execute("SELECT phone FROM users WHERE id=?", (uid,)).fetchone()
        if not user or user["phone"] not in admin_phones:
            return jsonify(ok=False, error="관리자 권한이 없습니다."), 403
        data = request.get_json(silent=True) or {}
        password = data.get("admin_password")
        if not admin_hash or not isinstance(password, str) or len(password) > 128:
            return jsonify(ok=False, error="서버의 관리자 인증 설정을 확인하세요."), 503
        if throttled(user["phone"] + ":admin"):
            return jsonify(ok=False, error="요청이 많습니다. 잠시 후 다시 시도하세요."), 429
        if not check_password_hash(admin_hash, password):
            return jsonify(ok=False, error="관리자 인증이 올바르지 않습니다."), 401
        session["ddsm_admin"] = True
        return jsonify(ok=True, admin=True, csrf=session["csrf"])

    @app.get("/ddsm/api/admin/deliveries")
    def admin_deliveries():
        denied = protected()
        if denied:
            return denied
        target = request.args.get("date", "")
        if not valid_date(target):
            return jsonify(ok=False, error="날짜가 올바르지 않습니다."), 400
        with connect() as db:
            rows = db.execute(
                """SELECT s.*, d.address AS registry_address, d.lat, d.lng, d.business_name AS registry_name
                   FROM admin_deliveries s
                   LEFT JOIN destinations d ON d.id = s.destination_id
                   WHERE s.delivery_date = ?
                   ORDER BY s.id ASC LIMIT ?""", (target, MAX_ROWS)
            ).fetchall()
            latest = db.execute(
                """SELECT filename, created_at FROM import_batches
                   WHERE delivery_date=? ORDER BY id DESC LIMIT 1""", (target,)
            ).fetchone()
        output, headers = [], []
        for row in rows:
            obj = dict(row)
            obj["raw"] = json.loads(obj.pop("raw_json"))
            obj["address"] = obj["source_address"] or obj["registry_address"] or ""
            obj["located"] = obj["lat"] is not None and obj["lng"] is not None
            obj["registered"] = obj["destination_id"] is not None
            for column in obj["raw"]:
                if column not in headers:
                    headers.append(column)
            output.append(obj)
        return jsonify(
            ok=True, date=target, total=len(output),
            located=sum(bool(r["located"]) for r in output),
            unlocated=sum(not r["located"] for r in output),
            columns=headers, rows=output, last_import=dict(latest) if latest else None
        )

    @app.post("/ddsm/api/admin/import")
    def admin_import():
        denied = writable()
        if denied:
            return denied
        target = request.form.get("date", "")
        if not valid_date(target):
            return jsonify(ok=False, error="날짜가 올바르지 않습니다."), 400
        upload = request.files.get("file")
        if not upload or not upload.filename:
            return jsonify(ok=False, error="원본 엑셀 파일을 선택하세요."), 400
        filename = upload.filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1][:160]
        try:
            blob = upload.stream.read(MAX_FILE_BYTES + 1)
            if len(blob) > MAX_FILE_BYTES:
                return jsonify(ok=False, error="파일은 8MB 이하만 업로드 가능합니다."), 413
            parsed = parse_file(filename, blob)
        except Exception as exc:
            return jsonify(ok=False, error="파일 분석 실패: " + str(exc)[:220]), 400

        added = updated = 0
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            batch = db.execute(
                """INSERT INTO import_batches (delivery_date, filename, total_rows, uploaded_by)
                   VALUES (?, ?, ?, ?)""", (target, filename, len(parsed), auth())
            ).lastrowid
            for item in parsed:
                std = item["standard"]
                raw = json.dumps(item["raw"], ensure_ascii=False, separators=(",", ":"))
                waybill = std.get("waybill", "").replace(" ", "")
                business = std.get("recipient", "").strip()
                address = std.get("address", "").strip()
                destination_id = destination_id_for(db, business, address)
                signature = ("wb:" + compact(waybill)) if waybill else (
                    "row:" + hashlib.sha256(
                        (item["sheet"] + "|" + str(item["row_number"]) + "|" + raw).encode()
                    ).hexdigest()
                )
                params = (
                    target, signature, waybill, business, std.get("sender", ""), address,
                    std.get("phone", ""), std.get("item", ""), std.get("cod", ""),
                    std.get("driver", ""), std.get("status", ""), destination_id, raw,
                    item["sheet"], item["row_number"], filename, batch
                )
                existed = db.execute(
                    "SELECT id FROM admin_deliveries WHERE delivery_date=? AND row_key=?",
                    (target, signature)
                ).fetchone()
                db.execute(
                    """INSERT INTO admin_deliveries
                       (delivery_date, row_key, waybill, business_name, sender_name,
                        source_address, recipient_phone, item_name, cod_amount,
                        driver_name, delivery_status, destination_id, raw_json,
                        sheet_name, source_row, source_file, import_id)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(delivery_date, row_key) DO UPDATE SET
                        waybill=excluded.waybill, business_name=excluded.business_name,
                        sender_name=excluded.sender_name, source_address=excluded.source_address,
                        recipient_phone=excluded.recipient_phone, item_name=excluded.item_name,
                        cod_amount=excluded.cod_amount, driver_name=excluded.driver_name,
                        delivery_status=excluded.delivery_status,
                        destination_id=COALESCE(excluded.destination_id, admin_deliveries.destination_id),
                        raw_json=excluded.raw_json, sheet_name=excluded.sheet_name,
                        source_row=excluded.source_row, source_file=excluded.source_file,
                        import_id=excluded.import_id, updated_at=CURRENT_TIMESTAMP""",
                    params
                )
                if existed:
                    updated += 1
                else:
                    added += 1
            db.commit()
        return jsonify(ok=True, date=target, imported=len(parsed), added=added, updated=updated)

    @app.get("/ddsm/api/admin/destinations")
    def admin_destinations():
        denied = protected()
        if denied:
            return denied
        query = compact(request.args.get("q", ""))[:80]
        if not query:
            return jsonify(ok=True, destinations=[])
        with connect() as db:
            rows = db.execute(
                """SELECT id, business_name, address, lat, lng FROM destinations
                   WHERE name_key LIKE ? OR address_key LIKE ?
                   ORDER BY last_seen_at DESC LIMIT 30""",
                ("%" + query + "%", "%" + query + "%")
            ).fetchall()
        return jsonify(ok=True, destinations=[dict(r) for r in rows])

    @app.post("/ddsm/api/admin/deliveries/<int:shipment_id>/location")
    def update_location(shipment_id):
        denied = writable()
        if denied:
            return denied
        data = request.get_json(silent=True) or {}
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            shipment = db.execute("SELECT * FROM admin_deliveries WHERE id=?", (shipment_id,)).fetchone()
            if not shipment:
                return jsonify(ok=False, error="배송 목록을 찾을 수 없습니다."), 404
            chosen_id = data.get("destination_id")
            if chosen_id is not None:
                if not isinstance(chosen_id, int):
                    return jsonify(ok=False, error="배송지 번호를 확인하세요."), 400
                dest = db.execute("SELECT id FROM destinations WHERE id=?", (chosen_id,)).fetchone()
                if not dest:
                    return jsonify(ok=False, error="저장된 배송지를 찾을 수 없습니다."), 404
            else:
                address = str(data.get("address") or shipment["source_address"]).strip()[:250]
                business = str(data.get("business_name") or shipment["business_name"]).strip()[:160]
                if not address:
                    return jsonify(ok=False, error="배송지 주소를 입력하세요."), 400
                chosen_id = destination_id_for(db, business, address)
            lat, lng = data.get("lat"), data.get("lng")
            if lat is not None or lng is not None:
                if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)) or not -90 <= lat <= 90 or not -180 <= lng <= 180:
                    return jsonify(ok=False, error="위도·경도 값이 올바르지 않습니다."), 400
                db.execute("UPDATE destinations SET lat=?, lng=?, last_seen_at=CURRENT_TIMESTAMP WHERE id=?",
                           (lat, lng, chosen_id))
            db.execute(
                """UPDATE admin_deliveries SET destination_id=?, updated_at=CURRENT_TIMESTAMP
                   WHERE id=?""", (chosen_id, shipment_id)
            )
            db.commit()
        return jsonify(ok=True, destination_id=chosen_id)

    return app
