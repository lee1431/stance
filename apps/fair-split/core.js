(function(root){
  'use strict';
  function splitBill(total, people, unit){
    if(total===null||total===undefined||String(total).trim()==='') throw new Error('총액을 입력해 주세요.');
    const amount=Number(total), count=Number(people), round=Number(unit);
    if(!Number.isSafeInteger(amount)||amount<0||amount>999999999) throw new Error('총액은 0원부터 999,999,999원까지 정수로 입력해 주세요.');
    if(!Number.isSafeInteger(count)||count<2||count>100) throw new Error('인원은 2명부터 100명까지 입력해 주세요.');
    if(![1,10,100,1000].includes(round)) throw new Error('정산 단위를 다시 선택해 주세요.');
    const base=Math.floor(amount/count/round)*round;
    const afterBase=amount-base*count;
    const highCount=Math.floor(afterBase/round);
    const loose=afterBase-highCount*round;
    return {total:amount,people:count,unit:round,base,high:base+round,highCount,lowCount:count-highCount,loose,exact:loose===0};
  }
  if(typeof module!=='undefined'&&module.exports) module.exports=splitBill;
  else root.splitBill=splitBill;
})(typeof window==='undefined'?globalThis:window);
