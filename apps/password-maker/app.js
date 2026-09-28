(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const storageKey="password-maker-settings-v1";
  const optionIds=["lower","upper","numbers","symbols","exclude-ambiguous"];
  let current="";

  function settings(){return {length:Number($("length").value),lower:$("lower").checked,upper:$("upper").checked,numbers:$("numbers").checked,symbols:$("symbols").checked,excludeAmbiguous:$("exclude-ambiguous").checked};}
  function format(value){return new Intl.NumberFormat("ko-KR",{maximumFractionDigits:0}).format(value);}

  function persist(){
    if(!$("remember").checked){localStorage.removeItem(storageKey);return;}
    localStorage.setItem(storageKey,JSON.stringify({...settings(),remember:true}));
    $("storage-status").textContent="설정만 이 기기에 저장했습니다. 생성된 암호는 저장하지 않습니다.";
  }

  function clearResult(message){
    current="";$("empty").hidden=false;$("result").hidden=true;$("copy").disabled=true;$("empty-message").textContent=message;
  }

  function generate(){
    const result=PasswordMaker.generate(settings());
    if(!result.ok){$("error").textContent=result.message;clearResult("문자 종류를 선택하면 새 암호를 만들 수 있습니다.");persist();return;}
    current=result.password;$("error").textContent="";$("empty").hidden=true;$("result").hidden=false;$("copy").disabled=false;
    $("password").textContent=result.password;$("strength").textContent=result.label;$("entropy").textContent=format(result.entropyBits)+" bit";$("pool-size").textContent=format(result.poolSize)+"자";$("result-length").textContent=result.length+"자";
    const percent=Math.min(100,result.entropyBits);$("meter-bar").style.width=percent+"%";$("meter-bar").dataset.level=result.label;
    persist();
  }

  $("length").addEventListener("input",()=>{$("length-value").textContent=$("length").value+"자";persist();});
  optionIds.forEach(id=>$(id).addEventListener("change",()=>{persist();if(!["lower","upper","numbers","symbols"].some(key=>$(key).checked)){clearResult("문자 종류를 하나 이상 선택해 주세요.");$("error").textContent="문자 종류를 하나 이상 선택해 주세요.";}else $("error").textContent="";}));

  $("generate").addEventListener("click",generate);
  $("recommended").addEventListener("click",()=>{$("length").value="20";$("length-value").textContent="20자";$("lower").checked=true;$("upper").checked=true;$("numbers").checked=true;$("symbols").checked=true;$("exclude-ambiguous").checked=true;generate();});
  $("clear-types").addEventListener("click",()=>{$("lower").checked=false;$("upper").checked=false;$("numbers").checked=false;$("symbols").checked=false;$("error").textContent="문자 종류를 하나 이상 선택해 주세요.";clearResult("아래 문자 종류를 하나 이상 선택해 주세요.");persist();});
  $("remember").addEventListener("change",()=>{if($("remember").checked)persist();else{localStorage.removeItem(storageKey);$("storage-status").textContent="설정 저장을 해제했습니다.";}});

  $("copy").addEventListener("click",async()=>{
    if(!current)return;
    try{await navigator.clipboard.writeText(current);}catch(error){const area=document.createElement("textarea");area.value=current;area.style.position="fixed";area.style.opacity="0";document.body.append(area);area.select();document.execCommand("copy");area.remove();}
    $("copy").textContent="복사했어요";setTimeout(()=>{$("copy").textContent="암호 복사";},1400);
  });

  try{
    const saved=JSON.parse(localStorage.getItem(storageKey)||"null");
    if(saved&&saved.remember){
      $("length").value=String(saved.length||20);$("lower").checked=saved.lower!==false;$("upper").checked=saved.upper!==false;$("numbers").checked=saved.numbers!==false;$("symbols").checked=!!saved.symbols;$("exclude-ambiguous").checked=saved.excludeAmbiguous!==false;$("remember").checked=true;$("length-value").textContent=$("length").value+"자";generate();$("storage-status").textContent="저장된 설정을 불러왔습니다. 새 암호를 다시 만들었습니다.";
    }else generate();
  }catch(error){localStorage.removeItem(storageKey);generate();$("storage-status").textContent="저장된 설정을 읽지 못해 기본값으로 초기화했습니다.";}

  if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
})();
