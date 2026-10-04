(function(root){
'use strict';
const presets={
 open:{path:1,open:1,snapshot:0,label:'서비스가 파일을 연 상태입니다. 경로를 지워 보세요.',release:'프로세스가 파일 디스크립터를 닫았습니다.'},
 hardlink:{path:2,open:0,snapshot:0,label:'같은 inode를 가리키는 경로가 두 개입니다. 하나를 지워 보세요.',release:'남은 하드 링크도 삭제했습니다.'},
 snapshot:{path:1,open:0,snapshot:1,label:'현재 경로와 스냅샷이 같은 블록을 참조합니다. 경로를 지워 보세요.',release:'스냅샷 참조와 내부 정리가 끝났습니다.'},
 plain:{path:1,open:0,snapshot:0,label:'추가 참조가 없는 일반 파일입니다. 경로를 지워 보세요.',release:'해제할 추가 참조가 없습니다.'}
};
function statusOf(state){const held=state.path>0||state.open>0||state.snapshot>0;let reason='마지막 참조가 없어 블록을 재사용할 수 있습니다.';if(held){const r=[];if(state.path)r.push('경로 링크 '+state.path);if(state.open)r.push('열린 손잡이 '+state.open);if(state.snapshot)r.push('스냅샷 참조 '+state.snapshot);reason=r.join(' · ')+'이 남아 공간을 붙잡고 있습니다.';}return{held,block:held?'사용 중':'재사용 가능',reason};}
function initialState(kind){const p=presets[kind]||presets.open;return{kind:presets[kind]?kind:'open',path:p.path,open:p.open,snapshot:p.snapshot,unlinked:false};}
function unlinkState(state){const next={...state};if(next.path>0){next.path--;next.unlinked=true;}return next;}
function releaseState(state){const next={...state};if(next.kind==='open')next.open=0;else if(next.kind==='hardlink')next.path=0;else if(next.kind==='snapshot')next.snapshot=0;return next;}
if(typeof module!=='undefined'&&module.exports)module.exports={statusOf,initialState,unlinkState,releaseState,presets};
if(!root||!root.document)return;const d=root.document,lab=d.querySelector('#release-lab');if(!lab)return;
const scenario=d.querySelector('#release-scenario'),path=d.querySelector('#path-links'),open=d.querySelector('#open-refs'),snapshot=d.querySelector('#snapshot-refs'),block=d.querySelector('#block-state'),log=d.querySelector('#release-log'),track=[...d.querySelectorAll('#reference-track [data-ref]')];let state;
function draw(message){const result=statusOf(state);path.textContent=state.path;open.textContent=state.open;snapshot.textContent=state.snapshot;block.textContent=result.block;block.className=result.held?'held':'free';track.forEach(el=>{const key=el.dataset.ref,count=key==='path'?state.path:key==='open'?state.open:state.snapshot;el.className=count?'active':'released';});log.className='demo-log '+(result.held?'warning':'success');log.textContent=(message?message+' ':'')+result.reason;d.querySelector('#unlink-file').disabled=state.path===0;d.querySelector('#release-ref').disabled=!state.unlinked||(state.open===0&&state.snapshot===0&&!(state.kind==='hardlink'&&state.path>0));}
function reset(){state=initialState(scenario.value);draw(presets[state.kind].label);}
d.querySelector('#unlink-file').addEventListener('click',()=>{state=unlinkState(state);draw('선택한 경로 이름을 제거했습니다.');});
d.querySelector('#release-ref').addEventListener('click',()=>{state=releaseState(state);draw(presets[state.kind].release);});
d.querySelector('#reset-release').addEventListener('click',reset);scenario.addEventListener('change',reset);reset();
})(typeof window!=='undefined'?window:null);
