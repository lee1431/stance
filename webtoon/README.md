# STANCE WEBTOON MVP

정적 웹툰 연재 사이트. /webtoon/ 에서 접근합니다.

## 등록 방법
`works.json`의 `works` 배열에 작품을 추가합니다. 각 작품의 `episodes` 배열에 회차를 추가합니다.

예시:
```json
{
  "id": "sword-of-darkness",
  "title": "흑기의 검",
  "author": "STANCE",
  "description": "작품 소개",
  "status": "연재중",
  "published": true,
  "cover": "./assets/sword-of-darkness/cover.webp",
  "episodes": [
    {
      "id": "episode-001",
      "number": 1,
      "title": "첫 번째 대결",
      "date": "2026-10-30",
      "published": true,
      "images": [
        "./assets/sword-of-darkness/001/001.webp",
        "./assets/sword-of-darkness/001/002.webp"
      ]
    }
  ]
}
```

컷 이미지 파일은 순서대로 배치합니다. `published: false`인 작품/회차는 공개되지 않습니다. 모바일 세로 스크롤, 이미지 지연 로딩, 이전/다음 회차 이동, 로컬 이어보기 기록을 지원합니다.

현재는 정적 JSON 방식이며 로그인/업로드 관리자 화면, 구글 드라이브 동기화, 자동 작화, 예약 발행은 아직 구현하지 않았습니다. 공개 전 저작권과 이미지 접근 권한을 확인하세요.
