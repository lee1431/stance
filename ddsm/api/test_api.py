"""Standalone DDSM API smoke tests; never touches the legacy DSD database."""
from __future__ import annotations

import io
import os
import sys
import tempfile
import unittest
from pathlib import Path

from werkzeug.security import generate_password_hash


class DDSMApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="ddsm-test-")
        os.environ["DDSM_DB_PATH"] = str(Path(cls.temp.name) / "test.sqlite")
        os.environ["DDSM_ORIGIN"] = "https://llsshh.com"
        os.environ["DDSM_ADMIN_PHONES"] = "01011112222"
        os.environ["DDSM_ADMIN_PASSWORD_HASH"] = generate_password_hash("test-admin", method="scrypt")
        sys.path.insert(0, str(Path(__file__).parent))
        from app import create_app
        cls.client = create_app().test_client()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def register(self, phone):
        response = self.client.post("/ddsm/api/auth/register", json={
            "phone": phone, "password": "testpass123",
        })
        self.assertEqual(response.status_code, 201, response.get_json())

    def login(self, phone):
        response = self.client.post("/ddsm/api/auth/login", json={
            "phone": phone, "password": "testpass123",
        })
        self.assertEqual(response.status_code, 200, response.get_json())
        return {"Authorization": "Bearer " + response.get_json()["access_token"]}

    def test_driver_sync_and_admin_lookup(self):
        self.register("01011112222")
        self.register("01033334444")
        headers_a = self.login("01011112222")
        headers_a2 = self.login("01011112222")
        headers_b = self.login("01033334444")
        day = "2026-11-18"

        locked = self.client.get("/ddsm/api/admin/me", headers=headers_a)
        self.assertEqual(locked.status_code, 403)
        unlocked = self.client.post(
            "/ddsm/api/admin/unlock",
            json={"admin_password": "test-admin"},
            headers=headers_a,
        )
        self.assertEqual(unlocked.status_code, 200, unlocked.get_json())

        csv_body = "운송장번호,수취인,주소,물품명\n2139602023214,샘플고객,충주시 샘플로 1,상자\n".encode("utf-8-sig")
        uploaded = self.client.post(
            "/ddsm/api/admin/import",
            data={"date": day, "file": (io.BytesIO(csv_body), "manifest.csv")},
            headers=headers_a,
        )
        self.assertEqual(uploaded.status_code, 200, uploaded.get_json())

        scan = self.client.get(
            "/ddsm/api/driver/waybill",
            query_string={"date": day, "barcode": "2139602023214001"},
            headers=headers_a,
        )
        self.assertEqual(scan.status_code, 200, scan.get_json())
        self.assertEqual(scan.get_json()["master_waybill"], "2139602023214")
        self.assertEqual(scan.get_json()["item_suffix"], "001")

        initial = self.client.get(
            "/ddsm/api/driver/work-day",
            query_string={"date": day},
            headers=headers_a2,
        )
        self.assertEqual(initial.get_json()["revision"], 0)
        work = {"selected": 1, "rounds": [{"no": 1, "stops": [{
            "id": "parcel-a", "waybill": "2139602023214",
            "recipient": "샘플고객", "address": "충주시 샘플로 1",
            "phone": "", "memo": "경비실", "createdAt": "",
            "status": "pending", "scannedItems": ["001"],
        }]}]}
        saved = self.client.put(
            "/ddsm/api/driver/work-day",
            json={"date": day, "revision": 0, "day": work},
            headers=headers_a,
        )
        self.assertEqual(saved.status_code, 200, saved.get_json())
        self.assertEqual(saved.get_json()["revision"], 1)

        same_driver = self.client.get(
            "/ddsm/api/driver/work-day", query_string={"date": day},
            headers=headers_a2,
        )
        self.assertEqual(same_driver.get_json()["day"]["rounds"][0]["stops"][0]["memo"], "경비실")
        stale = self.client.put(
            "/ddsm/api/driver/work-day",
            json={"date": day, "revision": 0, "day": work},
            headers=headers_a2,
        )
        self.assertEqual(stale.status_code, 409)

        other_driver = self.client.get(
            "/ddsm/api/driver/work-day", query_string={"date": day},
            headers=headers_b,
        )
        self.assertEqual(other_driver.get_json()["revision"], 0)
        self.assertEqual(other_driver.get_json()["day"]["rounds"][0]["stops"], [])


if __name__ == "__main__":
    unittest.main()
