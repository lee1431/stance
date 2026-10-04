(()=>{'use strict';
const d=document,select=d.querySelector('#process-scenario');if(!select)return;
const presets={
 navigate:{steps:[['browser','탐색 결정','주소창 입력을 브라우저 프로세스가 받고 대상 사이트와 렌더러 배치를 결정합니다.'],['network','응답 요청','네트워크 서비스가 연결·쿠키·캐시 정책 아래 문서를 요청합니다.'],['renderer-a','문서 실행','낮은 권한의 렌더러 A가 HTML·CSS·JavaScript를 처리합니다.'],['gpu','화면 합성','GPU/Viz 쪽이 렌더링 결과를 다른 표면과 합쳐 표시합니다.']]},
 iframe:{steps:[['renderer-a','부모 문서','렌더러 A가 주 문서를 실행하며 교차 사이트 iframe 탐색을 요청합니다.'],['browser','사이트 경계 확인','브라우저가 하위 프레임의 SiteInstance와 보안 경계를 확인합니다.'],['network','iframe 응답','네트워크 서비스가 교차 사이트 문서를 가져옵니다.'],['renderer-b','격리된 하위 프레임','다른 사이트의 문서를 렌더러 B가 처리하는 단순화된 상황입니다.'],['gpu','한 화면으로 합성','두 렌더러의 결과가 GPU/Viz 단계에서 한 탭 화면으로 모입니다.']]},
 crash:{steps:[['renderer-a','웹 콘텐츠 실행','렌더러 A가 사이트 코드를 실행하던 중 오류가 발생합니다.'],['browser','충돌 감지','브라우저 프로세스는 렌더러 종료를 감지하고 영향을 받은 콘텐츠를 표시합니다.'],['renderer-b','다른 경계 유지','별도 렌더러 B의 사이트는 같은 오류에 직접 묶이지 않습니다.']]},
 file:{steps:[['renderer-a','파일 선택 요청','웹페이지는 렌더러에서 파일 선택 기능을 요청하지만 파일을 임의로 읽지 못합니다.'],['browser','사용자 선택과 권한','브라우저 프로세스가 사용자에게 선택 UI를 제공하고 허용된 파일만 중재합니다.'],['renderer-a','허용된 결과 전달','렌더러는 사용자가 고른 파일에 대한 제한된 웹 API 결과를 받습니다.']]}
};
const nodes=[...d.querySelectorAll('#process-track [data-role]')],stepEl=d.querySelector('#process-step'),purpose=d.querySelector('#process-purpose'),log=d.querySelector('#process-log'),next=d.querySelector('#process-next');let index=-1;
function reset(){index=-1;nodes.forEach(n=>n.className='');stepEl.textContent='준비';purpose.textContent='상황을 선택하세요';log.className='demo-log';log.textContent='‘다음 경계’를 누르면 첫 역할부터 시작합니다.';next.disabled=false;next.textContent='다음 경계';}
function show(){const list=presets[select.value].steps,entry=list[index];nodes.forEach(n=>n.className=n.dataset.role===entry[0]?'active':'');stepEl.textContent=(index+1)+' / '+list.length+' · '+nodes.find(n=>n.dataset.role===entry[0]).textContent;purpose.textContent=entry[1];log.textContent=entry[2];const done=index===list.length-1;log.className='demo-log '+(done?'success':'');next.disabled=done;next.textContent=done?'흐름 완료':'다음 경계';}
next.addEventListener('click',()=>{const list=presets[select.value].steps;if(index<list.length-1){index++;show();}});d.querySelector('#process-reset').addEventListener('click',reset);select.addEventListener('change',reset);reset();
})();
