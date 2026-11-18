# DDSM 사용자 인증 API (초기 버전)

기존 `dsd` 서버와 별개로 `ddsm/api/app.py`에 Flask 인증 API를 추가했습니다. 실제 서버 배포·연결은 아직 수행하지 않았습니다.

## 실행 준비

```bash
pip install -r ddsm/api/requirements.txt
export DDSM_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
export DDSM_ORIGIN=https://llsshh.com
export DDSM_DB_PATH=/secure/path/ddsm_auth.sqlite3
waitress-serve --listen=127.0.0.1:8862 --call app:create_app
```

위 명령은 `ddsm/api` 디렉터리에서 실행한다는 전제입니다. Nginx는 HTTPS `/ddsm/api/`를 이 서버에 프록시해야 하며 Flask가 **동일한 전체 경로** `/ddsm/api/auth/login`을 받도록 구성해야 합니다. 쿠키는 HTTPS, HttpOnly, SameSite=Lax, `/ddsm/api` 경로입니다. 서버는 URL 기준 동일 출처의 POST를 검사합니다.

## 경로

- `GET /ddsm/api/health` 서비스 상태
- `POST /ddsm/api/auth/register` JSON `{ "phone": "01012345678", "password": "10자 이상" }`
- `POST /ddsm/api/auth/login` 동일 형식
- `GET /ddsm/api/auth/me` 인증 세션 조회
- `POST /ddsm/api/auth/logout` 세션 종료. `X-CSRF-Token` 필요

암호는 평문 저장하지 않고 Werkzeug scrypt로 해시합니다. 서버 환경변수의 `DDSM_SECRET_KEY`는 저장소에 넣지 마세요. SQLite 데이터와 비밀키를 안전한 위치에 보관하세요.

## 주의

- **SMS 번호 소유자 인증은 아직 없습니다.** 번호를 아는 사람이 선점해 가입할 수 있으므로 실사용 공개 가입 전에 휴대폰 인증·계정복구 절차를 추가해야 합니다.
- IP/전화번호의 기본 속도 제한은 프로세스 메모리 기준이므로 여러 워커 환경에서는 Nginx 또는 Redis 기반 속도 제한을 추가하세요.
- 현재 이 API는 **계정 가입·로그인만 지원**합니다. 기존 DDSM 배송 데이터는 여전히 브라우저 localStorage에 있으며, 로그인만으로 서버 동기화되지 않습니다.
- 화면의 '서버 없이 이 기기에서 계속'은 기존 로컬 자료에 접근하는 버튼이며 서버 인증을 대체하지 않습니다. 민감한 배송 데이터를 API로 저장·공유하기 전에는 인증 강제와 사용자 권한 검증을 적용해야 합니다.
- 실제 서버에 연결되지 않았다면 화면의 가입·로그인 버튼은 연결 오류를 보여 주며, 비밀번호는 브라우저 저장소에 보관하지 않습니다.
