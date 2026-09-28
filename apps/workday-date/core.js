(function(root){
  "use strict";
  const DAY=86400000;
  function parseDate(value){
    if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    const [y,m,d]=value.split("-").map(Number);
    const date=new Date(Date.UTC(y,m-1,d));
    if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)return null;
    return date;
  }
  function key(date){return date.toISOString().slice(0,10);}
  function isWeekend(date){const day=date.getUTCDay();return day===0||day===6;}
  function normalizeHolidays(values){
    if(!Array.isArray(values))return {ok:false,message:"휴일 목록을 확인해 주세요."};
    const set=new Set();
    for(const value of values){const date=parseDate(value);if(!date)return {ok:false,message:`올바르지 않은 휴일이 있습니다: ${value}`};set.add(key(date));}
    return {ok:true,set};
  }
  function calculate(input){
    const start=parseDate(input.start);
    if(!start)return {ok:false,message:"올바른 기준일을 선택해 주세요."};
    const days=Number(input.days);
    if(input.days===""||!Number.isInteger(days))return {ok:false,message:"영업일 수를 정수로 입력해 주세요."};
    if(days<0)return {ok:false,message:"영업일 수는 0 이상으로 입력해 주세요."};
    if(days>5000)return {ok:false,message:"영업일 수는 5,000일 이하로 입력해 주세요."};
    if(input.direction!=="after"&&input.direction!=="before")return {ok:false,message:"계산 방향을 선택해 주세요."};
    const holidays=normalizeHolidays(input.holidays||[]);if(!holidays.ok)return holidays;
    if(days===0)return {ok:true,start:key(start),target:key(start),days:0,direction:input.direction,includeStart:Boolean(input.includeStart),weekendsSkipped:0,holidaysSkipped:0,calendarDays:0};
    const step=input.direction==="after"?1:-1;
    let current=new Date(start),counted=0,weekendsSkipped=0,holidaysSkipped=0,calendarDays=0;
    const canCount=date=>!isWeekend(date)&&!holidays.set.has(key(date));
    if(input.includeStart&&canCount(current))counted=1;
    while(counted<days){
      current=new Date(current.getTime()+step*DAY);calendarDays++;
      if(isWeekend(current)){weekendsSkipped++;continue;}
      if(holidays.set.has(key(current))){holidaysSkipped++;continue;}
      counted++;
    }
    return {ok:true,start:key(start),target:key(current),days,direction:input.direction,includeStart:Boolean(input.includeStart),weekendsSkipped,holidaysSkipped,calendarDays};
  }
  root.WorkdayDate={parseDate,isWeekend,calculate};
})(typeof window!=="undefined"?window:globalThis);
