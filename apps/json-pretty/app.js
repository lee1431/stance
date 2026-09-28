(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const storageKey="json-pretty-draft-v1";
  let lastOutput="";

  function setEmpty(message){
    lastOutput="";
    $("output").value="";
    $("empty").hidden=false;
    $("summary").hidden=true;
    $("copy").disabled=true;
    $("empty-message").textContent=message;
  }

  function persist(){
    if(!$("remember").checked){localStorage.removeItem(storageKey);return;}
    localStorage.setItem(storageKey,JSON.stringify({text:$("input").value,indent:$("indent").value,remember:true}));
    $("save-status").textContent="입력 내용과 들여쓰기 설정을 이 기기에 저장했습니다.";
  }

  function run(mode){
    const result=JsonPretty.transform($("input").value,mode,$("indent").value);
    if(!result.ok){
      $("error").textContent=result.message;
      setEmpty(result.code==="EMPTY"?"왼쪽에 JSON을 붙여 넣어 주세요.":"문법 오류를 고치면 결과가 여기에 표시됩니다.");
      persist();
      return;
    }
    $("error").textContent="";
    lastOutput=result.output;
    $("output").value=result.output;
    $("empty").hidden=true;
    $("summary").hidden=false;
    $("copy").disabled=false;
    $("root-type").textContent=result.stats.rootType;
    $("key-count").textContent=result.stats.keys.toLocaleString("ko-KR");
    $("item-count").textContent=result.stats.items.toLocaleString("ko-KR");
    $("depth").textContent=result.stats.depth.toLocaleString("ko-KR");
    $("byte-count").textContent=result.bytes.toLocaleString("ko-KR")+" byte";
    $("result-label").textContent=mode==="minify"?"한 줄 압축 결과":"보기 좋게 정렬한 결과";
    persist();
  }

  $("format").addEventListener("click",()=>run("format"));
  $("minify").addEventListener("click",()=>run("minify"));
  $("sample").addEventListener("click",()=>{$("input").value='{"project":"YAME","active":true,"tags":["PWA","offline"],"stats":{"apps":16,"owner":"lee1431"}}';run("format");});
  $("clear").addEventListener("click",()=>{$("input").value="";$("error").textContent="";setEmpty("왼쪽에 JSON을 붙여 넣어 주세요.");persist();$("input").focus();});
  $("input").addEventListener("input",()=>{$("error").textContent="";setEmpty($("input").value.trim()?"정렬 또는 압축 버튼을 눌러 주세요.":"왼쪽에 JSON을 붙여 넣어 주세요.");persist();});
  $("indent").addEventListener("change",persist);
  $("remember").addEventListener("change",()=>{$("save-status").textContent=$("remember").checked?"앞으로 입력 내용을 이 기기에 저장합니다.":"저장된 입력 내용을 삭제했습니다.";persist();});
  $("copy").addEventListener("click",async()=>{if(!lastOutput)return;try{await navigator.clipboard.writeText(lastOutput);$("copy").textContent="복사했어요";setTimeout(()=>$("copy").textContent="결과 복사",1300);}catch(_){$("error").textContent="복사하지 못했습니다. 결과를 직접 선택해 주세요.";}});

  try{
    const saved=JSON.parse(localStorage.getItem(storageKey)||"null");
    if(saved&&saved.remember){$("input").value=typeof saved.text==="string"?saved.text:"";$("indent").value=saved.indent||"2";$("remember").checked=true;$("save-status").textContent="저장된 입력을 불러왔습니다.";if($("input").value.trim())run("format");else setEmpty("왼쪽에 JSON을 붙여 넣어 주세요.");}
    else setEmpty("왼쪽에 JSON을 붙여 넣어 주세요.");
  }catch(_){localStorage.removeItem(storageKey);setEmpty("왼쪽에 JSON을 붙여 넣어 주세요.");}

  if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js",{scope:"./"}).catch(()=>{}));
})();
