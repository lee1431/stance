# DDSM — Daily · Scan · Delivery

택배 배송센터의 원본 엑셀과 현장에서 스캔한 운송장을 연결하여, 물량 분류부터 배송 순번 지정, 지도 확인, 배송 완료 및 사진 관리까지 지원하는 웹 기반 배송 관리 도구입니다.

이 문서는 GitHub에서 소스코드를 내려받아 **자신의 서버와 배송센터에서 직접 운영하려는 사용자**를 위한 안내서입니다.

## 1. 무엇을 할 수 있나요?

| 센터 관리자 | 배송 기사 |
| --- | --- |
| 날짜별 원본 엑셀 업로드 | 카메라·외부 스캐너·직접 입력으로 운송장 등록 |
| 전체 배송 지도 및 위치 미확인 목록 관리 | 회차별 물량 분류 및 지도 확인 |
| 주소·좌표 수정 및 정기배송 고객 주소록 관리 | 배송 순번 지정, 주소 수정, 내비게이션 연결 |
| 기사 연결 코드 발급 | 배송 사진 촬영·업로드 및 완료 처리 |
| 기사별 배송현황 및 사진 조회 | 날짜별·회차별 배송현황 확인 |

센터별 원본 데이터와 주소록은 분리되며, 기사 작업은 센터·기기·배송일을 기준으로 서버에 저장됩니다. 이미 등록한 정기배송 고객 주소와 좌표는 이후 원본 업로드에서 재사용할 수 있습니다.

## 2. 구성 및 준비물

DDSM은 별도의 모바일 앱 설치 없이 스마트폰 브라우저에서 사용할 수 있습니다.

- 웹 화면: HTML, CSS, JavaScript (정적 웹 서버 또는 GitHub Pages)
- API 서버: Python, Flask, Waitress
- 데이터베이스: SQLite
- 지도: NAVER Maps JavaScript SDK 및 Geocoder
- 바코드: 스마트폰 카메라 또는 키보드 입력 방식의 외부 스캐너

서버는 Linux PC, VPS 또는 Android의 Termux 등 Python을 실행할 수 있는 환경을 사용할 수 있습니다. 외부에서 접속하려면 HTTPS 웹 주소와 API 주소, 그리고 해당 주소를 연결할 웹 서버 또는 리버스 프록시가 필요합니다. 지도 사용을 위해 본인의 NAVER Maps 애플리케이션 설정이 필요합니다.

현재 개발·운영 환경의 주소는 아래와 같습니다. **독립 설치에서는 이 주소를 그대로 사용하지 말고 자신의 주소로 변경해야 합니다.**

| 구분 | 현재 운영 주소 |
| --- | --- |
| 기사 | https://llsshh.com/ddsm/ |
| 관리자 | https://llsshh.com/ddsm/admin/ |
| API | https://mrdindoin.ddns.net/ddsm/api/ |

## 3. 소스코드 내려받기

Git과 Python 3를 설치한 다음 터미널에서 실행합니다.

```bash
git clone https://github.com/lee1431/stance.git
cd stance
```

DDSM은 stance 저장소의 `ddsm/` 디렉터리에 있습니다.

```text
ddsm/
├── index.html                 기사 화면
├── app.js                     기사 업무 및 서버 동기화
├── waybill.js                 운송장번호 처리
├── delivery-map.js            배송 지도
├── naver-map.js               NAVER Maps SDK
├── address-utils.js           주소 해석 및 지도 검색
├── center-link.js             기사 연결
├── connect/                   연결용 웹 페이지
├── admin/                     센터 관리자 화면
├── vendor/                    브라우저용 외부 라이브러리
└── api/
    ├── app.py                 Flask API 진입점
    ├── admin.py               관리자 업무 API
    ├── driver.py              기사 업무 API
    ├── configure_center_admin.py  센터 관리자 비밀번호 설정
    ├── requirements.txt       Python 의존성
    ├── test_api.py            API 테스트
    └── README.md              기존 서버 배포 안내
```

API와 정적 웹 화면은 별도로 배포합니다. 서버의 설정 파일, DB, 백업 및 배송 사진이 웹 공개 디렉터리에 포함되지 않도록 하세요.

## 4. 독립 운영을 위한 주소 설정

예시로 웹 주소를 `https://delivery.example.com`, API 주소를 `https://api.example.com`으로 가정합니다. 실제 보유한 주소로 바꾸세요. 동일한 도메인에서 웹과 API를 제공해도 됩니다.

