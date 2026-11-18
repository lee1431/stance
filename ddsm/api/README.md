# G10 DDSM 전용 백엔드 배포 안내

새 DDSM 앱 전용 API입니다. 기존 G10 `~/dsd` 폴더와 프로세스는 변경하지 않습니다.
**절대 기존 서버의 `admin.py`를 이 코드로 덮어쓰지 마세요.**

## 1. G10 Termux에 별도 디렉터리 생성

```bash
mkdir -p ~/ddsm
cd ~/ddsm
curl -fL https://raw.githubusercontent.com/lee1431/stance/main/ddsm/api/app.py -o app.py
curl -fL https://raw.githubusercontent.com/lee1431/stance/main/ddsm/api/admin.py -o admin.py
curl -fL https://raw.githubusercontent.com/lee1431/stance/main/ddsm/api/driver.py -o driver.py
curl -fL https://raw.githubusercontent.com/lee1431/stance/main/ddsm/api/requirements.txt -o requirements.txt
python -m pip install -r requirements.txt
python -m py_compile app.py admin.py driver.py
```

기존 환경과 패키지 충돌이 예상되면 별도 Python 가상환경을 사용하세요.

## 2. 서버 환경 설정

```bash
export DDSM_DB_PATH="$HOME/ddsm/ddsm.db"
export DDSM_ORIGIN="https://llsshh.com"
export DDSM_ADMIN_PHONES="01012345678"
```

관리자 비밀번호 해시는 다음 명령으로 생성한 뒤 G10 환경 변수 `DDSM_ADMIN_PASSWORD_HASH`에 등록하세요.
실제 비밀번호나 해시를 GitHub에 올리지 마세요.

```bash
python - <<'PY'
from getpass import getpass
from werkzeug.security import generate_password_hash
print(generate_password_hash(getpass("관리자 비밀번호: "), method="scrypt"))
PY
```

관리자 계정은 기사 회원가입 API로 먼저 생성한 뒤, `DDSM_ADMIN_PHONES`에 해당 전화번호가 포함되어 있어야 합니다.

## 3. 별도 Waitress 실행

```bash
cd ~/ddsm
waitress-serve --listen=127.0.0.1:8862 --call app:create_app
```

`8862`는 예시 포트입니다. G10에서 사용 중이지 않은지 먼저 확인하세요.
운영 시에는 별도의 실행 스크립트 또는 서비스 관리자를 사용하세요.

## 4. mrdindoin.ddns.net의 Nginx에 새 경로 추가

기존 `/dsd/api/`와 `/dsd-center-api/` 설정을 수정하지 말고, 다음 경로만 추가하세요.

```nginx
location /ddsm/api/ {
    proxy_pass http://127.0.0.1:8862;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization $http_authorization;
}
```

백엔드는 `/ddsm/api/` 경로를 **그대로** 받습니다. `proxy_pass` 뒤에 경로 슬래시를 붙여 잘라내지 마세요.
설정 검증 `nginx -t`가 통과할 때만 Nginx를 재로드하세요.

## 5. API 연결 확인

```bash
curl -i https://mrdindoin.ddns.net/ddsm/api/health
curl -i -X POST https://mrdindoin.ddns.net/ddsm/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"01000000000","password":"invalid"}'
```

Health 응답 `200`이면 DDSM 서버 연결 성공입니다.
가짜 계정 로그인 응답은 `401`이어야 하며, `404`가 뜨면 라우팅 오류입니다.

## API 경로

- `POST /ddsm/api/auth/register`
- `POST /ddsm/api/auth/login` → `access_token`
- `GET /ddsm/api/auth/me`, `POST /ddsm/api/auth/logout`
- `GET /ddsm/api/driver/waybill?date=YYYY-MM-DD&barcode=...`
- `GET /ddsm/api/driver/work-day?date=YYYY-MM-DD`
- `PUT /ddsm/api/driver/work-day` → `date`, `revision`, `day`
- `POST /ddsm/api/admin/unlock`
- `GET /ddsm/api/admin/me`
- `POST /ddsm/api/admin/import`
- `GET /ddsm/api/admin/deliveries?date=YYYY-MM-DD`
- `GET /ddsm/api/admin/destinations?q=...`
- `POST /ddsm/api/admin/deliveries/<id>/location`

기사/관리자 요청은 로그인으로 받은 Bearer 토큰을 `Authorization` 헤더에 전송합니다.
관리자 전용 라우트는 관리자 등록 전화번호와 별도 관리자 비밀번호의 잠금 해제가 필요합니다.
토큰은 서버 DB에 SHA-256 해시만 저장되며, 로그인 후 12시간 유효합니다.

## 데이터 분리 및 이전 주의

- DDSM DB는 `DDSM_DB_PATH`에 지정한 독립 SQLite 파일입니다.
- 기사 작업은 `ddsm_driver_days`에 기사 계정 ID + 배송일로 저장됩니다. 센터별 구분은 없습니다.
- 기존 `dsd` DB를 이름만 바꿔 사용하는 것은 권장하지 않습니다. 기존 서비스와 데이터가 섞일 수 있습니다.
- 기존 서버에 올라간 원본 엑셀과 기존 계정은 이 새 DB에 자동으로 나타나지 않습니다.
- DDSM 관리자 웹에서 날짜별 원본 엑셀을 재업로드하고 필요한 기사 계정을 신규 등록하세요.
- 기존 데이터 이관이 필요하면 먼저 원본 DB 백업 후 별도의 검증된 마이그레이션을 수행하세요.

**개발 상태:** GitHub 코드 반영만 완료했습니다. G10 배포·실기 연결 검증은 별도입니다.
