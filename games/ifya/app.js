(() => {
  "use strict";
  const API = "https://localflow.ddns.net/ifya";
  const TOKEN_KEY = "ifya_player_token";
  const PLAYER_KEY = "ifya_player_name";

  const state = { assets: new Map(), me: null, selected: null, side: null, leverage: 1 };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const fmt = (n, digits = 0) => Number(n).toLocaleString("ko-KR", { maximumFractionDigits: digits });
  const money = (n) => "₩" + fmt(n, 0);

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers["X-Player-Token"] = token;
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const r = await fetch(API + path, { ...options, headers, cache: "no-store" });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
    if (!r.ok) throw new Error(data?.error || data?.detail || ("HTTP " + r.status));
    return data;
  }

  function setStatus(text) { $("#statusBar").textContent = text; }
  function setNoise() {
    $("#noise").classList.add("on");
    setTimeout(() => $("#noise").classList.remove("on"), 420);
  }

  function renderState(data) {
    if (data.season) $("#seasonName").textContent = data.season.name || "Season";
    (data.assets || []).forEach(a => state.assets.set(a.symbol, a));
    state.assets.forEach((a, symbol) => {
      const p = document.querySelector('[data-price="' + symbol + '"]');
      const c = document.querySelector('[data-change="' + symbol + '"]');
      if (p) {
        const digits = symbol === "USD" ? 2 : (a.last_price < 1000 ? 2 : 0);
        p.textContent = a.last_price == null ? "-" : fmt(a.last_price, digits) + " " + (a.quote_currency || "");
      }
      if (c) {
        const v = Number(a.last_change_pct || 0);
        c.textContent = (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
        c.className = v > 0 ? "up" : v < 0 ? "down" : "";
      }
    });
    const leaders = [...state.assets.values()].filter(a => a.last_change_pct != null).sort((a,b) => Math.abs(b.last_change_pct)-Math.abs(a.last_change_pct));
    if (leaders[0]) {
      const a = leaders[0];
      $("#ticker").textContent = a.symbol + " " + (Number(a.last_change_pct) >= 0 ? "▲ " : "▼ ") + Number(a.last_change_pct).toFixed(2) + "% · 실시간 시장 데이터 연결됨";
    } else {
      $("#ticker").textContent = "실시간 가격 정보 대기 중";
    }
    setStatus("백엔드 연결됨 · " + new Date().toLocaleTimeString("ko-KR"));
  }

  async function loadState() {
    try { renderState(await api("/api/state")); }
    catch (e) { setStatus("백엔드 연결 실패: " + e.message); }
  }

  function renderMe(me) {
    state.me = me;
    $("#nickname").textContent = me.nickname;
    $("#equity").textContent = money(me.equity);
    const rp = Number(me.return_pct || 0);
    $("#returnPct").textContent = (rp >= 0 ? "+" : "") + rp.toFixed(2) + "%";
    $("#returnPct").style.color = rp >= 0 ? "var(--green)" : "var(--red)";
    $("#cash").textContent = money(me.cash);
    $("#positionCount").textContent = (me.open_positions || []).length;
  }

  async function loadMe() {
    if (!localStorage.getItem(TOKEN_KEY)) {
      $("#nickname").textContent = "게스트";
      return;
    }
    try { renderMe(await api("/api/me")); }
    catch (e) {
      if (/token/i.test(e.message)) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(PLAYER_KEY);
      }
    }
  }

  function openTrade(symbol) {
    const a = state.assets.get(symbol);
    if (!a) return;
    state.selected = a; state.side = null;
    state.leverage = (a.leverage_options || [1])[0];
    $("#tradeSymbol").textContent = a.symbol;
    $("#tradeMeta").textContent = a.name + " · " + a.category + " · " + a.quote_currency;
    $("#tradePrice").textContent = a.last_price == null ? "가격 대기 중" : fmt(a.last_price, a.last_price < 1000 ? 2 : 0) + " " + a.quote_currency;
    $("#tradeMessage").textContent = "";
    $$(".side-btn").forEach(b => b.classList.remove("active"));
    $("#leverageGroup").innerHTML = (a.leverage_options || [1]).map(v => '<button type="button" class="lev-btn' + (v === state.leverage ? ' active' : '') + '" data-lev="' + v + '">' + v + '×</button>').join("");
    $$(".lev-btn").forEach(b => b.onclick = () => {
      state.leverage = Number(b.dataset.lev);
      $$(".lev-btn").forEach(x => x.classList.toggle("active", x === b));
    });
    $("#tradeDialog").showModal();
  }

  async function join() {
    const nickname = $("#nicknameInput").value.trim();
    if (nickname.length < 2) { $("#joinMessage").textContent = "닉네임은 2자 이상."; return; }
    $("#joinMessage").textContent = "등록 중...";
    try {
      const data = await api("/api/players/join", { method:"POST", body:JSON.stringify({ nickname }) });
      localStorage.setItem(TOKEN_KEY, data.player_token);
      localStorage.setItem(PLAYER_KEY, data.nickname);
      $("#joinDialog").close();
      await loadMe();
    } catch(e) { $("#joinMessage").textContent = e.message; }
  }

  async function plant() {
    if (!localStorage.getItem(TOKEN_KEY)) {
      $("#tradeMessage").textContent = "먼저 참가자 등록이 필요합니다.";
      setTimeout(() => $("#joinDialog").showModal(), 300);
      return;
    }
    if (!state.selected || !state.side) { $("#tradeMessage").textContent = "LONG 또는 SHORT를 선택하세요."; return; }
    $("#tradeMessage").textContent = "세계선을 심는 중...";
    try {
      const me = await api("/api/positions/open", {
        method:"POST",
        body:JSON.stringify({
          symbol: state.selected.symbol,
          side: state.side,
          leverage: state.leverage,
          allocation_pct: Number($("#allocation").value)
        })
      });
      renderMe(me);
      $("#tradeMessage").textContent = state.selected.symbol + " " + state.side + " 진입 완료";
      setNoise();
      setTimeout(() => $("#tradeDialog").close(), 650);
    } catch(e) { $("#tradeMessage").textContent = e.message; }
  }

  function renderPositions() {
    const box = $("#positions");
    const ps = state.me?.open_positions || [];
    if (!ps.length) {
      box.innerHTML = '<div class="muted">열려 있는 세계선이 없습니다.</div>';
      return;
    }
    box.innerHTML = ps.map(p => {
      const pnl = Number(p.unrealized_pnl || 0);
      return '<div class="position-row"><div><b>' + p.symbol + '</b><br><span class="muted">진입 ' + fmt(p.entry_price,2) + '</span></div><strong class="' + p.side.toLowerCase() + '">' + p.side + ' ' + p.leverage + '×</strong><div style="color:' + (pnl >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (pnl >= 0 ? '+' : '') + money(pnl) + '</div><button class="close-position" data-id="' + p.id + '">종료</button></div>';
    }).join("");
    $$(".close-position").forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { renderMe(await api("/api/positions/" + encodeURIComponent(b.dataset.id) + "/close", { method:"POST", body:"{}" })); renderPositions(); }
      catch(e) { alert(e.message); b.disabled = false; }
    });
  }

  $$(".asset-object").forEach(b => b.addEventListener("click", () => openTrade(b.dataset.symbol)));
  $$(".side-btn").forEach(b => b.addEventListener("click", () => {
    state.side = b.dataset.side;
    $$(".side-btn").forEach(x => x.classList.toggle("active", x === b));
  }));
  $("#allocation").addEventListener("input", e => $("#allocationValue").textContent = e.target.value + "%");
  $("#plantBtn").onclick = plant;
  $("#joinBtn").onclick = () => $("#joinDialog").showModal();
  $("#joinSubmit").onclick = join;
  $("#nicknameInput").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); join(); }});
  $("#tvStatic").onclick = setNoise;
  $("#openPortfolio").onclick = async () => { await loadMe(); renderPositions(); $("#portfolioDialog").showModal(); };
  $("#portfolioClose").onclick = () => $("#portfolioDialog").close();

  function clock() {
    $("#serverTime").textContent = new Date().toLocaleTimeString("ko-KR", { hour12:false });
  }

  clock(); setInterval(clock,1000);
  loadState(); loadMe();
  setInterval(loadState,5000);
  setInterval(loadMe,5000);
})();