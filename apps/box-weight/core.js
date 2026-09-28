(function(root){
  "use strict";

  const ROUNDING_UNITS=[0,0.1,0.5,1];

  function number(value){
    if(value===""||value===null||value===undefined)return null;
    const parsed=Number(value);
    return Number.isFinite(parsed)?parsed:NaN;
  }

  function roundUp(value,unit){
    if(!unit)return value;
    return Math.ceil((value-Number.EPSILON)/unit)*unit;
  }

  function calculate(input){
    const length=number(input.length);
    const width=number(input.width);
    const height=number(input.height);
    const actualWeight=number(input.actualWeight);
    const quantity=number(input.quantity);
    const divisor=number(input.divisor);
    const rounding=number(input.rounding);

    if([length,width,height,actualWeight].some(value=>value===null)){
      return {ok:false,code:"empty",message:"가로·세로·높이와 실제 무게를 모두 입력해 주세요."};
    }
    if([length,width,height,actualWeight,quantity,divisor,rounding].some(value=>Number.isNaN(value))){
      return {ok:false,code:"invalid",message:"숫자로 입력할 수 있는 값인지 확인해 주세요."};
    }
    if([length,width,height].some(value=>value<=0||value>10000)){
      return {ok:false,code:"dimensions",message:"각 박스 치수는 0보다 크고 10,000cm 이하여야 합니다."};
    }
    if(actualWeight<=0||actualWeight>100000){
      return {ok:false,code:"weight",message:"실제 무게는 0보다 크고 100,000kg 이하여야 합니다."};
    }
    if(!Number.isInteger(quantity)||quantity<1||quantity>10000){
      return {ok:false,code:"quantity",message:"수량은 1~10,000 사이의 정수로 입력해 주세요."};
    }
    if(!Number.isFinite(divisor)||divisor<100||divisor>100000){
      return {ok:false,code:"divisor",message:"부피무게 제수는 100~100,000 사이로 입력해 주세요."};
    }
    if(!ROUNDING_UNITS.includes(rounding)){
      return {ok:false,code:"rounding",message:"올림 단위를 다시 선택해 주세요."};
    }

    const volumeCm3=length*width*height;
    const volumeLiters=volumeCm3/1000;
    const volumeWeight=volumeCm3/divisor;
    const rawBillable=Math.max(actualWeight,volumeWeight);
    const billableWeight=roundUp(rawBillable,rounding);
    const totalBillableWeight=billableWeight*quantity;
    const totalActualWeight=actualWeight*quantity;
    const totalVolumeLiters=volumeLiters*quantity;
    const dominant=volumeWeight>actualWeight?"volume":volumeWeight<actualWeight?"actual":"same";
    const difference=Math.abs(volumeWeight-actualWeight);
    const comparisonMax=Math.max(volumeWeight,actualWeight);

    return {
      ok:true,
      length,width,height,actualWeight,quantity,divisor,rounding,
      volumeCm3,volumeLiters,volumeWeight,rawBillable,billableWeight,
      totalBillableWeight,totalActualWeight,totalVolumeLiters,dominant,difference,
      actualRatio:comparisonMax?actualWeight/comparisonMax*100:0,
      volumeRatio:comparisonMax?volumeWeight/comparisonMax*100:0
    };
  }

  root.BoxWeight={calculate,roundUp};
})(typeof window!=="undefined"?window:globalThis);
