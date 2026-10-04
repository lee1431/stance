(function(root){
'use strict';
const order=['firmware','manager','loader','kernel','initramfs','pid1','services'];
const details={
 firmware:{last:'전원 회로',handoff:'하드웨어 → 펌웨어',clue:'제조사 로고도 나타나지 않을 수 있음',next:'전원·메모리·보드 진단 표시 확인',note:'운영체제나 부트로더가 실행되기 전입니다.'},
 manager:{last:'UEFI 펌웨어',handoff:'부트 관리자 → EFI 프로그램',clue:'부팅 가능한 장치 없음 또는 부트 메뉴 복귀',next:'BootOrder·Boot####·EFI 파일과 장치 경로 확인',note:'운영체제 파일이 있어도 펌웨어가 다음 실행 항목을 찾지 못할 수 있습니다.'},
 loader:{last:'UEFI 부트 관리자',handoff:'로더 → 커널 진입점',clue:'로더 메뉴 뒤 커널 파일 오류',next:'커널·initramfs 경로와 로더 설정 확인',note:'부트 항목은 실행됐지만 커널을 메모리에 준비하지 못한 단계입니다.'},
 kernel:{last:'부트로더',handoff:'커널 → 사용 가능한 장치 기반',clue:'초기 커널 메시지 또는 패닉',next:'커널 명령줄·장치 드라이버·하드웨어 오류 확인',note:'커널 진입점까지는 도달했습니다.'},
 initramfs:{last:'Linux 커널',handoff:'초기 사용자 공간 → 실제 루트',clue:'루트 장치 대기, 긴급 셸 또는 mount 오류',next:'root=·UUID·암호화·저장 모듈과 initramfs 확인',note:'작은 임시 세계는 실행됐지만 실제 운영체제 루트를 열지 못했습니다.'},
 pid1:{last:'initramfs / 실제 루트',handoff:'커널 → 호스트 init(PID 1)',clue:'No working init found 계열 오류',next:'init 파일·인터프리터·라이브러리·CPU 아키텍처 확인',note:'실제 루트는 보이지만 첫 사용자 공간 프로그램을 실행하지 못했습니다.'},
 services:{last:'호스트 PID 1',handoff:'시스템 관리자 → 부팅 목표',clue:'응급 모드, 특정 서비스 실패 또는 로그인 화면 없음',next:'실패한 unit·의존성·현재 부팅 로그 확인',note:'커널과 시스템 관리자는 살아 있고 서비스 그래프에서 막혔습니다.'},
 success:{last:'모든 인수인계',handoff:'서비스 → 로그인·사용자 환경',clue:'로그인 화면 또는 셸 사용 가능',next:'필요하면 부팅 시간과 경고 로그 점검',note:'단순화한 모든 단계를 통과했습니다.'}
};
function diagnoseBoot(stage){return details[stage]||details.firmware;}
if(typeof module!=='undefined'&&module.exports)module.exports={diagnoseBoot,order};
if(!root||!root.document)return;
const d=root.document,lab=d.querySelector('#boot-lab');if(!lab)return;
const select=d.querySelector('#break-stage'),items=[...d.querySelectorAll('#boot-progress li')],log=d.querySelector('#boot-log');
function reset(){items.forEach(x=>x.className='');d.querySelector('#last-success').textContent='아직 실행 전';d.querySelector('#failed-handoff').textContent='—';d.querySelector('#visible-clue').textContent='—';d.querySelector('#next-check').textContent='—';log.className='demo-log';log.textContent='중단 지점을 선택하고 모형을 실행하세요.';}
function run(){const stage=select.value,result=diagnoseBoot(stage),stop=stage==='success'?order.length:order.indexOf(stage);items.forEach((item,index)=>{item.className=index<stop?'passed':index===stop?'failed':'';});d.querySelector('#last-success').textContent=result.last;d.querySelector('#failed-handoff').textContent=result.handoff;d.querySelector('#visible-clue').textContent=result.clue;d.querySelector('#next-check').textContent=result.next;log.className='demo-log '+(stage==='success'?'success':'warning');log.textContent=result.note;}
d.querySelector('#run-boot').addEventListener('click',run);d.querySelector('#reset-boot').addEventListener('click',()=>{select.value='firmware';reset();});select.addEventListener('change',reset);reset();
})(typeof window!=='undefined'?window:null);
