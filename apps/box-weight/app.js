(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const ids=["length","width","height","actual-weight","quantity","divisor","rounding"];
  const storageKey="box-weight-settings-v1";
  let lastResult=null;

  function values(){
    return {
      length:$("length").value,
      width:$("width").value,
      height:$("height").value,
      actualWeight:$("actual-weight").value,
      quantity:$("quantity").value,
      divisor:$("divisor").value,
      rounding:$("rounding").value
    };
  }

  function format(value,digits=2){
    return new Intl.NumberFormat("ko-KR",{maximumFractionDigits:digits}).format(value);
  }

  function persist(){
    if(!$("remember").checked){localStorage.removeItem(storageKey);return;}
    localStorage.setItem(storageKey,JSON.stringify({...values(),remember:true}));
    $("storage-status").textContent="입력값을 이 기기에 저장했습니다.";
  }

  function showEmpty(message="가로·세로·높이와 실제 무게를 입력하면 바로 계산합니다."){
    lastResult=null;
    $("empty").hidden=false;
    $("result").hidden=true;
    $("copy").disabled=true;
    $("empty-message").textContent=message;
  }

  function render(){
    const input=values();
    const required=[input.length,input.width,input.height,input.actualWeight];
    if(required.every(value=>value==="")){
      $("error").textContent="";
      showEmpty();
      persist();
      return;
    }

    const result=BoxWeight.calculate(input);
    if(!result.ok){
      $("error").textContent=result.message;
      showEmpty("입력값을 확인하면 계산 결과가 여기에 표시됩니다.");
      return;
    }

    lastResult=result;
    $("error").textContent="";
    $("empty").hidden=true;
    $("result").hidden=false;
    $("copy").disabled=false;
    $("billable").textContent=format(result.billableWeight);
    $("total-billable").textContent=format(result.totalBillableWeight);
    $("volume-weight").textContent=format(result.volumeWeight);
    $("actual-result").textContent=format(result.actualWeight);
    $("volume-liters").textContent=format(result.totalVolumeLiters,1);
    $("quantity-result").textContent=format(result.quantity,0);
    $("actual-bar").style.width=Math.max(4,result.actualRatio)+"%";
    $("volume-bar").style.width=Math.max(4,result.volumeRatio)+"%";
    $("actual-bar-value").textContent=format(result.actualWeight)+"kg";
    $("volume-bar-value").textContent=format(result.volumeWeight)+"kg";

    if(result.dominant==="volume"){
      $("dominant").textContent="부피무게가 더 큽니다";
      $("explanation").textContent=`실제 무게보다 ${format(result.difference)}kg 커서 부피무게가 비교 기준이 됩니다.`;
    }else if(result.dominant==="actual"){
      $("dominant").textContent="실제 무게가 더 큽니다";
      $("explanation").textContent=`부피무게보다 ${format(result.difference)}kg 커서 실제 무게가 비교 기준이 됩니다.`;
    }else{
      $("dominant").textContent="두 무게가 같습니다";
      $("explanation").textContent="실제 무게와 부피무게가 같아 어느 쪽을 적용해도 동일합니다.";
    }
    persist();
  }

  let timer;
  function schedule(){clearTimeout(timer);timer=setTimeout(render,70);}
  ids.forEach(id=>{$(id).addEventListener("input",schedule);$(id).addEventListener("change",render);});

  $("sample").addEventListener("click",()=>{
    $("length").value="40";$("width").value="30";$("height").value="20";
    $("actual-weight").value="3";$("quantity").value="2";$("divisor").value="5000";$("rounding").value="0.1";
    render();$("length").focus();
  });

  $("clear").addEventListener("click",()=>{
    ["length","width","height","actual-weight"].forEach(id=>$(id).value="");
    $("quantity").value="1";$("divisor").value="5000";$("rounding").value="0.1";
    $("remember").checked=false;localStorage.removeItem(storageKey);render();
    $("storage-status").textContent="입력과 저장된 내용을 지웠습니다.";$("length").focus();
  });

  $("remember").addEventListener("change",()=>{
    if($("remember").checked)persist();
    else{localStorage.removeItem(storageKey);$("storage-status").textContent="저장을 해제했습니다.";}
  });

  $("copy").addEventListener("click",async()=>{
    if(!lastResult)return;
    const r=lastResult;
    const summary=`박스 부피무게 계산\n${format(r.length)}×${format(r.width)}×${format(r.height)}cm · 실제 ${format(r.actualWeight)}kg · 제수 ${format(r.divisor,0)}\n부피무게 ${format(r.volumeWeight)}kg · 적용 무게 ${format(r.billableWeight)}kg/개 · ${r.quantity}개 합계 ${format(r.totalBillableWeight)}kg`;
    try{await navigator.clipboard.writeText(summary);}catch(error){
      const area=document.createElement("textarea");area.value=summary;area.style.position="fixed";area.style.opacity="0";document.body.append(area);area.select();document.execCommand("copy");area.remove();
    }
    $("copy").textContent="복사했어요";setTimeout(()=>{$("copy").textContent="결과 복사";},1400);
  });

  try{
    const saved=JSON.parse(localStorage.getItem(storageKey)||"null");
    if(saved&&saved.remember){
      $("length").value=saved.length||"";$("width").value=saved.width||"";$("height").value=saved.height||"";
      $("actual-weight").value=saved.actualWeight||"";$("quantity").value=saved.quantity||"1";
      $("divisor").value=saved.divisor||"5000";$("rounding").value=saved.rounding??"0.1";
      $("remember").checked=true;render();$("storage-status").textContent="저장된 입력을 불러왔습니다.";
    }else render();
  }catch(error){localStorage.removeItem(storageKey);render();$("storage-status").textContent="저장된 내용을 읽지 못해 초기화했습니다.";}

  if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
})();
