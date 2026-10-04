(()=>{
const d=document,select=d.querySelector('#path-scenario');if(!select)return;
const presets={
 exact:{steps:[['planner','후보 약 1행','통계상 주문번호는 매우 선택적이므로 인덱스 경로를 택하는 가상 상황입니다.'],['root','천만 키 → 한 큰 구간','루트의 경계 키와 7312를 비교해 6000–9000 가지 하나만 고릅니다.'],['branch','큰 구간 → 한 잎 페이지','가지의 7000과 7600 사이 자식으로 내려가 나머지 구간을 건너뜁니다.'],['leaf','잎에서 7312 발견','정렬된 잎 항목에서 원본 위치 P84를 얻습니다.'],['heap','원본 1행 확인','P84의 행 값과 현재 스냅샷 가시성을 확인해 결과를 돌려줍니다.']]},
 range:{steps:[['planner','후보 약 1,000행','좁은 연속 범위라 인덱스로 시작점을 찾는 가상 계획입니다.'],['root','7000이 든 가지 선택','루트에서 7000이 시작될 구간으로 내려갑니다.'],['branch','첫 잎 페이지 선택','가지에서 범위 시작점과 만나는 잎을 고릅니다.'],['leaf','7000부터 옆 잎으로 이동','정렬된 잎 항목을 오른쪽으로 이어 읽고 7999를 넘으면 멈춥니다.'],['heap','후보 원본 행 확인','필요한 열과 가시성을 위해 후보가 가리키는 원본 페이지를 읽습니다.']]},
 common:{steps:[['planner','후보 약 92%','대부분의 행이 배송완료라 인덱스 뒤 원본 방문보다 순차 읽기가 싸다고 추정합니다.'],['heap','원본 페이지를 순서대로','인덱스 루트·가지·잎을 건너뛰고 테이블 페이지를 연속으로 읽으며 조건을 확인합니다.']]},
 suffix:{steps:[['planner','선두 열 조건 없음','(shop_id, created_at) 정렬에서 created_at만 주어져 곧장 한 상점 구간으로 갈 수 없습니다.'],['root','여러 상점 구간 검토','skip scan이나 전체 인덱스 스캔, 순차 스캔의 추정 비용을 비교합니다.'],['leaf','흩어진 시각 후보','후행 열 조건은 각 선두 키 구간에 흩어져 있어 여러 잎 구간을 만날 수 있습니다.'],['heap','원본 후보 확인','선택한 계획이 가리키는 원본 행에서 값과 가시성을 확인합니다.']]}
};
const nodes=[...d.querySelectorAll('#page-track [data-role]')],stepEl=d.querySelector('#path-step'),result=d.querySelector('#path-result'),log=d.querySelector('#path-log'),next=d.querySelector('#path-next');let index=-1;
function reset(){index=-1;nodes.forEach(n=>n.className='');stepEl.textContent='준비';result.textContent='질의를 선택하세요';log.className='demo-log';log.textContent='‘다음 읽기’를 누르면 플래너의 판단부터 시작합니다.';next.disabled=false;next.textContent='다음 읽기';}
function show(){const list=presets[select.value].steps,entry=list[index],node=nodes.find(n=>n.dataset.role===entry[0]);nodes.forEach(n=>n.className=n===node?'active':'');stepEl.textContent=(index+1)+' / '+list.length+' · '+node.textContent;result.textContent=entry[1];log.textContent=entry[2];const done=index===list.length-1;log.className='demo-log '+(done?'success':'');next.disabled=done;next.textContent=done?'경로 완료':'다음 읽기';}
next.addEventListener('click',()=>{const list=presets[select.value].steps;if(index<list.length-1){index++;show();}});d.querySelector('#path-reset').addEventListener('click',reset);select.addEventListener('change',reset);reset();
})();
