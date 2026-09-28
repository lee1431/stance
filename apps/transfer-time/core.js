'use strict';
(function(root){
  const SIZE={MB:1e6,GB:1e9,TB:1e12};
  const SPEED={Mbps:1e6,Gbps:1e9};
  function decimal(value,label,min,max){const text=String(value).trim();if(!text)throw new Error(label+'을 입력해 주세요.');if(!/^\d+(?:\.\d+)?$/.test(text))throw new Error(label+'은 0보다 큰 숫자로 입력해 주세요.');const n=Number(text);if(!Number.isFinite(n)||n<min||n>max)throw new Error(label+'은 '+min+'~'+max+' 범위로 입력해 주세요.');return n}
  function calculateTransfer(sizeInput,sizeUnit,speedInput,speedUnit,efficiencyInput){
    if(!SIZE[sizeUnit])throw new Error('올바른 용량 단위를 선택해 주세요.');if(!SPEED[speedUnit])throw new Error('올바른 속도 단위를 선택해 주세요.');
    const size=decimal(sizeInput,'파일 크기',0.001,100000);const speed=decimal(speedInput,'회선 속도',0.01,100000);const efficiency=decimal(efficiencyInput,'전송 효율',1,100);
    const bytes=size*SIZE[sizeUnit];const nominal=speed*SPEED[speedUnit];const effectiveBps=nominal*(efficiency/100);const seconds=Math.ceil(bytes*8/effectiveBps);
    return{size,sizeUnit,speed,speedUnit,efficiency,bytes,effectiveBps,seconds};
  }
  function formatDuration(total){let s=Math.max(0,Math.round(total));const d=Math.floor(s/86400);s%=86400;const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60);s%=60;const parts=[];if(d)parts.push(d+'일');if(h)parts.push(h+'시간');if(m)parts.push(m+'분');if(s||!parts.length)parts.push(s+'초');return parts.join(' ')}
  root.TransferCore={calculateTransfer,formatDuration};
})(typeof window!=='undefined'?window:globalThis);
