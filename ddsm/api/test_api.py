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
        os.environ["DDSM_ENABLE_LEGACY_AUTH"] = "1"
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

    def test_center_device_isolation(self):
        import json
        os.environ["DDSM_CENTERS_JSON"] = json.dumps({
            "a": {"name": "A", "invite": "a"*64},
            "b": {"name": "B", "invite": "b"*64},
        })
        os.environ["DDSM_ADMIN_ACCESS_KEY"] = "c"*64
        os.environ["DDSM_ENABLE_LEGACY_AUTH"] = "0"
        try:
            from app import create_app
            client = create_app().test_client()
            base = "/ddsm/api/"
            day = "2026-11-26"
            def header(token):
                return {"Authorization": "Bearer "+token}
            self.assertEqual(client.get(base+"connection/centers").status_code, 403)
            self.assertEqual(len(client.get(base+"connection/centers", headers=header("adm_"+"c"*64)).get_json()["centers"]), 2)
            admin_a = header("a_a_"+"c"*64)
            admin_b = header("a_b_"+"c"*64)
            devices = {}
            for cid in ("a","b"):
                response = client.post(base+"connection/driver", json={"center":cid,"invite":cid*64,"device":"d"*64})
                self.assertEqual(response.status_code, 200, response.get_json())
                devices[cid] = header(response.get_json()["token"])
            self.assertEqual(client.get(base+"admin/me", headers=devices["a"]).status_code, 403)
            self.assertEqual(client.get(base+"driver/work-day", query_string={"date":day}).status_code,401)
            body = "운송장번호,수취인,주소,연락처\n1234567890123,정기고객,,01012345678\n".encode("utf-8-sig")
            def upload(date, content):
                return client.post(base+"admin/import",headers=admin_a,data={"date":date,"file":(io.BytesIO(content),"manifest.csv")})
            self.assertEqual(upload(day,body).status_code,200)
            query = {"date":day}
            row=client.get(base+"admin/deliveries",headers=admin_a,query_string=query).get_json()["rows"][0]
            self.assertEqual(client.get(base+"admin/deliveries",headers=admin_b,query_string=query).get_json()["total"],0)
            saved=client.post(base+"admin/deliveries/"+str(row["id"])+"/location",headers=admin_a,json={"address":"충주시 금봉로 21","lat":36.99,"lng":127.92,"remember_recipient":True})
            self.assertEqual(saved.status_code,200,saved.get_json())
            next_day="2026-11-27"
            self.assertEqual(upload(next_day,body).status_code,200)
            query={"date":next_day,"barcode":"1234567890123"}
            found=client.get(base+"driver/waybill",headers=devices["a"],query_string=query)
            self.assertEqual(found.status_code,200,found.get_json())
            self.assertEqual(found.get_json()["address"],"충주시 금봉로 21")
            self.assertEqual(client.get(base+"driver/waybill",headers=devices["b"],query_string=query).status_code,404)
            self.assertEqual(client.get(base+"admin/recurring-recipients",headers=admin_a).get_json()["recipients"][0]["recipient_name"],"정기고객")
            self.assertEqual(client.get(base+"admin/recurring-recipients",headers=admin_b).get_json()["recipients"],[])
        finally:
            os.environ.pop("DDSM_CENTERS_JSON",None)
            os.environ.pop("DDSM_ADMIN_ACCESS_KEY",None)
            os.environ["DDSM_ENABLE_LEGACY_AUTH"]="1"

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

        # Addressless recurring business: the shared master is created during import,
        # then the driver supplies a location used by the next day's export.
        recurring_day = "2026-11-19"
        name_only = "운송장번호,상호명,물품명\n2139602023215,정기배송상점,부품\n".encode("utf-8-sig")
        uploaded = self.client.post(
            "/ddsm/api/admin/import",
            data={"date": recurring_day, "file": (io.BytesIO(name_only), "recurring.csv")},
            headers=headers_a,
        )
        self.assertEqual(uploaded.status_code, 200, uploaded.get_json())
        unlocated = self.client.get(
            "/ddsm/api/admin/deliveries",
            query_string={"date": recurring_day}, headers=headers_a,
        ).get_json()["rows"]
        self.assertEqual(len(unlocated), 1)
        self.assertTrue(unlocated[0]["registered"])
        self.assertEqual(unlocated[0]["address"], "")

        shared_update = self.client.post(
            "/ddsm/api/driver/destination",
            json={"date": recurring_day, "waybill": "2139602023215",
                  "address": "충주시 금봉로 21", "lat": 36.99, "lng": 127.92},
            headers=headers_a2,
        )
        self.assertEqual(shared_update.status_code, 200, shared_update.get_json())
        updated = self.client.get(
            "/ddsm/api/admin/deliveries",
            query_string={"date": recurring_day}, headers=headers_a,
        ).get_json()["rows"]
        self.assertEqual(updated[0]["address"], "충주시 금봉로 21")
        self.assertTrue(updated[0]["located"])

        next_day = "2026-11-20"
        later = "운송장번호,상호명,물품명\n2139602023216,정기배송상점,자재\n".encode("utf-8-sig")
        self.client.post(
            "/ddsm/api/admin/import",
            data={"date": next_day, "file": (io.BytesIO(later), "later.csv")},
            headers=headers_a,
        )
        inherited = self.client.get(
            "/ddsm/api/driver/waybill",
            query_string={"date": next_day, "barcode": "2139602023216"},
            headers=headers_b,
        )
        self.assertEqual(inherited.status_code, 200, inherited.get_json())
        self.assertEqual(inherited.get_json()["address"], "충주시 금봉로 21")
        self.assertEqual(inherited.get_json()["lat"], 36.99)


    def test_import_keeps_only_four_customer_fields_and_two_address_variants(self):
        from admin import parse_grid
        fixed = [
            "일자", "발송지", "운송장번호", "발화주", "수화주",
            "품명", "포장", "상품", "수량", "상태", "현불운임",
            "착불운임", "출고제비용", "합계", "특기사항",
            "수화주 지번주소", "수화주 도로명주소",
        ]
        headers = ["번호", *fixed, "수화주 연락처", "발송인 전화번호"]
        def record(waybill, road, lot, amount):
            data = {
                "운송장번호": waybill, "발화주": "보내는 사람", "수화주": "받는 사람",
                "수화주 도로명주소": road, "수화주 지번주소": lot,
                "착불운임": amount, "품명": "비공개 상품명",
                "수화주 연락처": "01098765432", "발송인 전화번호": "01012341234",
            }
            return [data.get(label, "") for label in headers]
        rows = parse_grid("수화주 주소", iter([
            headers,
            record("2139602023214", "충주시 도로명로 10", "충주시 지번동 12", "2500"),
            record("2139602023215", "", "충주시 지번동 13", "0"),
        ]))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["standard"]["waybill"], "2139602023214")
        self.assertEqual(rows[0]["raw"], {
            "수취인명": "받는 사람", "주소": "충주시 도로명로 10",
            "착불유무": "착불", "연락처": "01098765432",
        })
        self.assertEqual(rows[1]["raw"]["주소"], "충주시 지번동 13")
        self.assertEqual(rows[1]["raw"]["착불유무"], "선불")
        self.assertNotIn("비공개 상품명", str(rows))
        self.assertNotIn("01012341234", str(rows))


if __name__ == "__main__":
    unittest.main()
