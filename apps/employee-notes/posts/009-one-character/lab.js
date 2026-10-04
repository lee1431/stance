(() => {
  'use strict';
  const examples = {ascii:'A',hangul:'\uAC00',decomposed:'\u1100\u1161',face:'\u{1F600}',family:'\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}',accent:'e\u0301'};
  function inspect(text, Segmenter = globalThis.Intl?.Segmenter) {
    if(text.length > 2000) return {error:'분석 한도 2,000 코드 단위를 넘었습니다. 짧은 예문으로 다시 확인하세요.'};
    const points=Array.from(text);
    if(points.some(c=>{const n=c.codePointAt(0);return n>=0xD800&&n<=0xDFFF;}))return {error:'완전하지 않은 UTF-16 문자 조각이 있습니다. 입력을 다시 확인하세요.'};
    const segmenter=typeof Segmenter==='function'?new Segmenter('ko',{granularity:'grapheme'}):null;
    const measure=t=>({units:t.length,points:Array.from(t).length,clusters:segmenter?Array.from(segmenter.segment(t)).length:null,bytes:new TextEncoder().encode(t).length});
    const codes=t=>Array.from(t).slice(0,32).map(c=>'U+'+c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')).join(' · ')+(Array.from(t).length>32?' · … (앞 32개)':'');
    const normalized=text.normalize('NFC');
    return {original:measure(text),nfc:measure(normalized),codes:codes(text),nfcCodes:codes(normalized),normalized,equal:text===normalized};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={inspect,examples};
  if(typeof document==='undefined')return;
  const $=id=>document.getElementById(id),input=$('unicode-input');
  if(!input)return;
  let composing=false;
  function render(){
    let data;try{data=inspect(input.value);}catch{data={error:'이 환경에서 문자 분석을 완료하지 못했습니다. 최신 브라우저에서 다시 확인하세요.'};}
    const keys=['units','points','clusters','bytes'];
    if(data.error){keys.forEach(k=>$('unicode-'+k).textContent='—');for(const k of ['codes','normalized','nfc-codes','nfc-counts','equal'])$('unicode-'+k).textContent='분석하지 않음';$('unicode-status').textContent=data.error;return;}
    keys.forEach(k=>$('unicode-'+k).textContent=data.original[k]===null?'미지원':String(data.original[k]));
    $('unicode-codes').textContent=data.codes||'없음';
    $('unicode-normalized').textContent=data.normalized||'없음';
    $('unicode-nfc-codes').textContent=data.nfcCodes||'없음';
    $('unicode-nfc-counts').textContent=`코드 단위 ${data.nfc.units} · 코드 포인트 ${data.nfc.points} · 문자 덩어리 ${data.nfc.clusters??'미지원'} · UTF-8 ${data.nfc.bytes}바이트`;
    $('unicode-equal').textContent=data.equal?'같음 (true)':'다름 (false)';
    $('unicode-status').textContent=!input.value?'텍스트를 입력하거나 예시를 넣어 보세요.':data.original.clusters===null?'Intl.Segmenter 미지원: 문자 덩어리 수는 계산하지 않았습니다. 다른 세 기준은 표시합니다.':'이 브라우저에서 계산했습니다. 원문을 변경하거나 저장하지 않았습니다.';
  }
  input.addEventListener('compositionstart',()=>{composing=true;$('unicode-status').textContent='글자를 조합 중입니다. 조합이 끝나면 다시 계산합니다.';});
  input.addEventListener('compositionend',()=>{composing=false;render();});
  input.addEventListener('input',e=>{if(!composing&&!e.isComposing)render();});
  $('unicode-load').addEventListener('click',()=>{composing=false;input.value=examples[$('unicode-example').value];render();});
  $('unicode-clear').addEventListener('click',()=>{composing=false;input.value='';render();});
  $('unicode-load').disabled=false;$('unicode-clear').disabled=false;render();
})();
