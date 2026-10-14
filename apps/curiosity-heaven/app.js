/* UVB stores each question in item.data; pagination is independent of card rendering. */
const API = "https://localflow.ddns.net/uvb/v1/apps/curiosity-heaven/items";
const CACHE = "curiosity-heaven-questions-v1";
const PAGE_SIZE = 200, CARD_PAGE_SIZE = 60;
const filters = document.querySelector("#filters"), cards = document.querySelector("#cards");
const search = document.querySelector("#search"), count = document.querySelector("#count");
const status = document.querySelector("#status"), refresh = document.querySelector("#refresh");
const more = document.querySelector("#more"), random = document.querySelector("#random");
let items = [], current = "전체", visible = CARD_PAGE_SIZE, loading = false, hasSnapshot = false;

function questionKey(question) {
  return question.normalize("NFKC").toLocaleLowerCase("ko").replace(/[\p{P}\p{Z}\p{S}\s]/gu, "");
}
function normalizeRows(rows) {
  const seen = new Set(), result = [];
  let invalid = 0, duplicates = 0;
  for (const row of rows) {
    const data = row && row.data;
    if (!data || typeof data.question !== "string" || !data.question.trim() ||
        typeof data.category !== "string" || !data.category.trim()) { invalid++; continue; }
    const question = data.question.trim(), key = questionKey(question);
    if (!key) { invalid++; continue; }
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    let date = /^\d{4}-\d{2}-\d{2}$/.test(data.date_key || "") ? data.date_key : "";
    if (!date && typeof row.created_at === "number" && Number.isFinite(row.created_at)) {
      date = new Intl.DateTimeFormat("sv-SE", {timeZone: "Asia/Seoul"}).format(new Date(row.created_at * 1000));
    }
    result.push({id: row.id, question, category: data.category.trim(), date_key: date});
  }
  return {items: result, invalid, duplicates};
}
async function getPage(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(API + "?page=" + page + "&page_size=" + PAGE_SIZE + "&order=asc",
        {signal: controller.signal, cache: "no-store"});
      if (!response.ok) {
        const error = new Error("HTTP " + response.status);
        error.permanent = response.status < 500 && response.status !== 429;
        throw error;
      }
      const body = await response.json(), data = body.data;
      if (body.ok !== true || !data || !Array.isArray(data.items) || data.page !== page ||
          !Number.isInteger(data.total) || data.total < 0 || typeof data.has_more !== "boolean") {
        const error = new Error("Invalid API response"); error.permanent = true; throw error;
      }
      return data;
    } catch (error) {
      if (error.permanent || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    } finally { clearTimeout(timer); }
  }
}
async function readAllQuestions() {
  // Ascending order keeps new append-only daily batches from shifting earlier pages.
  // Restart if totals change; never publish a partial or inconsistent snapshot.
  for (let pass = 0; pass < 3; pass++) {
    const rows = [], ids = new Set();
    let page = 1, expectedTotal = null, restart = false;
    while (true) {
      const data = await getPage(page);
      if (expectedTotal === null) expectedTotal = data.total;
      if (data.total !== expectedTotal) { restart = true; break; }
      if (!Number.isInteger(data.page_size) || data.page_size < 1 ||
          data.items.length > data.page_size || (data.has_more && !data.items.length)) {
        throw new Error("Invalid pagination");
      }
      for (const row of data.items) {
        if (!row || typeof row.id !== "string" || ids.has(row.id)) {
          throw new Error("Repeated or invalid page item");
        }
        ids.add(row.id); rows.push(row);
      }
      if (rows.length > expectedTotal || page > 10000) throw new Error("Invalid pagination");
      if (!data.has_more) break;
      page++;
    }
    if (restart) continue;
    const head = await getPage(1);
    if (head.total !== expectedTotal) continue;
    if (rows.length !== expectedTotal) throw new Error("Incomplete question list");
    return normalizeRows(rows);
  }
  throw new Error("Question list changed during loading");
}
function filteredItems() {
  const term = search.value.trim().toLocaleLowerCase("ko");
  return items.filter(x => (current === "전체" || x.category === current) &&
    (x.question + " " + x.category).toLocaleLowerCase("ko").includes(term));
}
function searchURL(question) { return "https://www.google.com/search?q=" + encodeURIComponent(question); }
function render() {
  const categories = [...new Set(items.map(x => x.category))];
  if (current !== "전체" && !categories.includes(current)) current = "전체";
  filters.replaceChildren();
  for (const category of ["전체", ...categories]) {
    const button = document.createElement("button");
    button.textContent = category; button.className = category === current ? "active" : "";
    button.setAttribute("aria-pressed", String(category === current));
    button.onclick = () => { current = category; visible = CARD_PAGE_SIZE; render(); };
    filters.append(button);
  }
  const filtered = filteredItems(), displayed = filtered.slice(0, visible);
  count.textContent = filtered.length + "개의 질문" + (filtered.length !== items.length ? " / 전체 " + items.length + "개" : "");
  random.disabled = filtered.length === 0;
  cards.replaceChildren();
  displayed.forEach(x => {
    const a = document.createElement("a"); a.className = "card";
    a.target = "_blank"; a.rel = "noopener noreferrer"; a.href = searchURL(x.question);
    const n = document.createElement("div"); n.className = "num";
    n.textContent = x.category + (x.date_key ? " · " + x.date_key : "");
    const q = document.createElement("div"); q.className = "question"; q.textContent = x.question;
    const h = document.createElement("div"); h.className = "hint"; h.textContent = "궁금증 탐험하기 ↗";
    a.append(n, q, h); cards.append(a);
  });
  if (!filtered.length) {
    const p = document.createElement("p");
    p.textContent = loading && !hasSnapshot ? "질문을 불러오는 중입니다." :
      items.length ? "검색 조건에 맞는 질문이 없습니다." : "표시할 질문이 없습니다.";
    cards.append(p);
  }
  more.hidden = displayed.length >= filtered.length;
  more.textContent = "질문 더 보기 (" + displayed.length + " / " + filtered.length + ")";
}
function notice(message, error = false) {
  status.textContent = message;
  status.className = error ? "status error" : "status";
}
function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE));
    if (!cached || !Array.isArray(cached.items) || typeof cached.saved_at !== "string") return null;
    const normalized = normalizeRows(cached.items.map(data => ({data})));
    if (normalized.invalid) return null;
    return {...normalized, saved_at: cached.saved_at};
  } catch { return null; }
}
async function loadQuestions() {
  if (loading) return;
  loading = true; refresh.disabled = true; notice("최신 질문을 불러오는 중입니다."); render();
  try {
    const result = await readAllQuestions();
    items = result.items; hasSnapshot = true;
    try { localStorage.setItem(CACHE, JSON.stringify({items, saved_at: new Date().toISOString()})); } catch {}
    const details = [];
    if (result.duplicates) details.push("중복 " + result.duplicates + "개 제외");
    if (result.invalid) details.push("형식 오류 " + result.invalid + "개 제외");
    notice(items.length ? "최신 질문 " + items.length + "개를 불러왔습니다." + (details.length ? " (" + details.join(", ") + ")" : "") :
      "아직 등록된 질문이 없습니다.");
  } catch (error) {
    console.error("Question loading failed:", error);
    let fallback = hasSnapshot ? "현재 표시된 목록을 유지합니다." : "";
    if (!hasSnapshot) {
      const cached = readCache();
      if (cached) {
        items = cached.items; hasSnapshot = true;
        fallback = "마지막으로 저장된 목록을 표시합니다 (" + cached.saved_at.slice(0, 10) + ").";
      } else {
        try {
          const response = await fetch("./seeds.json", {cache: "no-cache"});
          if (!response.ok) throw new Error("Seed unavailable");
          const seeds = await response.json();
          if (!Array.isArray(seeds)) throw new Error("Invalid seed");
          const normalized = normalizeRows(seeds.map(data => ({data})));
          if (normalized.invalid) throw new Error("Invalid seed");
          items = normalized.items; hasSnapshot = true;
          fallback = "초기 질문 50개를 표시합니다.";
        } catch { fallback = "질문 목록을 표시할 수 없습니다."; }
      }
    }
    notice("최신 질문을 가져오지 못했습니다. " + fallback + " 최신 목록은 다시 불러오기를 눌러 확인하세요.", true);
  } finally {
    loading = false; refresh.disabled = false; render();
  }
}
search.addEventListener("input", () => { visible = CARD_PAGE_SIZE; render(); });
random.onclick = () => {
  const pool = filteredItems();
  if (pool.length) window.open(searchURL(pool[Math.floor(Math.random() * pool.length)].question), "_blank", "noopener,noreferrer");
};
more.onclick = () => { visible += CARD_PAGE_SIZE; render(); };
refresh.onclick = loadQuestions;
let lastRefresh = Date.now();
function autoRefresh() {
  if (!document.hidden && Date.now() - lastRefresh >= 5 * 60 * 1000) {
    lastRefresh = Date.now(); loadQuestions();
  }
}
setInterval(autoRefresh, 60 * 1000);
document.addEventListener("visibilitychange", autoRefresh);
loadQuestions();
