(function(){
  "use strict";
  const $=id=>document.getElementById(id),text=$("text"),target=$("target"),remember=$("remember"),storageKey="text-stats-settings-v1";
  let last=null;
  const number=value=>new Intl.NumberFormat("ko-KR",{maximumFractionDigits:1}).format(value);
  function reading(seconds){if(seconds<60)return seconds+"초";const min=Math.floor(seconds/60),sec=seconds%60;return sec?`${min}분 ${sec}초`:`${min}분`;}
  function persist(){if(!remember.checked){localStorage.removeItem(storageKey);return;}localStorage.setItem(storageKey,JSON.stringify({text:text.value,target:target.value,remember:true}));$("storage-status").textContent="입력과 목표를 이 기기에 저장했습니다.";}
  function render(){
    const result=TextStats.count(text.value,target.value);$("live-count").textContent=number(Array.from(text.value).length)+"자";
    if(!result.ok){last=null;$("error").textContent=result.message;$("empty").hidden=false;$("results").hidden=true;$("copy").disabled=true;return;}
    $("error").textContent="";last=result;
    if(!result.characters){$("empty").hidden=false;$("results").hidden=true;$("copy").disabled=true;persist();return;}
    $("empty").hidden=true;$("results").hidden=false;$("copy").disabled=false;
    $("characters").textContent=number(result.characters);$("no-space").textContent=number(result.noWhitespace);$("words").textContent=number(result.words);$("lines").textContent=number(result.lines);$("paragraphs").textContent=number(result.paragraphs);$("bytes").textContent=number(result.bytes);$("reading").textContent=reading(result.readingSeconds);
    if(result.goal){$("goal").hidden=false;$("goal-percent").textContent=number(result.goal.percent)+"%";$("goal-bar").style.width=Math.min(100,result.goal.percent)+"%";$("goal-message").textContent=result.goal.difference>0?`목표까지 ${number(result.goal.difference)}자 남았습니다.`:result.goal.difference===0?"목표 글자 수에 정확히 도달했습니다.":`목표를 ${number(Math.abs(result.goal.difference))}자 넘었습니다.`;}else $("goal").hidden=true;
    persist();
  }
  let timer;function schedule(){clearTimeout(timer);timer=setTimeout(render,80);}
  text.addEventListener("input",schedule);target.addEventListener("input",schedule);
  $("sample").addEventListener("click",()=>{text.value="안녕하세요.\n\n오늘도 좋은 하루!";target.value="20";render();text.focus();});
  $("clear").addEventListener("click",()=>{text.value="";target.value="";remember.checked=false;localStorage.removeItem(storageKey);render();$("storage-status").textContent="입력과 저장된 내용을 지웠습니다.";text.focus();});
  remember.addEventListener("change",()=>{if(remember.checked)persist();else{localStorage.removeItem(storageKey);$("storage-status").textContent="저장을 해제했습니다.";}});
  $("copy").addEventListener("click",async()=>{if(!last||!last.characters)return;const summary=`글 통계\n전체 ${last.characters}자 · 공백 제외 ${last.noWhitespace}자 · 단어 ${last.words}개 · ${last.lines}줄 · ${last.paragraphs}문단 · UTF-8 ${last.bytes}byte · 예상 읽기 ${reading(last.readingSeconds)}`;try{await navigator.clipboard.writeText(summary);}catch(error){const area=document.createElement("textarea");area.value=summary;area.style.position="fixed";area.style.opacity="0";document.body.append(area);area.select();document.execCommand("copy");area.remove();}$("copy").textContent="복사했어요";setTimeout(()=>{$("copy").textContent="통계 복사";},1400);});
  try{const saved=JSON.parse(localStorage.getItem(storageKey)||"null");if(saved&&saved.remember){text.value=saved.text||"";target.value=saved.target||"";remember.checked=true;render();$("storage-status").textContent="저장된 입력을 불러왔습니다.";}else render();}catch(error){localStorage.removeItem(storageKey);render();$("storage-status").textContent="저장된 내용을 읽지 못해 초기화했습니다.";}
  if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
})();
