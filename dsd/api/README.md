# DSD 센터 관리자 API — 고정 관리자 계정

이 폴더의 `admin.py`는 **갤럭시 S10**에서 실행할 `~/dsd/admin.py`의 교체용 파일입니다.
기존 DSD 기사 서버, 사용자 가입/로그인 API, Nginx 경로는 수정하지 않아도 됩니다.

## 기능
- 고정 관리자 ID (기본값 `admin`)
- 서버 환경변수의 scrypt 비밀번호 **해시**로 로그인; 일반 사용자 가입 불필요
- 인증 성공 시 12시간 유효한 무작위 관리자 토큰 발급
- 토큰은 브라우저 탭 메모리에서만 유지하며 새로고침 시 로그인 화면으로 돌아감
- 로그아웃 시 서버 저장 토큰 폐기
- 당일 원본 엑셀 업로드 (XLSX, XLSM, XLS, CSV), 전 열 원본 보존
- 전체 배송 데이터/지도 좌표 조회, 과거 고유 배송지 재참조

## S10 적용

원래 파일 백업 후 S10의 `~/dsd/admin.py`를 이 파일로 교체하세요.
(서버 작업은 GitHub 업로드만으로 자동 적용되지 않습니다.)

```bash
cd ~/dsd
cp admin.py admin.py.bak
curl -fL https://raw.githubusercontent.com/lee1431/stance/main/dsd/api/admin.py -o admin.py.new
python -m py_compile admin.py.new
mv admin.py.new admin.py
```

S10의 기존 `dsd.py` 아래 코드가 **이미 들어있다면 수정 불필요**합니다.

```python
from admin import install_admin
install_admin(app, connect, require_session, throttled)
```

**관리자 비밀번호는 최초 한 번만** 설정하세요. Termux에서 해시 생성:

```bash
python - <<'PY'
from getpass import getpass
from werkzeug.security import generate_password_hash
print(generate_password_hash(getpass("관리자 비밀번호: "), method="scrypt"))
PY
```

서버 시작 스크립트에서 Waitress 실행보다 앞에 다음 환경변수 설정:

```bash
export dsd_ADMIN_ID="admin"
export dsd_ADMIN_PASSWORD_HASH='scrypt:32768:8:1$실제_솔트$실제_해시'
```

위 해시 문자열은 **형식 예시**입니다. 출력된 전체 값을 작은따옴표로 묶어 입력하세요.
`dsd_ADMIN_PHONES` 변수는 더 이상 관리자 로그인에 사용하지 않습니다.
기존 `dsd_SECRET_KEY`, `dsd_ORIGIN`, `dsd_DB_PATH` 설정은 그대로 유지하세요.
Waitress를 완전히 종료 후 기존 시작 스크립트로 다시 실행해야 변경이 적용됩니다.

## API
- `POST /dsd/api/admin/login`: JSON `{"id":"admin","password":"비밀번호"}`. 응답 `token` 반환
- `POST /dsd/api/admin/logout`: `Authorization: Bearer <token>`
- `GET /dsd/api/admin/deliveries?date=YYYY-MM-DD`
- `POST /dsd/api/admin/import`: multipart `date`, `file`
- `GET /dsd/api/admin/destinations?q=...`
- `POST /dsd/api/admin/deliveries/{id}/location`: 좌표 저장

로그인 이외의 관리자 API는 `Authorization: Bearer <token>` 헤더가 필요합니다.
인증 정보는 SQLite의 `dsd_admin_sessions`에 **토큰의 SHA-256 해시**만 저장합니다.
기존 `destinations`, `admin_deliveries`, `destination_aliases` 데이터는 보존합니다.

## 화면
관리자 페이지: `https://llsshh.com/dsd/admin/`
현재 CORS 허용된 API 프록시: `https://mrdindoin.ddns.net/dsd-center-api/`.
서버는 `Origin: https://llsshh.com`, `Authorization` 헤더를 허용해야 합니다.
이 방식은 쿠키에 의존하지 않아 서로 다른 도메인으로 인한 세션 문제를 피합니다.

주의: 사용자/배송 정보가 포함된 원본 파일은 승인된 자료만 업로드하세요. 서버 DB 백업과 접근 통제가 필요합니다.

## 고정 엑셀 컬럼 (17개 연속 열)

이 원본 파일 형식은 **열 위치와 제목이 모두 일치할 때** 아래의 고정 매핑을 사용합니다. 첫 번째 열 앞에 구분번호·인덱스 등 추가 열이 있으면 해당 열은 그대로 보존하고, 그 다음 열부터 17개 제목을 검사합니다.

| 열 | 헤더 | 처리 |
|---|---|---|
| A | 일자 | 원본에 보존 |
| B | 발송지 | 원본에 보존 |
| C | 운송장번호 | 운송장 |
| D | 발화주 | 발송인 |
| E | 수화주 | 수취인·상호명 |
| F | 품명 | 물품명 |
| G | 포장 | 원본에 보존 |
| H | 상품 | 원본에 보존 |
| I | 수량 | 원본에 보존 |
| J | 상태 | 배송상태 |
| K | 현불운임 | 원본에 보존 |
| L | 착불운임 | 착불운임 |
| M | 출고제비용 | 원본에 보존 |
| N | 합계 | 원본에 보존 |
| O | 특기사항 | 원본에 보존 |
| P | 수화주 지번주소 | 지번주소 |
| Q | 수화주 도로명주소 | 도로명주소 |

- 배송지 주소는 **Q열(도로명) 우선, 비어 있으면 P열(지번)** 을 사용합니다. 두 주소 값은 모두 원본에 보존됩니다.
- 제목에 단순히 `수화주`가 들어 있다는 이유만으로 받는 사람 이름으로 분류하지 않습니다.
- 관리자 화면에서도 원본 A~Q 순서를 유지하고, 동일 데이터 중복 표시는 제거합니다.
- 이 고정 헤더가 아닌 다른 업체 엑셀은 기존 이름 매칭 로직으로 가져옵니다.
- 이미 잘못 분류된 자료는 서버에 새 `admin.py`를 적용·재시작한 다음 **동일 날짜 원본 엑셀을 다시 업로드**해야 수정된 표준값이 반영됩니다.
