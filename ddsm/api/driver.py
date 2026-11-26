"""DDSM driver API: exact waybill lookup and per-account/per-day work sync."""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
from contextlib import closing
from datetime import date as date_type

from flask import jsonify, request


def valid_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        return date_type.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def empty_day():
    return {"selected": 1, "rounds": [{"no": 1, "stops": []}]}


def normalize_day(value):
    if not isinstance(value, dict):
        raise ValueError("배송 작업 데이터 형식 오류")
    raw_rounds = value.get("rounds")
    if not isinstance(raw_rounds, list) or not 1 <= len(raw_rounds) <= 100:
        raise ValueError("회차는 1~100개여야 합니다.")
    rounds, round_numbers, total = [], set(), 0
    for raw_round in raw_rounds:
        if not isinstance(raw_round, dict):
            raise ValueError("회차 형식 오류")
        number = raw_round.get("no")
        if type(number) is not int or number < 1 or number > 100 or number in round_numbers:
            raise ValueError("회차 번호 오류 또는 중복")
        round_numbers.add(number)
        raw_stops = raw_round.get("stops")
        if not isinstance(raw_stops, list) or len(raw_stops) > 5000:
            raise ValueError("배송지 목록 형식 오류")
        total += len(raw_stops)
        if total > 5000:
            raise ValueError("배송지 하루 최대 5,000건")
        stops, seen_ids, seen_waybills = [], set(), set()
        for item in raw_stops:
            if not isinstance(item, dict):
                raise ValueError("배송지 형식 오류")
            uid = item.get("id")
            waybill = item.get("waybill")
            if not isinstance(uid, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", uid):
                raise ValueError("배송지 ID 오류")
            if not isinstance(waybill, str) or not 4 <= len(waybill) <= 100 or re.search(r"[\x00-\x1f<>]", waybill):
                raise ValueError("운송장번호 오류")
            if uid in seen_ids or waybill in seen_waybills:
                raise ValueError("동일 회차에 중복 배송지가 있습니다.")
            seen_ids.add(uid)
            seen_waybills.add(waybill)
            stop = {"id": uid, "waybill": waybill}
            for key, limit in (("recipient", 100), ("address", 250), ("phone", 25),
                               ("memo", 500), ("createdAt", 80)):
                raw = item.get(key, "")
                if not isinstance(raw, str):
                    raise ValueError("배송지 문자 필드 오류")
                stop[key] = raw[:limit]
            stop["status"] = "done" if item.get("status") == "done" else "pending"
            items = item.get("scannedItems", [])
            if not isinstance(items, list) or len(items) > 999:
                raise ValueError("스캔 물품 목록 오류")
            if any(not isinstance(v, str) or not re.fullmatch(r"\d{3}", v) for v in items):
                raise ValueError("물품번호 형식 오류")
            stop["scannedItems"] = list(dict.fromkeys(items))
            lat, lng = item.get("lat"), item.get("lng")
            if lat is not None or lng is not None:
                if (type(lat) not in (int, float) or type(lng) not in (int, float)
                        or not -90 <= lat <= 90 or not -180 <= lng <= 180):
                    raise ValueError("좌표 오류")
                stop["lat"], stop["lng"] = lat, lng
            stops.append(stop)
        rounds.append({"no": number, "stops": stops})
    selected = value.get("selected")
    if type(selected) is not int or selected not in round_numbers:
        selected = rounds[0]["no"]
    return {"selected": selected, "rounds": rounds}


def install_driver(app, connect, authenticated_user):
    with closing(connect()) as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS ddsm_driver_days (
                user_id INTEGER NOT NULL REFERENCES users(id),
                delivery_date TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 0,
                day_json TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(user_id, delivery_date)
            )
        """)
        db.commit()

    @app.get("/ddsm/api/driver/waybill")
    def driver_waybill():
        user = authenticated_user()
        if not user:
            return jsonify(ok=False, error="센터 기기 연결이 필요합니다."), 401
        target = request.args.get("date", "")
        barcode = request.args.get("barcode", "")
        if not valid_date(target) or not isinstance(barcode, str) or len(barcode) > 40:
            return jsonify(ok=False, error="배송일 또는 운송장번호가 올바르지 않습니다."), 400
        digits = re.sub(r"[\s-]", "", barcode)
        if not re.fullmatch(r"(?:\d{13}|\d{16})", digits):
            return jsonify(ok=False, error="13자리 또는 16자리 운송장번호를 입력하세요."), 400
        master = digits[:13]
        suffix = digits[13:] if len(digits) == 16 else None
        with closing(connect()) as db:
            records = db.execute("""
                SELECT s.waybill, s.business_name, s.source_address,
                       s.recipient_phone, s.cod_amount,
                       d.address AS saved_address, d.lat, d.lng
                FROM admin_deliveries s
                LEFT JOIN destinations d ON d.id=s.destination_id
                WHERE s.delivery_date=?
                  AND REPLACE(REPLACE(s.waybill,'-',''),' ','')=?
                LIMIT 51
            """, (target, master)).fetchall()
        if not records:
            return jsonify(ok=False, error="해당 날짜 원본 데이터에서 운송장을 찾지 못했습니다."), 404
        if len(records) > 50:
            return jsonify(ok=False, error="같은 송장번호가 지나치게 많습니다."), 409
        from admin import name_only_source
        def resolved_address(row):
            return row["saved_address"] or ("" if name_only_source(row["business_name"], row["source_address"]) else row["source_address"])
        identities = {
            (r["business_name"].strip(), resolved_address(r).strip())
            for r in records
        }
        if len(identities) != 1:
            return jsonify(ok=False, error="같은 송장에 다른 수취인·주소가 있습니다. 관리자에게 확인하세요."), 409
        record = records[0]
        from admin import cod_flag
        return jsonify(
            ok=True, date=target, master_waybill=master, item_suffix=suffix,
            waybill=record["waybill"], recipient=record["business_name"],
            address=resolved_address(record),
            phone=record["recipient_phone"], cod=cod_flag(record["cod_amount"]),
            lat=record["lat"], lng=record["lng"],
        )

    @app.post("/ddsm/api/driver/destination")
    def driver_destination():
        """Save a scanned shipment's address/point into the shared destination master."""
        user = authenticated_user()
        if not user:
            return jsonify(ok=False, error="센터 기기 연결이 필요합니다."), 401
        value = request.get_json(silent=True)
        if not isinstance(value, dict) or not valid_date(value.get("date")):
            return jsonify(ok=False, error="배송일이 올바르지 않습니다."), 400
        digits = re.sub(r"[\s-]", "", str(value.get("waybill") or ""))
        if not re.fullmatch(r"\d{13}(?:\d{3})?", digits):
            return jsonify(ok=False, error="운송장번호가 올바르지 않습니다."), 400
        master = digits[:13]
        address = value.get("address")
        if not isinstance(address, str) or not address.strip() or len(address) > 250:
            return jsonify(ok=False, error="저장할 주소를 입력하세요."), 400
        address = address.strip()
        lat, lng = value.get("lat"), value.get("lng")
        if lat is not None or lng is not None:
            if (type(lat) not in (int, float) or type(lng) not in (int, float)
                    or not -90 <= lat <= 90 or not -180 <= lng <= 180):
                return jsonify(ok=False, error="좌표를 확인하세요."), 400
        with closing(connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            records = db.execute(
                """SELECT id,business_name,source_address,destination_id FROM admin_deliveries
                   WHERE delivery_date=? AND REPLACE(REPLACE(waybill,'-',''),' ','')=?
                   LIMIT 51""", (value["date"], master)
            ).fetchall()
            if not records or len(records) > 50:
                return jsonify(ok=False, error="당일 원본 운송장을 찾을 수 없습니다."), 404
            # An authenticated driver may update only a destination resolved through
            # the exact scanned waybill; never accept an arbitrary destination ID.
            identities = {(r["business_name"].strip(), r["source_address"].strip()) for r in records}
            if len(identities) != 1:
                return jsonify(ok=False, error="동일 운송장에 서로 다른 배송지가 있습니다."), 409
            name = records[0]["business_name"].strip()
            from admin import compact, destination_id_for
            target_id = destination_id_for(db, name, address)
            if target_id is None:
                return jsonify(ok=False, error="배송지를 특정할 수 없습니다."), 409
            # Avoid moving an existing point when the address changes without a
            # freshly selected map coordinate.
            if lat is not None:
                db.execute(
                    "UPDATE destinations SET lat=?,lng=?,last_seen_at=CURRENT_TIMESTAMP WHERE id=?",
                    (lat, lng, target_id)
                )
            db.execute(
                """UPDATE admin_deliveries SET destination_id=?,updated_at=CURRENT_TIMESTAMP
                   WHERE delivery_date=? AND REPLACE(REPLACE(waybill,'-',''),' ','')=?""",
                (target_id, value["date"], master)
            )
            # Only alias the old spreadsheet address when its value is empty or
            # already equivalent; otherwise an unrelated site could be remapped.
            db.commit()
        return jsonify(ok=True, destination_id=target_id, address=address, lat=lat, lng=lng)

    @app.route("/ddsm/api/driver/work-day", methods=["GET", "PUT"])
    def driver_work_day():
        user = authenticated_user()
        if not user:
            return jsonify(ok=False, error="센터 기기 연결이 필요합니다."), 401
        if request.method == "GET":
            target = request.args.get("date", "")
            if not valid_date(target):
                return jsonify(ok=False, error="배송일 형식 오류"), 400
            with closing(connect()) as db:
                row = db.execute(
                    "SELECT revision,day_json,updated_at FROM ddsm_driver_days WHERE user_id=? AND delivery_date=?",
                    (user["id"], target),
                ).fetchone()
            return jsonify(
                ok=True, date=target, revision=row["revision"] if row else 0,
                day=json.loads(row["day_json"]) if row else empty_day(),
                updated_at=row["updated_at"] if row else None,
            )
        if request.content_length is not None and request.content_length > 3 * 1024 * 1024:
            return jsonify(ok=False, error="작업 데이터는 3MB 이하여야 합니다."), 413
        value = request.get_json(silent=True)
        if not isinstance(value, dict) or not valid_date(value.get("date")):
            return jsonify(ok=False, error="배송일 형식 오류"), 400
        revision = value.get("revision")
        if type(revision) is not int or revision < 0:
            return jsonify(ok=False, error="작업 버전 오류"), 400
        try:
            parsed = normalize_day(value.get("day"))
        except ValueError as error:
            return jsonify(ok=False, error=str(error)), 400
        payload = json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))
        if len(payload.encode("utf-8")) > 2 * 1024 * 1024:
            return jsonify(ok=False, error="작업 데이터는 2MB 이하여야 합니다."), 413
        target = value["date"]
        with closing(connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT revision,day_json FROM ddsm_driver_days WHERE user_id=? AND delivery_date=?",
                (user["id"], target),
            ).fetchone()
            current = row["revision"] if row else 0
            if current != revision:
                db.rollback()
                return jsonify(
                    ok=False, error="다른 기기에서 먼저 수정한 기록이 있습니다.",
                    date=target, revision=current,
                    day=json.loads(row["day_json"]) if row else empty_day(),
                ), 409
            db.execute("""
                INSERT INTO ddsm_driver_days(user_id,delivery_date,revision,day_json)
                VALUES(?,?,?,?)
                ON CONFLICT(user_id,delivery_date) DO UPDATE SET
                    revision=excluded.revision,
                    day_json=excluded.day_json,
                    updated_at=CURRENT_TIMESTAMP
            """, (user["id"], target, current + 1, payload))
            db.commit()
        return jsonify(ok=True, date=target, revision=current + 1, day=parsed)
