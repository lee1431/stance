(function(root){
  "use strict";
  function count(text,target){
    if(typeof text!=="string")return {ok:false,message:"텍스트를 확인해 주세요."};
    const characters=Array.from(text).length;
    if(characters>500000)return {ok:false,message:"텍스트는 500,000자 이하로 입력해 주세요."};
    let targetValue=null;
    if(target!==""&&target!==null&&target!==undefined){targetValue=Number(target);if(!Number.isInteger(targetValue)||targetValue<=0)return {ok:false,message:"목표 글자 수는 1 이상의 정수로 입력해 주세요."};if(targetValue>1000000)return {ok:false,message:"목표 글자 수는 1,000,000자 이하로 입력해 주세요."};}
    const noWhitespace=Array.from(text.replace(/\s/gu,"")).length;
    const trimmed=text.trim();
    const words=trimmed?trimmed.split(/\s+/u).length:0;
    const lines=text?text.split(/\r\n?|\n/u).length:0;
    const paragraphs=trimmed?trimmed.split(/(?:\r\n?|\n)\s*(?:\r\n?|\n)/u).filter(value=>value.trim()).length:0;
    const bytes=new TextEncoder().encode(text).length;
    const readingSeconds=noWhitespace?Math.max(1,Math.ceil(noWhitespace/300*60)):0;
    const goal=targetValue?{target:targetValue,percent:characters/targetValue*100,difference:targetValue-characters}:null;
    return {ok:true,characters,noWhitespace,words,lines,paragraphs,bytes,readingSeconds,goal};
  }
  root.TextStats={count};
})(typeof window!=="undefined"?window:globalThis);
