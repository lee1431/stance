# DDSM — Daily · Scan · Delivery

**새 DDSM 프로젝트는 독립적으로 운영합니다.** 이전에 만든 `stance/dsd/`와 구분합니다.

## 확정 구성

| 영역 | 경로 |
|---|---|
| 기사 웹 | `lee1431/stance/ddsm/` → `https://llsshh.com/ddsm/` |
| 관리자 웹 | `lee1431/stance/ddsm/admin/` |
| G10 백엔드 코드 | `lee1431/stance/ddsm/api/` → G10 `~/ddsm/`에 배포 |
| 전체 API | `https://mrdindoin.ddns.net/ddsm/api/` |
| 인증 API | `/ddsm/api/auth/` |
| 기사 API | `/ddsm/api/driver/` |
| 관리자 API | `/ddsm/api/admin/` |

기존 GitHub `stance/dsd/`, G10의 기존 `~/dsd/`, `/dsd/api/`, `/dsd-center-api/`는 건드리지 않습니다.
새 DDSM은 별도 Waitress 프로세스와 SQLite DB에서 운영합니다.

## 데이터 흐름

1. 관리자가 DDSM 관리자 웹에서 배송일별 원본 엑셀을 업로드하면 G10 DDSM DB에 저장합니다.
2. 기사가 전화번호와 비밀번호로 로그인합니다. 토큰은 12시간 유효하며 브라우저 메모리에만 보관합니다.
3. 기사가 스캔하면 해당 배송일의 원본 운송장을 서버에서 조회합니다. 성공할 때만 배송 목록에 등록합니다.
4. 배송 목록, 회차, 방문 순서, 물품번호, 완료 상태, 메모를 **기사 계정 + 배송일**로 저장합니다. 센터 구분은 사용하지 않습니다.
5. 다른 브라우저는 화면이 활성화된 경우 약 3초 간격으로 서버 자료를 조회합니다.
6. 두 기기가 동시에 저장하면 409 충돌을 알리고 잘못된 덮어쓰기를 방지합니다. 자동 병합은 아직 없습니다.

서버가 해당 날짜의 빈 작업을 반환하고 이 기기에 로컬 자료가 있으면 최초 이전을 시도합니다.
기존 로컬 자료는 별도 백업 키로 보존됩니다. 서버가 이미 자료를 가진 날에는 서버 데이터를 우선합니다.

## API

- `GET /ddsm/api/health`
- `POST /ddsm/api/auth/register`, `POST /ddsm/api/auth/login`
- `GET /ddsm/api/auth/me`, `POST /ddsm/api/auth/logout`
- `GET /ddsm/api/driver/waybill?date=YYYY-MM-DD&barcode=...`
- `GET /ddsm/api/driver/work-day?date=YYYY-MM-DD`
- `PUT /ddsm/api/driver/work-day` (`{date,revision,day}`)
- `POST /ddsm/api/admin/unlock`, `GET /ddsm/api/admin/me`
- `POST /ddsm/api/admin/import`, `GET /ddsm/api/admin/deliveries?date=YYYY-MM-DD`
- `GET /ddsm/api/admin/destinations?q=...`
- `POST /ddsm/api/admin/deliveries/<id>/location`

## 운영 및 배포

GitHub 코드 반영만으로 G10에서 API가 작동하지 않습니다.
G10에 `ddsm/api/` 소스를 설치하고 `/ddsm/api/` Nginx 프록시를 새 Waitress 포트에 연결해야 합니다.
배포 절차는 [api/README.md](api/README.md)를 확인하세요.

새 DB는 옛 G10 DSD DB의 원본 엑셀을 자동 공유하지 않습니다.
필요한 날짜의 엑셀은 DDSM 관리자에서 다시 업로드하거나 검증된 이관 과정을 거쳐야 합니다.

**미완료:** G10 실제 배포, Nginx 연결, 실기 다중 브라우저 검증, 휴대폰 SMS 본인확인 및 계정 복구.
