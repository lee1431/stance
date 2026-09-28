(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const form=$("fuel-form"), distance=$("distance"), efficiency=$("efficiency"), price=$("price"), roundTrip=$("round-trip"), remember=$("remember");
  const storageKey="fuel-cost-settings-v1";
  let lastResult=null;
  const number=(value,digits=0)=>new Intl.NumberFormat("ko-KR",{maximumFractionDigits:digits}).format(value);

  function values(){return {distance:distance.value,efficiency:efficiency.value,price:price.value,roundTrip:roundTrip.checked};}
  function persist(){
    if(!remember.checked){localStorage.removeItem(storageKey);return;}
    localStorage.setItem(storageKey,JSON.stringify({...values(),remember:true}));
    $("storage-status").textContent="입력값을 이 기기에 저장했습니다.";
  }
  function render(){
    const result=FuelCost.calculate(values());
    if(!result.ok){
      lastResult=null; $("error").textContent=result.message; $("empty").hidden=false; $("result-content").hidden=true; $("trip-badge").textContent=roundTrip.checked?"왕복":"편도"; return false;
    }
    $("error").textContent=""; lastResult=result; $("empty").hidden=true; $("result-content").hidden=false;
    $("trip-badge").textContent=result.roundTrip?"왕복":"편도";
    $("total-cost").textContent=number(Math.round(result.totalCost))+"원";
    $("total-distance").textContent=number(result.totalDistance,1)+" km";
    $("liters").textContent=number(result.liters,2)+" L";
    $("cost-km").textContent=number(Math.round(result.costPerKm))+"원";
    persist(); return true;
  }
  function clearAll(){
    form.reset(); remember.checked=false; localStorage.removeItem(storageKey); lastResult=null; $("error").textContent=""; $("empty").hidden=false; $("result-content").hidden=true; $("trip-badge").textContent="편도"; $("storage-status").textContent="입력값과 저장된 설정을 지웠습니다."; distance.focus();
  }
  form.addEventListener("submit",event=>{event.preventDefault();if(render()) $("result").scrollIntoView({behavior:"smooth",block:"start"});});
  $("example").addEventListener("click",()=>{distance.value="250";efficiency.value="12.5";price.value="1700";roundTrip.checked=false;render();});
  $("clear").addEventListener("click",clearAll);
  roundTrip.addEventListener("change",()=>{if(lastResult)render();else $("trip-badge").textContent=roundTrip.checked?"왕복":"편도";});
  document.querySelectorAll("[data-distance]").forEach(button=>button.addEventListener("click",()=>{distance.value=button.dataset.distance;if(lastResult)render();distance.focus();}));
  remember.addEventListener("change",()=>{if(remember.checked){persist();}else{localStorage.removeItem(storageKey);$("storage-status").textContent="저장을 해제했습니다.";}});
  $("copy").addEventListener("click",async()=>{
    if(!lastResult)return;
    const text=`주유비 예상 (${lastResult.roundTrip?"왕복":"편도"})\n총 거리 ${number(lastResult.totalDistance,1)} km · 필요 연료 ${number(lastResult.liters,2)} L · 예상 비용 ${number(Math.round(lastResult.totalCost))}원`;
    try{await navigator.clipboard.writeText(text);}catch(error){const area=document.createElement("textarea");area.value=text;area.style.position="fixed";area.style.opacity="0";document.body.appendChild(area);area.select();document.execCommand("copy");area.remove();}
    $("copy").textContent="복사했어요";setTimeout(()=>{$("copy").textContent="결과 복사";},1400);
  });
  try{
    const saved=JSON.parse(localStorage.getItem(storageKey)||"null");
    if(saved&&saved.remember){distance.value=saved.distance||"";efficiency.value=saved.efficiency||"";price.value=saved.price||"";roundTrip.checked=Boolean(saved.roundTrip);remember.checked=true;render();$("storage-status").textContent="저장된 운행 조건을 불러왔습니다.";}
  }catch(error){localStorage.removeItem(storageKey);$("storage-status").textContent="저장된 값을 읽지 못해 초기화했습니다.";}
  if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
})();
