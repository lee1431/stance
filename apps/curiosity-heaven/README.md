# 호기심 천국 — 질문 저장 계약

공개 페이지: https://llsshh.com/apps/curiosity-heaven/

## 확인된 UVB (2026-10-14)

앱 목록 GET https://localflow.ddns.net/uvb/admin/apps 에 curiosity-heaven이 enabled=true로 등록되어 있다.
실제 GET/POST와 llsshh.com Origin의 CORS 응답을 확인했다. 이 서버는 해당 앱에 토큰 없이 접근 가능하다.
관리자 키나 토큰을 프런트엔드에 추가하지 않는다.

- 목록 GET https://localflow.ddns.net/uvb/v1/apps/curiosity-heaven/items?page=1&page_size=200&order=asc
- 등록 POST https://localflow.ddns.net/uvb/v1/apps/curiosity-heaven/items (Content-Type: application/json)
- 조회 응답: {ok:true,data:{items:[{id,created_at,updated_at,data:{...}}],page,page_size,total,has_more}}
- 등록 응답: {ok:true,data:{id,created_at,updated_at,data:{...}}}
- created_at/updated_at: 서버 생성 Unix 초.
- 항목 본문은 item.data다. POST는 아래 JSON을 직접 보낸다. wrapper를 보내지 않는다.

```json
{
  "schema_version": 1,
  "question": "물고기는 물을 마실까?",
  "category": "물과 자연",
  "date_key": "2026-10-14",
  "batch_id": "daily-2026-10-14",
  "source": "gpt-daily",
  "question_key": "정규화된 질문의 SHA-256"
}
```

date_key는 Asia/Seoul 등록일이다. 기존 50개는 initial-2026-10-14 배치로 원문과 분류를 보존해 이관했다.
seeds.json은 API 실패 시 사용하는 최초 50개 복구본이며 정상 목록은 항상 API에서 읽는다.

## 추가·중복·부분 성공

1. order=asc로 has_more=false까지 모든 페이지를 읽는다. 일별 배치도 전체 읽기 후 확인한다.
2. NFKC → 소문자 → 공백·구두점·기호 제거로 질문 키를 만든다. Python import_questions.py는 정규화된 한글/문자/숫자의 SHA-256을 기록한다.
3. 문자열 중복뿐 아니라 의미 중복도 생성 단계에서 기존 모든 질문과 비교해 제거한다.
4. 한국 날짜별 batch_id=daily-YYYY-MM-DD를 사용한다. 이미 해당 배치에 50개가 있으면 추가하지 않는다.
5. 부분 성공이면 같은 배치에서 빠진 수만 추가한다. POST는 순차 실행한다. 응답 유실 시 GET으로 저장 여부를 확인한 뒤 재시도한다.
6. 로컬 JSON 배열로 준비했다면 python3 import_questions.py batch.json을 사용한다. 이 도구는 입력 중복을 검사하고 이미 존재하는 질문을 건너뛴다. 일별 목표 개수와 의미 중복 검토는 호출자가 수행한다.
7. 저장 후 전체 목록, 날짜별 배치, 질문 수 증가와 공개 페이지를 확인한다. 소스 파일의 groups를 수정하지 않는다.

UVB는 자유 JSON 저장이며 question_key의 서버 유일성 제약이나 원자적 배치 잠금이 없다.
동시 작성자가 있으면 경쟁에 의한 중복/유실을 서버에서 완전히 막을 수 없다. 한 배치는 한 실행에서 순차 등록한다.
페이지는 정규화된 질문 중복을 한 번만 표시하고 제외 개수를 알린다. 서버 항목을 삭제하지 않는다.

## 읽기·화면·오류

모든 API 페이지를 읽은 후 검색·분류·무작위 선택을 전체 목록에 적용한다.
DOM은 60개씩 더 표시한다. 이 제한은 검색·무작위 대상 수를 제한하지 않는다.
목록 전체 수가 읽기 중 변경되면 최대 3회 다시 읽는다. 반복 페이지·불완전 응답은 오류로 처리하며 부분 목록을 최신이라고 표시하지 않는다.
등록일/카테고리는 텍스트로 삽입하고 질문은 encodeURIComponent로 Google 검색 URL을 만든다.
페이지가 보이는 동안 5분 주기로 갱신하며 다시 불러오기 버튼도 제공한다.
장애 때 현재 목록 → 마지막 성공 목록(localStorage) → 최초 50개 순서로 복구하고 최신 조회 실패를 명시한다.
정상 빈 응답은 0개로 표시한다. 로컬 저장소가 차단되거나 가득 차도 정상 API 이용을 계속한다.
