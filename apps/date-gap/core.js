(function(root){
  'use strict';
  const DAY=86400000;
  function parseDate(value,label){
    if(typeof value!=='string'||!value.trim()) throw new Error(label+'을 선택해 주세요.');
    const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if(!m) throw new Error(label+' 형식을 확인해 주세요.');
    const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
    if(y<1900||y>2100) throw new Error('연도는 1900년부터 2100년까지 계산할 수 있어요.');
    const ms=Date.UTC(y,mo-1,d),check=new Date(ms);
    if(check.getUTCFullYear()!==y||check.getUTCMonth()!==mo-1||check.getUTCDate()!==d) throw new Error(label+'이 올바른 날짜가 아닙니다.');
    return ms;
  }
  function dateGap(start,end){
    const startMs=parseDate(start,'시작일'),endMs=parseDate(end,'마지막 날');
    if(endMs<startMs) throw new Error('마지막 날은 시작일과 같거나 뒤여야 합니다.');
    const nights=(endMs-startMs)/DAY,calendarDays=nights+1;
    return {start,end,nights,calendarDays,weeks:Math.floor(nights/7),extraDays:nights%7,sameDay:nights===0};
  }
  if(typeof module!=='undefined'&&module.exports) module.exports=dateGap;
  else root.calculateDateGap=dateGap;
})(typeof window==='undefined'?globalThis:window);