### 웹 화면 수정

다음 JavaScript 파일에서 기존 API 주소 `https://mrdindoin.ddns.net`을 자신의 API 주소로 변경합니다.

- `ddsm/app.js`
- `ddsm/admin/admin.js`
- `ddsm/center-link.js`
- `ddsm/connect/connect.js`

API 경로인 `/ddsm/api/`는 유지합니다. 추가로 하드코딩된 운영 주소가 없는지 확인하세요.

```bash
git grep -n 'mrdindoin.ddns.net' -- ddsm
git grep -n 'llsshh.com' -- ddsm
```

`ddsm/naver-map.js`의 `CLIENT_ID`를 본인의 NAVER Maps 브라우저용 Client ID로 변경하고, 지도 서비스 설정에서 실제 웹 서비스 URL과 필요한 지도·지오코딩 기능을 등록하세요. Client Secret은 웹 코드에 넣지 않습니다.

웹 서버에는 기사 화면이 `/ddsm/`, 관리자가 `/ddsm/admin/`에서 열리도록 배치합니다. 기존 연결 링크 검증 코드도 이 경로를 사용하므로 임의로 경로를 바꾸면 추가 수정이 필요합니다.

카메라 바코드 인식용 ZXing 라이브러리는 기존 GitHub Actions 배포에서 추가됩니다. 직접 정적 파일을 배포할 때 파일이 없다면 Node.js/npm이 있는 환경에서 저장소 루트 기준 다음 명령으로 준비하세요.

```bash
npm pack @zxing/browser@0.1.5 --pack-destination /tmp
tar -xzf /tmp/zxing-browser-0.1.5.tgz -C /tmp package/umd/zxing-browser.min.js package/LICENSE
mkdir -p ddsm/vendor
cp /tmp/package/umd/zxing-browser.min.js ddsm/vendor/zxing-browser-0.1.5.min.js
cp /tmp/package/LICENSE ddsm/vendor/zxing-browser-0.1.5.LICENSE.txt
```

GitHub Pages를 이용한다면 실제 사이트가 `/ddsm/` 경로로 제공되는지 확인하세요. 기존 Actions 워크플로에는 원래 운영 환경의 임시 복구 단계가 있으므로 새 저장소에서는 해당 단계 없이 배포 환경을 구성하는 것을 권장합니다.

## 5. API 서버 설치

아래는 새 서버에 설치하는 예시입니다. 저장소 루트에서 실행합니다.

```bash
mkdir -p "$HOME/ddsm-server"
cp ddsm/api/*.py ddsm/api/requirements.txt "$HOME/ddsm-server/"
cd "$HOME/ddsm-server"
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python -m unittest -v test_api
```

Termux에서는 먼저 `pkg install python git`으로 기본 도구를 설치할 수 있습니다. Pillow 등 의존성 설치 시 환경에 따라 추가 빌드 패키지가 필요할 수 있습니다.

### 최초 센터 등록

서버 디렉터리에서 다음 명령을 실행합니다. 예시 센터 ID와 이름은 운영 환경에 맞게 변경합니다. 센터 ID는 영문·숫자·하이픈으로 최대 40자입니다.

```bash
cd "$HOME/ddsm-server"
umask 077
python - <<'PY'
import json, secrets, shlex
from pathlib import Path

p = Path("center.env")
cid = "center-01"
name = "예시 배송센터"
centers = {cid: {"name": name, "invite": secrets.token_urlsafe(48)}}
with p.open("x", encoding="utf-8") as f:
    f.write("export DDSM_CENTERS_JSON=" + shlex.quote(
        json.dumps(centers, ensure_ascii=False)) + "\n")
    f.write("export DDSM_ADMIN_ACCESS_KEY=" + shlex.quote(
        secrets.token_urlsafe(48)) + "\n")
print("센터 설정 생성 완료")
PY
```

기존 `center.env`가 있으면 위 명령으로 덮어쓰지 않습니다. 센터 추가는 기존 `DDSM_CENTERS_JSON`에 새로운 ID, 이름 및 별도의 초대키를 추가하는 방식으로 진행하고 기존 센터 정보와 관리자 키를 유지합니다. 설정 파일은 먼저 백업하세요.

### 센터 관리자 비밀번호 설정

```bash
. ./center.env
python configure_center_admin.py
```

센터 ID를 선택하고 8자 이상의 비밀번호를 입력합니다. 신규 설치에서는 기존 관리자 연결 키를 다시 발급할 필요가 없습니다. 여러 센터가 있다면 각 센터에 대해 이 절차를 반복합니다.

