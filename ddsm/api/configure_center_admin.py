"""Configure a center administrator password without exposing it in shell history.
Run after sourcing center.env (export its variables) from the DDSM directory.
"""
import getpass
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import tempfile
import time

from werkzeug.security import generate_password_hash

path = Path("center.env")
if not path.is_file():
    raise SystemExit("center.env 파일을 찾지 못했습니다.")
text = path.read_text(encoding="utf-8")
centers = json.loads(os.environ.get("DDSM_CENTERS_JSON", "{}"))
if not isinstance(centers, dict) or not centers:
    raise SystemExit("센터 설정이 없습니다. center.env를 먼저 source 하세요.")
for cid, value in centers.items():
    print(cid, "-", value.get("name", cid))
cid = input("설정할 센터 ID: ").strip()
if cid not in centers:
    raise SystemExit("센터 ID를 확인하세요.")
password = getpass.getpass("새 관리자 비밀번호 (8자 이상): ")
if len(password) < 8 or len(password) > 128:
    raise SystemExit("비밀번호는 8~128자로 설정하세요.")
if getpass.getpass("비밀번호 재입력: ") != password:
    raise SystemExit("비밀번호가 일치하지 않습니다.")
centers[cid]["admin_password_hash"] = generate_password_hash(password, method="scrypt")
def replace_var(source, key, value):
    pattern = re.compile(r"(?m)^(?:export[ \t]+)?" + re.escape(key) + r"=[^\r\n]*$")
    result, count = pattern.subn(lambda _: "export " + key + "=" + shlex.quote(value), source)
    if count != 1:
        raise SystemExit(key + " 단일 행 설정을 확인하세요. 원본은 변경하지 않았습니다.")
    return result
updated = replace_var(text, "DDSM_CENTERS_JSON", json.dumps(centers, ensure_ascii=False, separators=(",", ":")))
if input("기존 관리자 연결 키도 새로 발급할까요? (노출 시 권장, y/N): ").strip().lower() == "y":
    updated = replace_var(updated, "DDSM_ADMIN_ACCESS_KEY", secrets.token_urlsafe(48))
backup = path.with_name("center.env.bak." + str(time.time_ns()))
fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as output:
    output.write(text)
fd, temporary = tempfile.mkstemp(prefix=".center.env.", dir=path.parent)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        output.write(updated)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
print("센터 관리자 비밀번호 설정 완료. 기존 센터 ID, 기사 인증키, 데이터는 그대로 유지됩니다.")
print("DDSM 서버를 재시작하세요.")
