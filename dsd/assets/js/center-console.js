/* DSD center console - authenticated owner operations only. */
(function(){
'use strict';
const API=window.DSD_API;
const $=id=>document.getElementById(id);
const el=(tag,text)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=String(text??'');return element;};
const app={centers:[],center:'',date:'',dashboard:null,shipments:[],page:1,total:0,active:null,busy:false,searchTimer:0,sequence:0};
function isoLocal(){
 const now=new Date();
 return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
}
function note(message,error=false){
 const target=$('ccNotice');target.textContent=message||'';
 target.classList.toggle('error',Boolean(error));
}
function statusText(s){return ({pending:'미완료',done:'완료',failed:'미배송',return:'반품'})[s]||s;}
function blankRow(parent,message,columns=6){
 parent.replaceChildren();const tr=el('tr'),td=el('td',message);td.colSpan=columns;td.className='muted';tr.append(td);parent.append(tr);
}
function cell(row,content,cls){
 const td=el('td',content);if(cls)td.className=cls;row.append(td);return td;
}
async function withBusy(job){
 if(app.busy)return;
 app.busy=true;
 try{return await job();}
 catch(error){note(error.message||'처리 오류가 발생했습니다.',true);}
 finally{app.busy=false;}
}
async function reloadAll(){
 const center=app.center;
 if(!center)return;
 const seq=++app.sequence;
 note('센터 데이터를 불러오는 중입니다.');
 try{
   const response=await API.request('centers/'+encodeURIComponent(center)+'/dashboard?date='+encodeURIComponent(app.date));
   if(seq!==app.sequence)return;
   app.dashboard=response;
   drawDashboard();
   await reloadShipments();
   if(seq===app.sequence)note('');
 }catch(error){
   if(seq===app.sequence){$('ccWorkspace').hidden=true;note(error.message||'센터 데이터를 불러오지 못했습니다.',true);}
 }
}
function drawDashboard(){
 const data=app.dashboard;
 $('ccWorkspace').hidden=false;
 $('ccRawRows').textContent=data.raw?.data_rows??0;
 for(const [id,key] of [['ccTotal','total'],['ccDone','done'],['ccPending','pending']])
   $(id).textContent=data.summary?.[key]??0;
 $('ccExceptions').textContent=(data.summary?.failed||0)+(data.summary?.returned||0);
 const raw=data.raw;
 const status=$('ccRawStatus');
 status.replaceChildren();
 if(!raw){
   status.append(el('b','원본 엑셀 없음'),el('span','현재 배송일에 센터 공용 원본이 업로드되지 않았습니다.'));
 }else{
   const descriptions={uploaded:'원본 업로드 완료 · 행 분석 필요',parsed:'원본 행 저장 완료 · 컬럼 라벨 확인 필요',analyzed:'컬럼 분석 완료 · 라벨 저장 필요',labeled:'운송장 조회 준비 완료',parse_error:'원본 읽기 실패'};
   status.append(el('b',raw.name));
   const items=[
     '상태: '+(descriptions[raw.status]||raw.status),
     '원본 데이터: '+raw.data_rows+'행 · 색인 운송장: '+raw.indexed_waybills+'건',
     raw.parse_error?'오류: '+raw.parse_error:''
   ].filter(Boolean);
   status.append(el('span',items.join(' / ')));
 }
 const members=$('ccMembers');members.replaceChildren();
 const driverSelect=$('ccDriverFilter');const prior=driverSelect.value;
 driverSelect.replaceChildren();const all=el('option','전체 기사');all.value='';driverSelect.append(all);
 for(const m of data.members||[]){
   const row=el('tr');cell(row,m.label+(m.role==='owner'?' · 생성자':''));cell(row,m.total,'num');cell(row,m.done,'num');cell(row,m.pending,'num');members.append(row);
   const opt=el('option',m.label);opt.value=m.id;driverSelect.append(opt);
 }
 if(!data.members?.length)blankRow(members,'센터에 소속된 기사가 없습니다.',4);
 if([...driverSelect.options].some(x=>x.value===prior))driverSelect.value=prior;
}
async function reloadShipments(){
 if(!app.center)return;
 const seq=app.sequence;
 const query=new URLSearchParams({
   date:app.date,
   page:String(app.page),
   status:$('ccStatusFilter').value,
   user_id:$('ccDriverFilter').value,
   q:$('ccSearch').value.trim()
 });
 blankRow($('ccShipments'),'배송 물품을 조회하고 있습니다.');
 try{
   const data=await API.request('centers/'+encodeURIComponent(app.center)+'/shipments?'+query);
   if(seq!==app.sequence)return;
   app.total=data.total;app.shipments=data.shipments||[];
   drawShipments();
 }catch(error){
   if(seq!==app.sequence)return;
   blankRow($('ccShipments'),'물품 조회 실패: '+error.message);
   $('ccPageInfo').textContent='조회 오류';
 }
}
function drawShipments(){
 const body=$('ccShipments');body.replaceChildren();
 for(const item of app.shipments){
   const tr=el('tr');
   cell(tr,item.waybill||'번호 없음');
   const address=cell(tr);
   const strong=el('div',item.company||'이름 없음');strong.style.fontWeight='750';
   const small=el('div',item.address||'주소 확인 필요');small.className='muted';small.style.fontSize='11px';address.append(strong,small);
   cell(tr,item.driver_label);cell(tr,item.round_no+'회차');
   const stat=cell(tr);const badge=el('span',statusText(item.status));badge.className='pill '+item.status;stat.append(badge);
   const action=cell(tr);
   const button=el('button','배정 변경');button.type='button';button.className='ghost';
   button.disabled=item.status==='done'||Boolean(item.started_at);
   button.title=button.disabled?'배송 완료·운행 중 물품은 배정 변경 불가':'기사 또는 회차 이동';
   button.addEventListener('click',()=>openAssignment(item));
   action.append(button);body.append(tr);
 }
 if(!app.shipments.length)blankRow(body,'조건에 맞는 배송 물품이 없습니다.');
 const count=app.total,per=50,from=count?((app.page-1)*per)+1:0,to=Math.min(count,app.page*per);
 $('ccPageInfo').textContent=count?from+'–'+to+' / 전체 '+count+'건':'0건';
 $('ccPrev').disabled=app.page<=1;$('ccNext').disabled=app.page*per>=count;
}
function openAssignment(item){
 if(!app.dashboard)return;
 app.active=item;
 $('ccAssignInfo').textContent=(item.waybill||'운송장번호 없음')+' · '+(item.company||'수화주 없음')+' · 현재 '+item.driver_label+' / '+item.round_no+'회차';
 const select=$('ccAssignDriver');select.replaceChildren();
 for(const member of app.dashboard.members||[]){
   const option=el('option',member.label+(member.role==='owner'?' · 생성자':''));option.value=member.id;select.append(option);
 }
 select.value=item.user_id;
 $('ccAssignRound').value=String(item.round_no);
 $('ccAssignDialog').showModal();
}
async function assign(event){
 event.preventDefault();
 if(!app.active||app.busy)return;
 const item=app.active;
 const target_user_id=$('ccAssignDriver').value;
 const target_round_no=Number($('ccAssignRound').value);
 if(!Number.isInteger(target_round_no)||target_round_no<1||target_round_no>1000){note('회차는 1~1000 사이의 정수여야 합니다.',true);return;}
 if(target_user_id===item.user_id&&target_round_no===item.round_no){note('기사 또는 회차를 변경하세요.',true);return;}
 if(!confirm('선택한 물품의 담당 기사/회차를 변경할까요?'))return;
 const button=$('ccConfirmAssign');button.disabled=true;
 try{
   await API.request('centers/'+encodeURIComponent(app.center)+'/shipments/'+encodeURIComponent(item.id)+'/assign',{
     method:'POST',body:{target_user_id,target_round_no,expected_revision:item.round_revision}
   });
   $('ccAssignDialog').close();app.active=null;
   await reloadAll();
   note('물품 배정을 변경했습니다. 변경 내용은 기사 배송 목록에 반영됩니다.');
 }catch(error){
   note(error.message||'배정 변경 실패',true);
 }finally{button.disabled=false;}
}
async function init(){
 $('ccDate').value=isoLocal();app.date=$('ccDate').value;
 $('ccWorkspace').hidden=true;
 try{
   await API.me();
   const response=await API.centers();
   app.centers=(response.centers||[]).filter(c=>c.role==='owner');
   const select=$('ccCenter');select.replaceChildren();
   for(const center of app.centers){const option=el('option',center.name);option.value=center.id;select.append(option);}
   if(!app.centers.length){
     $('ccWorkspace').hidden=true;
     note('관리할 센터가 없습니다. DSD 기사 화면의 설정에서 센터를 생성한 뒤 다시 들어오세요.');
     return;
   }
   const selected=API.centerId();
   app.center=app.centers.some(c=>c.id===selected)?selected:app.centers[0].id;
   select.value=app.center;
   API.setCenterId(app.center);
   bind();
   await reloadAll();
 }catch(error){
   note('관리콘솔에 접속하지 못했습니다. 기사 화면에서 로그인한 뒤 센터 관리콘솔을 열어주세요. '+error.message,true);
 }
}
function bind(){
 $('ccCenter').addEventListener('change',()=>{
   app.center=$('ccCenter').value;API.setCenterId(app.center);app.page=1;
   $('ccDriverFilter').value='';$('ccSearch').value='';reloadAll();
 });
 $('ccDate').addEventListener('change',()=>{
   app.date=$('ccDate').value;app.page=1;$('ccSearch').value='';reloadAll();
 });
 $('ccRefresh').addEventListener('click',reloadAll);
 $('ccRawRefresh').addEventListener('click',reloadAll);
 $('ccDaesin').addEventListener('click',()=>{
   if(!window.DSDDaesinImports){note('대신택배 업로드 모듈을 불러오지 못했습니다.',true);return;}
   window.DSDDaesinImports.open(app.date).catch(e=>note(e.message,true));
 });
 $('ccGeneric').addEventListener('click',()=>{
   if(!window.DSDRawImports){note('기타 업체 업로드 모듈을 불러오지 못했습니다.',true);return;}
   window.DSDRawImports.open(app.date,'generic').catch(e=>note(e.message,true));
 });
 $('ccSearch').addEventListener('input',()=>{
   clearTimeout(app.searchTimer);
   app.searchTimer=setTimeout(()=>{app.page=1;reloadShipments();},320);
 });
 for(const id of ['ccStatusFilter','ccDriverFilter'])$(id).addEventListener('change',()=>{
   app.page=1;reloadShipments();
 });
 $('ccPrev').addEventListener('click',()=>{if(app.page>1){app.page--;reloadShipments();}});
 $('ccNext').addEventListener('click',()=>{if(app.page*50<app.total){app.page++;reloadShipments();}});
 $('ccAssignForm').addEventListener('submit',assign);
 $('ccCancelAssign').addEventListener('click',()=>$('ccAssignDialog').close());
 $('ccAssignDialog').addEventListener('close',()=>{app.active=null;});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&app.center)reloadAll();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
})();