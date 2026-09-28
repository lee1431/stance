(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const form=$("workday-form"),start=$("start"),days=$("days"),holiday=$("holiday"),includeStart=$("include-start"),remember=$("remember");
  const storageKey="workday-date-settings-v1";
  let holidayDates=[],lastResult=null;
  const dateFormatter=new Intl.DateTimeFormat("ko-KR",{year:"numeric",month:"long",day:"numeric",timeZone:"UTC"});
  const weekdayFormatter=new Intl.DateTimeFormat("ko-KR",{weekday:"long",timeZone:"UTC"});
  const toDate=value=>new Date(value+"T00:00:00Z");
  function direction(){return form.elements.direction.value;}
  function values(){return {start:start.value,days:days.value,direction:direction(),includeStart:includeStart.checked,holidays:[...holidayDates]};}
  function renderHolidays(){
    const list=$("holiday-list");list.replaceChildren();
    if(!holidayDates.length){const p=document.createElement("p");p.textContent="지정한 휴일이 없습니다.";list.append(p);return;}
    holidayDates.forEach(value=>{const button=document.createElement("button");button.type="button";button.className="holiday-chip";button.textContent=value;button.setAttribute("aria-label",value+" 휴일 삭제");button.addEventListener("click",()=>{holidayDates=holidayDates.filter(date=>date!==value);renderHolidays();if(lastResult)render();persist();});list.append(button);});
  }
  function persist(){
    if(!remember.checked){localStorage.removeItem(storageKey);return;}
    localStorage.setItem(storageKey,JSON.stringify({...values(),remember:true}));
    $("storage-status").textContent="조건을 이 기기에 저장했습니다.";
  }
  function render(){
    const result=WorkdayDate.calculate(values());
    if(!result.ok){lastResult=null;$("error").textContent=result.message;$("empty").hidden=false;$("result").hidden=true;return false;}
    lastResult=result;$("error").textContent="";$("empty").hidden=true;$("result").hidden=false;
    const target=toDate(result.target),startDate=toDate(result.start),way=result.direction==="after"?"이후":"이전";
    $("direction-label").textContent=`${dateFormatter.format(startDate)}에서 ${result.days}영업일 ${way}`;
    $("target-date").textContent=dateFormatter.format(target);
    $("target-weekday").textContent=weekdayFormatter.format(target);
    $("counted-days").textContent=result.days+"일";$("weekends").textContent=result.weekendsSkipped+"일";$("holidays").textContent=result.holidaysSkipped+"일";$("calendar-days").textContent=result.calendarDays+"일";
    $("range-note").textContent=result.days===0?"0영업일은 기준일을 그대로 표시합니다.":`${result.includeStart?"기준일을 포함해":"기준일 다음 날부터"} 세었고, 주말 ${result.weekendsSkipped}일${result.holidaysSkipped?`과 지정 휴일 ${result.holidaysSkipped}일`:""}을 건너뛰었습니다.`;
    persist();return true;
  }
  function addHoliday(){
    if(!holiday.value){$("error").textContent="추가할 휴일을 선택해 주세요.";holiday.focus();return;}
    if(holidayDates.includes(holiday.value)){$("error").textContent="이미 추가한 휴일입니다.";return;}
    holidayDates.push(holiday.value);holidayDates.sort();holiday.value="";$("error").textContent="";renderHolidays();if(lastResult)render();persist();
  }
  function clearAll(){
    form.reset();holidayDates=[];lastResult=null;remember.checked=false;localStorage.removeItem(storageKey);renderHolidays();$("error").textContent="";$("empty").hidden=false;$("result").hidden=true;$("storage-status").textContent="입력값과 저장된 조건을 지웠습니다.";start.focus();
  }
  form.addEventListener("submit",event=>{event.preventDefault();if(render())$("result-panel").scrollIntoView({behavior:"smooth",block:"start"});});
  $("add-holiday").addEventListener("click",addHoliday);$("clear").addEventListener("click",clearAll);
  $("sample").addEventListener("click",()=>{start.value="2026-09-28";days.value="5";form.elements.direction.value="after";includeStart.checked=false;holidayDates=["2026-10-01"];renderHolidays();render();});
  remember.addEventListener("change",()=>{if(remember.checked)persist();else{localStorage.removeItem(storageKey);$("storage-status").textContent="저장을 해제했습니다.";}});
  $("copy").addEventListener("click",async()=>{
    if(!lastResult)return;const way=lastResult.direction==="after"?"이후":"이전";const target=toDate(lastResult.target);const text=`영업일 계산\n${lastResult.start}에서 ${lastResult.days}영업일 ${way}: ${dateFormatter.format(target)} (${weekdayFormatter.format(target)})\n주말 ${lastResult.weekendsSkipped}일 · 지정 휴일 ${lastResult.holidaysSkipped}일 제외`;
    try{await navigator.clipboard.writeText(text);}catch(error){const area=document.createElement("textarea");area.value=text;area.style.position="fixed";area.style.opacity="0";document.body.append(area);area.select();document.execCommand("copy");area.remove();}
    $("copy").textContent="복사했어요";setTimeout(()=>{$("copy").textContent="결과 복사";},1400);
  });
  try{const saved=JSON.parse(localStorage.getItem(storageKey)||"null");if(saved&&saved.remember){start.value=saved.start||"";days.value=saved.days??"";form.elements.direction.value=saved.direction||"after";includeStart.checked=Boolean(saved.includeStart);holidayDates=Array.isArray(saved.holidays)?saved.holidays:[];remember.checked=true;renderHolidays();render();$("storage-status").textContent="저장된 계산 조건을 불러왔습니다.";}else renderHolidays();}catch(error){localStorage.removeItem(storageKey);renderHolidays();$("storage-status").textContent="저장된 조건을 읽지 못해 초기화했습니다.";}
  if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
})();
