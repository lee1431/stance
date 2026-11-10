/* DSD road-aware ordering pilot. Uses OSRM demo only after explicit user consent.
 * This is a browser-only pilot, not a production delivery routing service. */
(function(root){
  'use strict';
  const BASE='https://router.project-osrm.org';
  const MAX_POINTS=16;
  const valid=p=>p && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
    p.lat>=-90 && p.lat<=90 && p.lng>=-180 && p.lng<=180;
  const coord=p=>Number(p.lng).toFixed(6)+','+Number(p.lat).toFixed(6);
  const cost=(order,matrix)=>{
    let sum=0;
    for(let i=1;i<order.length;i++){
      const value=matrix[order[i-1]]?.[order[i]];
      if(!Number.isFinite(value) || value<0)return Infinity;
      sum+=value;
    }
    return sum;
  };
  async function osrm(service,points,query,signal){
    const url=BASE+'/'+service+'/v1/driving/'+points.map(coord).join(';')+'?'+query;
    const res=await fetch(url,{signal,mode:'cors',referrerPolicy:'strict-origin-when-cross-origin'});
    if(!res.ok)throw new Error('OSRM 도로 서버 HTTP '+res.status);
    const data=await res.json();
    if(data.code!=='Ok')throw new Error('OSRM 도로 조회 실패: '+(data.message||data.code||'알 수 없음'));
    return data;
  }
  function improve(order,freeCount,distances){
    // Directed distances: reversing a segment changes its costs on one-way streets.
    let best=cost(order,distances);
    for(let pass=0;pass<3;pass++){
      let improved=false;
      for(let i=1;i<freeCount;i++)for(let j=i+1;j<=freeCount;j++){
        const proposal=order.slice();
        proposal.splice(i,j-i+1,...order.slice(i,j+1).reverse());
        const candidate=cost(proposal,distances);
        if(candidate+0.1<best){order=proposal;best=candidate;improved=true;}
      }
      if(!improved)break;
    }
    return order;
  }
  async function recommend({ids,pinnedLastIds,byId,startPoint,signal}){
    if(!Array.isArray(ids)||ids.length<2)throw new Error('배송지가 2곳 이상 필요합니다.');
    const pinned=new Set(pinnedLastIds||[]);
    const free=ids.filter(id=>!pinned.has(id));
    // Without GPS, preserve first ordinary stop as starting anchor.
    const anchorId=startPoint?null:(free[0]||ids[0]);
    const initial=startPoint||byId[anchorId];
    const tail=ids.filter(id=>id!==anchorId);
    const entries=[null,...tail];
    const points=[initial,...tail.map(id=>byId[id])];
    if(points.length>MAX_POINTS)throw new Error('시험용 도로 추천은 출발점 포함 최대 '+MAX_POINTS+'곳까지 지원합니다.');
    if(points.some(p=>!valid(p)))throw new Error('배송지 또는 출발점 좌표가 올바르지 않습니다.');
    const result=await osrm('table',points,'annotations=distance,duration',signal);
    const distances=result.distances,durations=result.durations;
    if(!Array.isArray(distances)||distances.length!==points.length ||
       !Array.isArray(durations)||durations.length!==points.length ||
       distances.some(row=>!Array.isArray(row)||row.length!==points.length) ||
       durations.some(row=>!Array.isArray(row)||row.length!==points.length))
      throw new Error('도로 거리표가 불완전합니다.');
    const fixed=entries.slice(1).map((id,i)=>({id,index:i+1})).filter(x=>pinned.has(x.id));
    const mutable=entries.slice(1).map((id,i)=>({id,index:i+1})).filter(x=>!pinned.has(x.id));
    let order=[0],remaining=mutable.map(x=>x.index);
    while(remaining.length){
      const from=order[order.length-1];
      remaining.sort((a,b)=>(distances[from][a]??Infinity)-(distances[from][b]??Infinity));
      const next=remaining.shift();
      if(!Number.isFinite(distances[from][next]))throw new Error('일부 배송지 사이의 자동차 도로가 연결되지 않았습니다.');
      order.push(next);
    }
    order.push(...fixed.map(x=>x.index));
    order=improve(order,mutable.length,distances);
    if(!Number.isFinite(cost(order,distances)))throw new Error('모든 배송지를 잇는 자동차 경로를 찾지 못했습니다.');
    const orderedIds=order.slice(1).map(i=>entries[i]);
    if(anchorId)orderedIds.unshift(anchorId);
    const meters=cost(order,distances);
    let seconds=0;
    for(let i=1;i<order.length;i++)seconds+=durations[order[i-1]][order[i]];
    if(!Number.isFinite(seconds))throw new Error('도로 예상 시간을 계산할 수 없습니다.');
    return {ids:orderedIds,meters,seconds,points:order.map(i=>points[i])};
  }
  async function geometry(points,signal){
    if(!Array.isArray(points)||points.length<2)throw new Error('도로 선 표시 좌표 부족');
    const data=await osrm('route',points,'overview=full&geometries=geojson&steps=false',signal);
    const route=data.routes?.[0];
    const coords=route?.geometry?.coordinates;
    if(!Array.isArray(coords)||coords.length<2 ||
       coords.some(p=>!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1])))
      throw new Error('도로 선 좌표를 확인하지 못했습니다.');
    return {path:coords.map(p=>({lat:p[1],lng:p[0]})),meters:route.distance,seconds:route.duration};
  }
  root.DsdRoad=Object.freeze({recommend,geometry,MAX_POINTS});
  if(typeof module!=='undefined'&&module.exports)module.exports=root.DsdRoad;
}(typeof window!=='undefined'?window:globalThis));
