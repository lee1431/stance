"""Authenticated encryption and keyed indexes for DDSM SQLite records.

DDSM_DATA_KEY is a 32-byte, URL-safe base64 key stored outside Git and DB backups.
No fallback key is permitted. Keep the key for as long as encrypted data must be read.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import unicodedata
from contextlib import closing

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def normalize(value):
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", str(value or "")).casefold())


class DataProtector:
    def __init__(self):
        encoded = os.environ.get("DDSM_DATA_KEY", "").strip()
        try:
            key = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        except (ValueError, base64.binascii.Error):
            key = b""
        if len(key) != 32 or not encoded:
            raise RuntimeError("DDSM_DATA_KEY must be an external base64-encoded 32-byte key")
        self.aead = AESGCM(key)
        self.index_key = hmac.new(key, b"DDSM keyed indexes v1", hashlib.sha256).digest()
        self.key_check = hmac.new(key, b"DDSM encryption key check v1", hashlib.sha256).hexdigest()

    def encrypt(self, value, field):
        if value is None or value == "":
            return ""
        text = str(value)
        if text.startswith("e1:"):
            raise ValueError("Refusing to encrypt an already encrypted value")
        nonce = secrets.token_bytes(12)
        data = nonce + self.aead.encrypt(nonce, text.encode("utf-8"), field.encode("ascii"))
        return "e1:" + base64.urlsafe_b64encode(data).decode("ascii")

    def decrypt(self, value, field):
        if value is None or value == "":
            return ""
        if not isinstance(value, str) or not value.startswith("e1:"):
            raise ValueError("Unencrypted or invalid DDSM field: " + field)
        try:
            data = base64.urlsafe_b64decode(value[3:])
            if len(data) < 29:
                raise ValueError("Truncated ciphertext")
            return self.aead.decrypt(data[:12], data[12:], field.encode("ascii")).decode("utf-8")
        except Exception as exc:
            raise ValueError("DDSM decryption failed: " + field) from exc

    def index(self, purpose, value):
        data = (purpose + "\0" + str(value)).encode("utf-8")
        return hmac.new(self.index_key, data, hashlib.sha256).hexdigest()

    def address_identity(self, name, address):
        if address:
            legacy = hashlib.sha256(("address:" + normalize(address)).encode("utf-8")).hexdigest()
        else:
            legacy = hashlib.sha256(("name:" + normalize(name)).encode("utf-8")).hexdigest()
        return self.index("destination-identity", legacy)

    def alias_key(self, address):
        legacy = hashlib.sha256(("address:" + normalize(address)).encode("utf-8")).hexdigest()
        return self.index("destination-alias", legacy)

    def waybill_key(self, value):
        return self.index("waybill", re.sub(r"[\s-]", "", str(value or "")))

    def row_key(self, value):
        return self.index("delivery-row", value)

    def name_key(self, value):
        return self.index("destination-name", normalize(value)) if normalize(value) else ""

    def address_key(self, value):
        return self.index("destination-address", normalize(value)) if normalize(value) else ""

    def tokens(self, name, address):
        result = set()
        for source in (normalize(name), normalize(address)):
            for n in (1, 2, 3):
                for i in range(max(0, len(source) - n + 1)):
                    result.add(self.index("destination-search", source[i:i + n]))
        return result

    def query_tokens(self, value):
        source = normalize(value)
        n = min(3, len(source))
        return {self.index("destination-search", source[i:i + n])
                for i in range(len(source) - n + 1)} if n else set()


DELIVERY_COLUMNS = (
    "waybill", "business_name", "sender_name", "source_address",
    "recipient_phone", "item_name", "cod_amount", "driver_name",
    "delivery_status", "raw_json", "sheet_name", "source_file",
)


def index_destination(db, crypto, destination_id, name, address):
    db.execute("DELETE FROM destination_search_tokens WHERE destination_id=?", (destination_id,))
    db.executemany(
        "INSERT OR IGNORE INTO destination_search_tokens(token,destination_id) VALUES (?,?)",
        ((token, destination_id) for token in crypto.tokens(name, address)),
    )


def migrate(connect, crypto):
    """Atomically upgrade all existing unencrypted records before accepting traffic.

    A different key aborts startup. Never migrate from a half-encrypted state.
    Existing *external* plaintext backups must be handled by the server operator.
    """
    with closing(connect()) as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute("""CREATE TABLE IF NOT EXISTS ddsm_security_meta (
                id INTEGER PRIMARY KEY CHECK(id=1),
                key_check TEXT NOT NULL
            )""")
            db.execute("""CREATE TABLE IF NOT EXISTS destination_search_tokens (
                token TEXT NOT NULL,
                destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
                PRIMARY KEY(token,destination_id)
            )""")
            if "waybill_index" not in {
                row[1] for row in db.execute("PRAGMA table_info(admin_deliveries)")
            }:
                db.execute("ALTER TABLE admin_deliveries ADD COLUMN waybill_index TEXT NOT NULL DEFAULT ''")
            db.execute("CREATE INDEX IF NOT EXISTS idx_ddsm_waybill_lookup ON admin_deliveries(delivery_date, waybill_index)")
            row = db.execute("SELECT key_check FROM ddsm_security_meta WHERE id=1").fetchone()
            if row:
                if not hmac.compare_digest(row[0], crypto.key_check):
                    raise RuntimeError("Wrong DDSM_DATA_KEY; refusing to read database")
                db.commit()
                return

            for row in db.execute("SELECT id,business_name,address,name_key,address_key,identity_key,lat,lng FROM destinations").fetchall():
                dest_id, name, address, _name_key, _address_key, identity, lat, lng = row
                if str(name).startswith("e1:") or str(address).startswith("e1:"):
                    raise RuntimeError("Encrypted rows without migration marker; restore verified backup")
                db.execute(
                    """UPDATE destinations SET identity_key=?,business_name=?,address=?,
                       name_key=?,address_key=?,lat=?,lng=? WHERE id=?""",
                    (crypto.index("destination-identity", identity),
                     crypto.encrypt(name, "destinations.business_name"),
                     crypto.encrypt(address, "destinations.address"),
                     crypto.name_key(name), crypto.address_key(address),
                     crypto.encrypt(lat, "destinations.lat"),
                     crypto.encrypt(lng, "destinations.lng"), dest_id),
                )
                index_destination(db, crypto, dest_id, name, address)

            for row in db.execute("SELECT source_key,destination_id FROM destination_aliases").fetchall():
                old_key, destination_id = row
                db.execute("DELETE FROM destination_aliases WHERE source_key=?", (old_key,))
                db.execute("INSERT OR REPLACE INTO destination_aliases(source_key,destination_id) VALUES (?,?)",
                           (crypto.index("destination-alias", old_key), destination_id))

            for row in db.execute("SELECT id,row_key,waybill," + ",".join(DELIVERY_COLUMNS[1:]) +
                                  " FROM admin_deliveries").fetchall():
                shipment_id, original_key, waybill, *other = row
                values = dict(zip(DELIVERY_COLUMNS, (waybill, *other)))
                if any(str(value).startswith("e1:") for value in values.values()):
                    raise RuntimeError("Encrypted rows without migration marker; restore verified backup")
                encrypted = [crypto.encrypt(values[field], "admin_deliveries." + field)
                             for field in DELIVERY_COLUMNS]
                assignments = ",".join(field + "=?" for field in DELIVERY_COLUMNS)
                db.execute(
                    "UPDATE admin_deliveries SET row_key=?,waybill_index=?," + assignments + " WHERE id=?",
                    (crypto.row_key(original_key), crypto.waybill_key(waybill), *encrypted, shipment_id),
                )

            for row in db.execute("SELECT id,filename FROM import_batches").fetchall():
                db.execute("UPDATE import_batches SET filename=? WHERE id=?",
                           (crypto.encrypt(row[1], "import_batches.filename"), row[0]))
            for row in db.execute("SELECT user_id,delivery_date,day_json FROM ddsm_driver_days").fetchall():
                db.execute("UPDATE ddsm_driver_days SET day_json=? WHERE user_id=? AND delivery_date=?",
                           (crypto.encrypt(row[2], "ddsm_driver_days.day_json"), row[0], row[1]))
            db.execute("INSERT INTO ddsm_security_meta(id,key_check) VALUES(1,?)", (crypto.key_check,))
            db.commit()
        except Exception:
            db.rollback()
            raise