### API 실행

```bash
. ./.venv/bin/activate
. ./center.env
export DDSM_DB_PATH="$HOME/ddsm-server/ddsm.db"
export DDSM_ORIGIN="https://delivery.example.com"
export DDSM_ENABLE_LEGACY_AUTH=0
waitress-serve --listen=127.0.0.1:8862 --call app:create_app
```

`DDSM_ORIGIN`은 실제 기사·관리자 웹 주소의 오리진(스킴과 호스트, 필요한 경우 포트)입니다. 설정을 수정하면 서버를 재시작해야 합니다.

Nginx를 같은 서버에서 사용하는 경우 HTTPS 가상 호스트 안에 다음과 같이 API 프록시를 구성할 수 있습니다.

```nginx
location /ddsm/api/ {
    proxy_pass http://127.0.0.1:8862;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 20m;
}
```

인증서와 도메인 설정은 각 서버 환경에 맞게 별도로 구성합니다. 프록시 설정의 업로드 제한은 실제 API 제한 및 운영 정책에 맞춰 조정하세요.

### 작동 확인

```bash
curl -f http://127.0.0.1:8862/ddsm/api/health
```

정상 응답 예시:

```json
{
  "ok": true,
  "service": "ddsm",
  "status": "ready",
  "center_connection": true,
  "center_code_login": true,
  "admin_center_login": true
}
```

외부 HTTPS API 주소에서도 동일하게 응답하는지 확인합니다. 기존 서버 업데이트에 관한 내용은 [API 배포 안내](api/README.md)를 참고하세요. 기존 문서에는 이전 관리자 연결 방식도 포함되어 있으며, 신규 설치에는 위의 센터별 비밀번호 방식을 사용합니다.

## 6. 센터 관리자 사용법

1. 관리자 페이지 `/ddsm/admin/`에 접속합니다.
2. 센터를 선택하고 해당 센터의 관리자 비밀번호를 입력합니다.
3. 배송일을 선택하고 택배사에서 제공받은 원본 파일을 업로드합니다. 지원 파일 형식은 XLSX, XLSM, XLS, CSV입니다.
4. 당일 배송 목록과 전체 배송 지도를 확인합니다. 운송장번호, 수취인, 주소, 착불 여부, 연락처 등의 매핑 결과를 확인하세요.
5. 주소나 좌표가 누락된 건은 **위치 미확인 배송지**에서 확인하고 주소 또는 지도 위치를 직접 수정합니다.
6. 반복 배송 고객은 **정기배송 고객으로 등록**하여 다음 업로드에서 주소와 위치를 참조하도록 합니다. 동일 이름의 다른 고객을 잘못 연결하지 않도록 확인하세요.
7. **기사 연결 코드**를 발급하고 승인된 기사에게 숫자 8자리를 전달합니다.
8. 배송 시작 후에는 **배송현황**에서 기사별 등록·완료 내역과 배송 사진을 확인할 수 있습니다.

택배사마다 원본 파일의 열 이름과 주소 형식이 다를 수 있습니다. 실제 운영 전 개인정보가 없는 샘플 원본으로 파싱 및 운송장 조회를 검증하세요. 모든 택배사 양식의 자동 인식을 보장하지 않습니다.

## 7. 배송 기사 사용법

### 처음 접속할 때

기사 페이지 `/ddsm/`에 접속한 후 센터에서 받은 숫자 8자리 코드를 입력합니다. 코드는 발급 후 10분간 유효하며, 새 코드를 발급하거나 서버를 재시작하면 기존 코드는 만료됩니다.

연결 이후 같은 브라우저에서 일반적으로 재로그인 없이 사용할 수 있습니다. 브라우저 데이터를 삭제하거나 로그아웃하면 다시 연결해야 합니다. 실제 사용 중에는 동일한 브라우저를 유지하는 것을 권장합니다.

### 스캔 → 지도 → 목록

| 단계 | 작업 |
| --- | --- |
| 1. 스캔 | 배송일과 회차를 선택하고 실제 차량에 실을 물건의 운송장을 스캔합니다. |
| 2. 확인 | 등록된 수취인과 주소를 확인합니다. 미등록 운송장은 원본과 배송일을 확인합니다. |
| 3. 지도 | 현재 회차에 등록된 배송지를 확인합니다. 마커를 눌러 좌우 순번 휠로 순서를 지정하고 저장합니다. |
| 4. 배송 | 마커 또는 목록에서 내비게이션을 열고 지정한 순서로 배송합니다. 필요하면 주소·위치·회차를 수정합니다. |
| 5. 완료 | 완료 버튼을 누르고 사진을 촬영하거나 파일을 선택하여 사진 저장 및 배송완료를 실행합니다. |
| 6. 마감 | 목록과 배송현황을 확인하고 미완료 건 및 서버 동기화 상태를 점검합니다. |

