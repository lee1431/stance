'use strict';
(function(root){
  function sumDurations(text){
    const lines=text.split(/\r?\n/),entries=[],errors=[];let total=0;
    lines.forEach((raw,i)=>{
      const s=raw.trim();if(!s)return;
      let minutes;
      if(/^\d+$/.test(s))minutes=Number(s);
      else if(/^\d+:\d{2}$/.test(s)){
        const [h,m]=s.split(':').map(Number);
        if(m>59){errors.push({line:i+1,message:'콜론 뒤 분은 00~59로 입력하세요.'});return;}
        minutes=h*60+m;
      }else{errors.push({line:i+1,message:'시:분(1:30) 또는 정수 분(90)으로 입력하세요.'});return;}
      if(!Number.isSafeInteger(minutes)||minutes>99999999||!Number.isSafeInteger(total+minutes)||total+minutes>99999999){errors.push({line:i+1,message:'총합은 99,999,999분 이하로 입력하세요.'});return;}
      entries.push({line:i+1,minutes});total+=minutes;
    });
    return {entries,errors,total:errors.length?null:total};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={sumDurations};else root.sumDurations=sumDurations;
})(globalThis);
