# DDSM 센터별 무로그인 API 배포

기존 DSD 및 DDSM DB를 삭제하거나 덮어쓰지 않습니다. 센터마다 새 SQLite 파일을 사용합니다. 기존 데이터는 자동 이관되지 않으므로 백업하고 필요한 엑셀은 해당 센터에 다시 업로드하세요.

## 1. 파일 준비 및 테스트 (S10 Termux)

```bash
cd ~/ddsm
mkdir -p backup-before-center
cp -p app.py admin.py driver.py test_api.py backup-before-center/ 2>/dev/null || true
for f in app.py admin.py driver.py test_api.py requirements.txt; do
  curl -fL "https://raw.githubusercontent.com/lee1431/stance/main/ddsm/api/$f" -o "$f.new" || break
done
# 다운로드 5개를 확인한 뒤 교체
for f in app.py admin.py driver.py test_api.py requirements.txt; do test -s "$f.new" || exit 1; done
for f in app.py admin.py driver.py test_api.py requirements.txt; do mv "$f.new" "$f"; done
python -m pip install -r requirements.txt
python -m py_compile app.py admin.py driver.py test_api.py
python -m unittest -v test_api
```

## 2. 최초 한 번 센터 설정

아래 명령은 새 센터 설정과 관리자 링크를 생성합니다. 기존 센터 설정이 있다면 다시 생성하지 말고 기존 설정을 사용하세요. 센터 ID는 영문/숫자/하이픈 최대 40자. 센터 추가는 기존 JSON에 항목 추가 후 재시작합니다.

```bash
cd ~/ddsm
umask 077
python - <<'PY'
import json, secrets, shlex
from pathlib import Path
p = Path("center.env")
if p.exists():
    raise SystemExit("center.env already exists")
cid = input("센터 ID: ").strip()
name = input("센터명: ").strip()
key = secrets.token_urlsafe(48)
centers = {cid: {"name": name, "invite": secrets.token_urlsafe(48)}}
p.write_text("export DDSM_CENTERS_JSON=" + shlex.quote(json.dumps(centers, ensure_ascii=False)) + "\\nexport DDSM_ADMIN_ACCESS_KEY=" + shlex.quote(key) + "\\n")
print("관리자 전용 연결 링크: https://llsshh.com/ddsm/admin/#admin=" + key)
PY
```

관리자 전용 링크를 안전하게 보관하세요. 관리자 키와 기사 초대 링크는 GitHub에 커밋하지 마세요. 관리자 링크로 최초 접속하면 브라우저에 연결 정보가 저장되고 이후 센터를 선택합니다. 해당 센터의 관리자 페이지에서 기사 연결 링크 복사 후 기사에게 전달합니다. 기사는 최초 접속 후 센터 선택/전화번호/비밀번호 없이 사용합니다. 브라우저 저장소를 삭제하면 다시 연결해야 합니다.

## 3. 기존 Waitress 재시작

기존 DDSM 프로세스만 중지 후 아래 환경을 적용하여 시작합니다. 기존 프로세스 관리 스크립트를 사용 중이면 같은 환경 변수를 그곳에 설정하세요.

```bash
cd ~/ddsm
. ./center.env
export DDSM_DB_PATH="$HOME/ddsm/ddsm.db"
export DDSM_ORIGIN="https://llsshh.com"
export DDSM_ENABLE_LEGACY_AUTH=0
waitress-serve --listen=127.0.0.1:8862 --call app:create_app
```

기존 Nginx /ddsm/api/ 프록시와 Authorization 헤더 전달 설정 유지. Health 응답의 center_connection=true 확인.

## 4. 검증 및 데이터 관리

- 관리자 센터별 엑셀 업로드 → 정기배송 고객 주소 등록 → 다음 날 원본 참조.
- 기사 링크 최초 연결 → 스캔 → 지도 순번 → 목록 완료/내비/회차 변경.
- 다른 센터 기기에서 운송장 조회 불가 확인.
- 새 DB: DDSM_DB_PATH + .centers/ 아래 센터 ID.sqlite. 기존 DB와 분리.
- 저장 데이터 암호화·보존/삭제 정책 및 기사 기기 토큰 개별 폐기는 별도 운영 과제. 센터 초대 링크는 해당 센터의 원본 조회 권한을 부여하므로 승인 기사에게만 전달.
- 기존 DSD 서비스와 DB는 그대로 유지.