운송장번호는 현재 13자리 기본번호와 3자리 수량 접미사가 붙은 16자리 형식을 지원합니다. 예를 들어 `1234567890123`과 `1234567890123001`은 같은 기본 운송장으로 조회합니다. 다른 택배사의 번호 체계는 별도 확인이 필요합니다.

배송 사진은 서버에 저장되며 기사·관리자 화면에서 조회할 수 있습니다. 기기에도 보관하려면 완료 화면에서 기기 저장 옵션을 선택합니다. 다운로드 동작은 브라우저와 운영체제에 따라 다를 수 있습니다.

지도에는 위치가 확인된 배송지가 표시됩니다. 완료된 배송지는 상태를 구분해 확인할 수 있습니다. 현재 순번은 기사가 지정하는 방식이며 자동 최적 경로 산출을 보장하지 않습니다.

## 8. 문제 해결

| 증상 | 확인 사항 |
| --- | --- |
| 웹은 열리지만 연결이 안 됨 | API 주소, HTTPS, Nginx 경로, Health, DDSM_ORIGIN 설정 확인 |
| 센터가 나타나지 않음 | center.env 설정과 서버 재시작 여부 확인 |
| 관리자 로그인 실패 | 선택한 센터 및 비밀번호 설정 여부 확인 |
| 기사 연결 실패 | 8자리 코드 유효시간, 새 코드 발급 여부 확인 |
| 운송장이 조회되지 않음 | 해당 센터의 원본 업로드 여부, 배송일 및 번호 체계 확인 |
| 카메라 인식이 안 됨 | HTTPS, 카메라 권한, ZXing 파일 및 브라우저 지원 확인 |
| 지도 또는 주소 검색 실패 | NAVER Maps Client ID, 웹 서비스 URL 등록, 지오코딩 설정 확인 |
| 배송지 마커가 없음 | 주소 및 좌표의 위치 미확인 여부, 현재 회차와 등록 상태 확인 |
| 사진 저장 또는 동기화 실패 | 네트워크, API 응답, 프록시 업로드 제한 확인. 작업 사본 기능이 표시되면 보관 |

## 9. 데이터 관리 및 운영 시 주의사항

- 실제 고객의 이름, 주소, 연락처, 운송장, 배송 사진은 공개 GitHub에 올리지 마세요.
- `center.env`, 관리자 키, 센터 초대키, DB, 사진, 백업은 비공개 서버 디렉터리에 보관하고 접근 권한을 제한합니다.
- 센터별 DB는 `DDSM_DB_PATH`에 지정한 파일명 뒤에 `.centers/`가 붙는 디렉터리에 저장됩니다. 예: `ddsm.db.centers/center-01.sqlite`. DB 및 사진 저장 위치 전체를 확인하여 백업·복원 절차를 마련하세요.
- 서버 업데이트 전 기존 설정과 데이터를 백업하고 테스트 환경에서 검증하세요.
- 기존 DSD 데이터는 자동으로 이전하지 않습니다.
- 저장 데이터 암호화, 사진 및 개인정보 보존·삭제 정책, 기기별 인증 폐기 등은 운영자가 추가 검토해야 합니다. 센터 연결 권한은 승인된 기사에게만 부여하세요.
- GitHub에서 소스를 공개하고 있다는 사실만으로 재배포·상업적 이용에 대한 허가 범위가 자동으로 정해지는 것은 아닙니다. 해당 저장소의 라이선스 및 권리자의 허가 범위를 확인하세요.

## 10. 개발 및 개선

DDSM은 실제 배송 업무 과정에서 발생하는 운송장 매칭, 주소 오류, 물량 분류, 배송 순서 관리 문제를 개선하기 위한 프로젝트입니다.

오류를 제보할 때는 사용 환경, 오류가 발생한 단계, 재현 방법을 남겨 주세요. 고객의 실제 개인정보와 인증 정보는 제거해 주세요.

- [GitHub 저장소](https://github.com/lee1431/stance)
- [Issues](https://github.com/lee1431/stance/issues)
- [API 배포 안내](api/README.md)
