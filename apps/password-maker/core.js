(function(root){
  "use strict";

  const SETS={
    lower:"abcdefghijklmnopqrstuvwxyz",
    upper:"ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    numbers:"0123456789",
    symbols:"!@#$%^&*_-+=?"
  };
  const AMBIGUOUS=/[0O1Il|]/g;

  function secureIndex(max){
    if(!Number.isInteger(max)||max<1)throw new Error("잘못된 난수 범위입니다.");
    const cryptoObject=root.crypto;
    if(!cryptoObject||typeof cryptoObject.getRandomValues!=="function")throw new Error("이 브라우저에서는 안전한 난수를 만들 수 없습니다.");
    const range=0x100000000;
    const limit=Math.floor(range/max)*max;
    const data=new Uint32Array(1);
    do{cryptoObject.getRandomValues(data);}while(data[0]>=limit);
    return data[0]%max;
  }

  function prepare(options){
    const length=Number(options.length);
    if(!Number.isInteger(length)||length<8||length>128){
      return {ok:false,code:"length",message:"길이는 8~128 사이의 정수로 선택해 주세요."};
    }
    const selected=[];
    for(const key of ["lower","upper","numbers","symbols"]){
      if(options[key]){
        const chars=options.excludeAmbiguous?SETS[key].replace(AMBIGUOUS,""):SETS[key];
        if(chars)selected.push({key,chars});
      }
    }
    if(!selected.length)return {ok:false,code:"sets",message:"문자 종류를 하나 이상 선택해 주세요."};
    if(selected.length>length)return {ok:false,code:"sets",message:"선택한 문자 종류 수보다 길이를 크게 설정해 주세요."};
    const pool=selected.map(item=>item.chars).join("");
    return {ok:true,length,selected,pool};
  }

  function generate(options,randomIndex){
    const prepared=prepare(options);
    if(!prepared.ok)return prepared;
    const pick=typeof randomIndex==="function"?randomIndex:secureIndex;
    const chars=prepared.selected.map(item=>item.chars[pick(item.chars.length)]);
    while(chars.length<prepared.length)chars.push(prepared.pool[pick(prepared.pool.length)]);
    for(let i=chars.length-1;i>0;i--){const j=pick(i+1);[chars[i],chars[j]]=[chars[j],chars[i]];}
    const password=chars.join("");
    const entropyBits=prepared.length*Math.log2(prepared.pool.length);
    const label=entropyBits>=100?"매우 강함":entropyBits>=75?"강함":entropyBits>=50?"보통":"짧음";
    return {ok:true,password,length:prepared.length,poolSize:prepared.pool.length,entropyBits,label,selected:prepared.selected.map(item=>item.key)};
  }

  root.PasswordMaker={generate,prepare,sets:SETS};
})(typeof window!=="undefined"?window:globalThis);
