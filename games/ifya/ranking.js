(() => {
  const API = "https://localflow.ddns.net/ifya";
  const list = document.getElementById("rankingList");
  const status = document.getElementById("rankingStatus");
  const money = n => "₩" + Number(n || 0).toLocaleString("ko-KR", {maximumFractionDigits:0});
  async function load(){
    try{
      const r = await fetch(API + "/api/ranking?limit=100", {cache:"no-store"});
      const d = await r.json();
      if(!r.ok) throw new Error(d.error || "랭킹 조회 실패");
      const rows = d.ranking || [];
      status.textContent = rows.length ? "현재 참가자 " + rows.length + "명" : "아직 참가자가 없습니다.";
      list.innerHTML = rows.map(x => {
        const ret = Number(x.return_pct || 0);
        return '<article class="rank-row">' +
          '<div class="rank-no">#' + x.rank + '</div>' +
          '<div><div class="rank-name">' + escapeHtml(x.nickname) + '</div><div class="rank-sub">활성 포지션 ' + x.open_positions + ' · 종료 ' + x.closed_count + '</div></div>' +
          '<div class="rank-return ' + (ret >= 0 ? 'up' : 'down') + '">' + (ret >= 0 ? '+' : '') + ret.toFixed(2) + '%</div>' +
          '<div class="hide-mobile"><div>' + money(x.equity) + '</div><div class="rank-sub">총 자산</div></div>' +
          '<div class="hide-mobile"><div>' + x.liquidation_count + '회</div><div class="rank-sub">청산</div></div>' +
          '</article>';
      }).join("");
    }catch(e){ status.textContent = e.message; }
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }
  load(); setInterval(load,5000);
})();