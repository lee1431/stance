# DSD 로그인/데이터 프록시 설정

`llsshh.com`은 `stance` GitHub Pages 정적 사이트라 Flask 템플릿이나 POST 로그인을 직접 처리하지 못합니다. **이 파일만 커밋해서는 Cloudflare Worker가 활성화되지 않습니다.**

1. S21에서 `templates/login.html`이 존재하는지 확인하고, `http://127.0.0.1:8851/login`이 200인지 확인하세요. `https://localflow.ddns.net/dsd/login`이 500이라면 Flask 로그에서 원인을 확인하세요. 로그인 템플릿 파일 누락이 흔한 원인입니다.
2. Cloudflare Workers & Pages에서 Worker를 하나 생성해 `worker.js` 소스를 배포합니다. llsshh.com DNS가 Cloudflare proxy(주황 구름)로 설정되어 있어야 합니다.
3. Worker Settings > Domains & Routes > Add > Route에서 `llsshh.com/dsd/login*` 및 `llsshh.com/dsd/api/*` 두 경로를 지정합니다. GitHub Pages가 제공하는 `/dsd/` 정적 프론트 페이지는 그대로 유지합니다.
4. `https://llsshh.com/dsd/api/health`가 HTTP 200 JSON `{"ok":true}`를 반환하는지 확인합니다. 이후 `https://llsshh.com/dsd/login`에서 Jinja 소스가 보이지 않는지 확인합니다.

S21 nginx는 `/dsd/` 경로를 Flask 8851의 `/`에 연결해야 합니다. Worker는 같은 브라우저 출처에서 Flask 세션 쿠키와 CSRF 토큰을 사용하게 해 줍니다. Flask 비밀번호나 세션 secret, NAVER Client Secret을 프론트 파일에 기록하지 마세요.

Cloudflare route 배포는 해당 계정 권한이 있어야 실제 적용됩니다.