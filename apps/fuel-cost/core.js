(function(root){
  "use strict";
  function toNumber(value){
    if(typeof value === "string" && value.trim() === "") return NaN;
    return Number(value);
  }
  function validate(input){
    const distance=toNumber(input.distance);
    const efficiency=toNumber(input.efficiency);
    const price=toNumber(input.price);
    if(!Number.isFinite(distance)||!Number.isFinite(efficiency)||!Number.isFinite(price)) return {ok:false,message:"거리, 연비, 연료 가격을 모두 입력해 주세요."};
    if(distance<=0) return {ok:false,message:"거리는 0보다 큰 값으로 입력해 주세요."};
    if(efficiency<=0) return {ok:false,message:"연비는 0보다 큰 값으로 입력해 주세요."};
    if(price<=0) return {ok:false,message:"연료 가격은 0보다 큰 값으로 입력해 주세요."};
    if(distance>100000) return {ok:false,message:"거리는 100,000 km 이하로 입력해 주세요."};
    if(efficiency>100) return {ok:false,message:"연비는 100 km/L 이하로 입력해 주세요."};
    if(price>100000) return {ok:false,message:"연료 가격은 100,000원/L 이하로 입력해 주세요."};
    return {ok:true,distance,efficiency,price,roundTrip:Boolean(input.roundTrip)};
  }
  function calculate(input){
    const checked=validate(input);
    if(!checked.ok) return checked;
    const totalDistance=checked.distance*(checked.roundTrip?2:1);
    const liters=totalDistance/checked.efficiency;
    const totalCost=liters*checked.price;
    return {ok:true,totalDistance,liters,totalCost,costPerKm:totalCost/totalDistance,roundTrip:checked.roundTrip};
  }
  root.FuelCost={validate,calculate};
})(typeof window!=="undefined"?window:globalThis);
