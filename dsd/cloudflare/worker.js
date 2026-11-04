/** DSD gateway. Attach Worker routes: llsshh.com/dsd/login* and llsshh.com/dsd/api/* */
const UPSTREAM_ORIGIN = "https://localflow.ddns.net";
export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const path = incoming.pathname;
    if (path !== "/dsd/login" && path !== "/dsd/login/" && !path.startsWith("/dsd/api/")) {
      return new Response("Not Found", {status:404});
    }
    const upstream = new URL(UPSTREAM_ORIGIN);
    upstream.pathname = path;
    upstream.search = incoming.search;
    try {
      const res = await fetch(new Request(upstream, request), {redirect:"manual"});
      const headers = new Headers(res.headers);
      headers.set("Cache-Control","private, no-store");
      return new Response(res.body,{status:res.status,statusText:res.statusText,headers});
    } catch (_error) {
      return new Response("S21 Flask upstream connection failed",{status:502,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
    }
  }
};
