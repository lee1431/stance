'use strict';
(function(root){
  function parseTime(value){const text=String(value).trim();const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);if(!match)throw new Error('일어날 시각을 선택해 주세요.');return Number(match[1])*60+Number(match[2])}
  function parseLatency(value){const text=String(value).trim();if(text==='')throw new Error('잠드는 시간을 입력해 주세요.');if(!/^\d+$/.test(text))throw new Error('잠드는 시간은 정수로 입력해 주세요.');const n=Number(text);if(!Number.isSafeInteger(n)||n<0||n>120)throw new Error('잠드는 시간은 0~120분으로 입력해 주세요.');return n}
  function pad(n){return String(n).padStart(2,'0')}
  function formatClock(minutes){const normalized=((minutes%1440)+1440)%1440;return pad(Math.floor(normalized/60))+':'+pad(normalized%60)}
  function calculateBedtimes(wakeInput,latencyInput){const wakeMinutes=parseTime(wakeInput);const latency=parseLatency(latencyInput);const candidates=[6,5,4].map(cycles=>{const raw=wakeMinutes-(cycles*90+latency);return{cycles,sleepMinutes:cycles*90,time:formatClock(raw),dayOffset:raw<0?-1:0,recommended:cycles===5}});return{wakeMinutes,wakeTime:formatClock(wakeMinutes),latency,candidates}}
  root.SleepCore={calculateBedtimes,formatClock};
})(typeof window!=='undefined'?window:globalThis);
