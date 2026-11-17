/* DSD Centers: optional center membership, shared manifest, claim moves. */
(function(){
'use strict';
const API=window.DSD_API;
const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);return e;};
const $=id=>document.getElementById(id);
const state={centers:[],catalog:[],onSwitch:null,available:false,dialog:null,busy:false};
function toast(message,fail=false){
 const region=$('centersMessage');
 if(region){region.textContent=message;region.style.color=fail?'#b42332':'#13754c';}
}
async function invoke(fn){
 if(state.busy)return null;
 state.busy=true;
 try{return await fn();}
 catch(e){toast(e.message||'센터 작업에 실패했습니다.',true);return null;}
 finally{state.busy=false;}
}
function setup(){
 if(state.dialog)return;
 const css=el('style');
 css.textContent='.dsd-center-pane{padding:12px 0;display:flex;flex-direction:column;gap:7px}.dsd-center-pane label{font-size:12px;font-weight:850;color:#36516f}.dsd-center-pane select{width:100%;min-height:39px;border-radius:9px;border:1px solid #c5d4e4;background:white;padding:7px;color:#153754}.dsd-center-pane button{background:#eaf1fc;color:#245686;border:0;border-radius:9px;padding:9px;font-weight:800;text-align:center}.dsd-center-dialog{border-radius:16px;background:#fafcff;border:1px solid #c6d6e6;padding:18px;width:min(490px,96vw);max-height:88vh;overflow:auto;color:#173253}.dsd-center-dialog::backdrop{background:#081a2caa}.dsd-center-dialog .center-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}.dsd-center-dialog h2{font-size:19px;margin:0}.dsd-center-dialog h3{font-size:14px;margin:15px 0 7px}.dsd-center-dialog p{font-size:12px;line-height:1.55}.dsd-center-dialog .center-line{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0}.dsd-center-dialog input,.dsd-center-dialog select{border:1px solid #bdd0de;background:white;color:#19314d;padding:9px;border-radius:9px;min-width:0;flex:1;min-height:39px}.dsd-center-dialog button{border:1px solid #c0d0df;color:#153753;background:#eef4fa;border-radius:8px;padding:9px 11px;font-weight:800}.dsd-center-dialog button.main{background:#186a80;color:white;border-color:#186a80}.dsd-center-dialog #centerInviteBox{white-space:pre-wrap;overflow-wrap:anywhere;font-weight:800;padding:10px;border-radius:9px;background:#e8f8ec;color:#155b37}.dsd-center-dialog .center-muted{color:#61758b}.dsd-center-dialog #centersMessage{font-size:12px;min-height:18px}';
 document.head.append(css);
 const pane=el('div');pane.className='dsd-center-pane';
 pane.innerHTML='<label for="dsdCenterSelect">소속 센터</label><select id="dsdCenterSelect"><option value="">개인 작업</option></select><button id="dsdCenterManage" type="button">센터 추가 · 가입 · 관리</button>';
 const box=$('drawer')?.querySelector('.drawer-stack');
 if(box)box.prepend(pane);
 const dlg=el('dialog');dlg.className='dsd-center-dialog';
 dlg.innerHTML='<div class="center-heading"><h2>DSD 센터 관리</h2><button type="button" id="dsdCenterClose">닫기</button></div><p>센터 별도 계정은 만들지 않습니다. 기존 기사 계정으로 소속되며, 개인정보 보호를 위해 처음 가입할 때만 초대코드가 필요합니다.</p><h3>센터 생성</h3><div class="center-line"><input id="dsdCenterName" maxlength="100" placeholder="예: 충주 대신택배 센터"><button id="dsdCenterCreate" class="main" type="button">센터 추가</button></div><h3>기존 센터 가입</h3><div class="center-line"><select id="dsdCenterCatalog"></select></div><div class="center-line"><input id="dsdCenterJoinCode" placeholder="센터 초대코드" autocomplete="off"><button id="dsdCenterJoin" type="button" class="main">가입</button></div><h3>선택한 센터</h3><p id="dsdCenterInfo" class="center-muted">센터를 선택하세요.</p><div class="center-line"><button type="button" id="dsdCenterMembers">기사 목록 보기</button><button type="button" id="dsdCenterInvite">초대코드 재발급 (생성자)</button></div><p id="centerInviteBox" hidden></p><p id="centersMessage" role="status"></p>';
 document.body.append(dlg);state.dialog=dlg;
 $('dsdCenterSelect')?.addEventListener('change',async e=>{
   API.setCenterId(e.target.value);
   await refreshSelection();
   if(state.onSwitch)await state.onSwitch();
 });
 $('dsdCenterManage')?.addEventListener('click',()=>open());
 $('dsdCenterClose').onclick=()=>dlg.close();
 $('dsdCenterCreate').onclick=()=>invoke(async()=>{
   const name=$('dsdCenterName').value.trim();
   if(name.length<2)throw Error('센터 이름을 입력하세요.');
   const response=await API.centerCreate(name);
   await reload();
   API.setCenterId(response.center.id);
   await refreshSelection();
   $('centerInviteBox').hidden=false;
   $('centerInviteBox').textContent='센터 가입용 초대코드 (한 번만 표시): '+response.join_code;
   toast('센터를 만들었습니다. 초대코드를 소속 기사에게만 공유하세요.');
   if(state.onSwitch)await state.onSwitch();
 });
 $('dsdCenterJoin').onclick=()=>invoke(async()=>{
   const id=$('dsdCenterCatalog').value,code=$('dsdCenterJoinCode').value.trim();
   if(!id||!code)throw Error('가입할 센터와 초대코드를 입력하세요.');
   await API.centerJoin(id,code);
   $('dsdCenterJoinCode').value='';
   await reload();
   API.setCenterId(id);await refreshSelection();
   toast('센터 가입이 완료됐습니다.');
   if(state.onSwitch)await state.onSwitch();
 });
 $('dsdCenterMembers').onclick=()=>invoke(async()=>{
   const id=API.centerId();
   if(!id)throw Error('센터를 먼저 선택하세요.');
   const response=await API.centerMembers(id);
   const str=(response.members||[]).map(m=>m.label+(m.role==='owner'?' · 생성자':'')).join('\n');
   toast('소속 기사:\n'+(str||'아직 등록된 기사가 없습니다.'));
 });
 $('dsdCenterInvite').onclick=()=>invoke(async()=>{
   const id=API.centerId();if(!id)throw Error('센터를 먼저 선택하세요.');
   if(!confirm('기존 초대코드는 무효화됩니다. 새 코드로 재발급할까요?'))return;
   const response=await API.centerInvite(id);
   $('centerInviteBox').hidden=false;
   $('centerInviteBox').textContent='새 초대코드 (한 번만 표시): '+response.join_code;
   toast('초대코드 재발급 완료. 안전하게 보관하세요.');
 });
}
async function reload(){
 const [membership,catalog]=await Promise.all([API.centers(),API.centerCatalog()]);
 state.centers=membership.centers||[];
 state.catalog=catalog.centers||[];
 state.available=true;
 const select=$('dsdCenterSelect');if(!select)return;
 select.replaceChildren();
 const own=el('option','개인 작업');own.value='';select.append(own);
 for(const center of state.centers){
   const o=el('option',center.name);o.value=center.id;select.append(o);
 }
 let selected=API.centerId();
 if(selected&&!state.centers.some(x=>x.id===selected)){API.setCenterId('');selected='';}
 select.value=selected;
 const catalogSelect=$('dsdCenterCatalog');
 catalogSelect.replaceChildren();
 for(const center of state.catalog){
   const o=el('option',center.name);o.value=center.id;catalogSelect.append(o);
 }
 await refreshSelection();
}
async function refreshSelection(){
 const id=API.centerId();
 const center=state.centers.find(item=>item.id===id);
 const info=$('dsdCenterInfo');
 if(info)info.textContent=center
   ?center.name+' · '+(center.role==='owner'?'센터 생성자':'소속 기사')+' · '+center.member_count+'명'
   :'개인 작업 모드: 기존 개인 엑셀과 회차만 표시';
 if($('dsdCenterSelect'))$('dsdCenterSelect').value=center?id:'';
}
async function start(onSwitch){
 state.onSwitch=onSwitch;
 setup();
 try{await reload();}
 catch(e){
   // The S10 backend may not yet have this feature. Keep existing DSD fully usable.
   state.available=false;API.setCenterId('');
   $('dsdCenterSelect').disabled=true;
   $('dsdCenterManage').disabled=true;
   $('dsdCenterManage').textContent='센터 기능 · S10 서버 업데이트 필요';
 }
}
async function open(){
 if(!state.available)return;
 if(!state.dialog)setup();
 await reload().catch(e=>toast(e.message,true));
 $('centerInviteBox').hidden=true;
 $('centerInviteBox').textContent='';
 toast('');
 state.dialog.showModal();
}
function moveStop(stop,round,rounds,onChanged){
 const options=rounds.filter(r=>r.id!==round.id);
 if(!options.length){onChanged(null,'이동할 회차가 없습니다. 먼저 + 버튼으로 회차를 추가하세요.');return;}
 const list=options.map(r=>r.round_no+'회차').join(', ');
 const text=prompt('이동할 회차 번호를 입력하세요. (가능: '+list+')',String(options[0].round_no));
 if(text===null)return;
 const no=Number(text),target=options.find(x=>x.round_no===no);
 if(!target){onChanged(null,'회차 번호를 확인하세요.');return;}
 if(!confirm(stop.position+'번 물품을 '+no+'회차로 이동할까요?'))return;
 API.moveRoundStop(stop.id,target.id,round.revision)
   .then(response=>onChanged(response,no+'회차로 이동했습니다.'))
   .catch(e=>onChanged(null,e.message));
}
async function transferStop(stop,round,onChanged){
 const center=API.centerId();
 if(!center){onChanged(null,'센터를 먼저 선택하세요.');return;}
 try{
   const response=await API.centerMembers(center);
   const people=(response.members||[]).filter(m=>!m.is_self);
   // Self filtering uses the active signed-in user ID, supplied by the caller.
   const choices=people.filter(m=>m.id!==(window.DSD_CURRENT_USER_ID||''));
   if(!choices.length){onChanged(null,'인계할 다른 기사가 없습니다. 기사 가입이 필요합니다.');return;}
   const list=choices.map((m,i)=>(i+1)+'. '+m.label).join('\n');
   const entered=prompt('물품을 넘길 기사를 선택하세요. 번호 입력:\n'+list,'1');
   if(entered===null)return;
   const target=choices[Number(entered)-1];
   if(!target){onChanged(null,'기사 번호를 확인하세요.');return;}
   if(!confirm('이 물품을 '+target.label+' 기사에게 넘길까요?'))return;
   const result=await API.transferStop(stop.id,target.id,round.revision);
   onChanged(result,target.label+' 기사에게 물품을 인계했습니다.');
 }catch(e){onChanged(null,e.message);}
}
window.DSDCenters={start,open,moveStop,transferStop,reload};
})();