(()=>{
const d=document,select=d.querySelector('#copy-scenario');if(!select)return;
const presets={
 alias:{steps:[
  ['original','원본 객체 생성','원본 상자 안에 profile 객체가 있고, profile 안에는 도시가 충주로 적혀 있습니다.'],
  ['copy','같은 객체를 가리킴','copy = original은 새 객체를 만들지 않습니다. 두 변수의 화살표가 같은 바깥 객체에 닿습니다.'],
  ['nested','copy.profile.city 수정','copy를 따라 들어가 도시를 원주로 바꾸면 같은 객체를 보는 original에서도 원주가 보입니다.'],
  ['result','original === copy → true','두 이름은 내용이 우연히 같은 두 객체가 아니라 같은 객체 하나의 별칭입니다.']
 ]},
 shallow:{steps:[
  ['original','원본 객체 생성','원본에는 name이라는 문자열과 profile이라는 중첩 객체가 있습니다.'],
  ['copy','새 바깥 객체 생성','copy = { ...original }은 바깥 객체를 새로 만들고 열거 가능한 자체 속성의 값을 옮깁니다.'],
  ['nested','profile 참조는 공유','문자열 name은 독립적으로 바꿀 수 있지만 profile 값은 같은 중첩 객체를 가리킵니다.'],
  ['result','겉은 분리, 속은 연결','copy.profile.city를 바꾸면 original.profile.city도 바뀌는 얕은 복사 결과입니다.']
 ]},
 deep:{steps:[
  ['original','순환을 포함한 그래프','원본의 self가 자기 자신을 가리키고 Map과 Date도 들어 있는 가상 자료입니다.'],
  ['copy','structuredClone 실행','복제 알고리즘이 지원되는 값들을 새 객체 그래프로 직렬화하고 다시 구성합니다.'],
  ['nested','새 중첩 객체 생성','복제본의 profile을 바꿔도 원본 profile은 그대로이며, 복제본 내부의 self는 복제본을 가리킵니다.'],
  ['result','분리된 그래프 완성','원본과 복제본은 다른 객체지만 복제본 내부의 관계와 지원되는 자료형은 보존됩니다.']
 ]},
 transfer:{steps:[
  ['original','8바이트 버퍼 준비','원본 ArrayBuffer가 8바이트 메모리를 소유하고 있다고 가정합니다.'],
  ['copy','transfer 목록에 등록','structuredClone(value, { transfer: [buffer] })는 바이트를 복사하는 대신 소유권을 넘깁니다.'],
  ['nested','원본 버퍼 분리','새 객체가 8바이트를 갖고 원본 buffer.byteLength는 0이 되어 더는 그 저장소를 쓸 수 없습니다.'],
  ['result','복사가 아닌 이동','큰 이진 데이터를 중복하지 않지만, 이전 소유자는 사용권을 잃는 명시적 거래입니다.']
 ]}
};
const nodes=[...d.querySelectorAll('#copy-track [data-role]')],stepEl=d.querySelector('#copy-step'),result=d.querySelector('#copy-result'),log=d.querySelector('#copy-log'),next=d.querySelector('#copy-next');let index=-1;
function reset(){index=-1;nodes.forEach(n=>n.className='');stepEl.textContent='준비';result.textContent='방식을 선택하세요';log.className='demo-log';log.textContent='‘다음 단계’를 누르면 객체와 화살표의 변화를 따라갑니다.';next.disabled=false;next.textContent='다음 단계';}
function show(){const list=presets[select.value].steps,entry=list[index],node=nodes.find(n=>n.dataset.role===entry[0]);nodes.forEach(n=>n.className=n===node?'active':'');stepEl.textContent=(index+1)+' / '+list.length+' · '+node.textContent;result.textContent=entry[1];log.textContent=entry[2];const done=index===list.length-1;log.className='demo-log '+(done?'success':'');next.disabled=done;next.textContent=done?'비교 완료':'다음 단계';}
next.addEventListener('click',()=>{const list=presets[select.value].steps;if(index<list.length-1){index++;show();}});d.querySelector('#copy-reset').addEventListener('click',reset);select.addEventListener('change',reset);reset();
})();
