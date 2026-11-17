/* DSD raw Excel upload / column labeling. Does not alter delivery rounds. */
(function(){
'use strict';
const API=window.DSD_API;
const LABELS={unclassified:'미분류',waybill:'운송장번호',recipient_name:'받는 분 이름',recipient_phone:'받는 분 연락처',recipient_address:'받는 분 주소',recipient_detail:'받는 분 상세주소',sender_name:'보내는 분 이름',sender_phone:'보내는 분 연락처',sender_address:'보내는 분 주소',company:'업체명',item_name:'품명',quantity:'수량',freight_amount:'운임 금액',freight_payment_type:'운임 결제 구분 (선불/착불)',cod_amount:'착불금액 (기존)',payment_type:'결제구분 (기존)',memo:'배송메모',other:'기타'};

/* Company-specific review presets. Raw bytes and original fields remain unchanged. */
const COMPANY_NAMES={generic:'일반 / 기타 업체',daesin:'대신택배'};
const DAESIN_LABELS={
 '운송장정보':'waybill','운송장번호':'waybill',
 '발화주':'sender_name','수화주':'recipient_name',
 '품명':'item_name','수량':'quantity','특기사항':'memo',
 '일자':'other','발송지':'other','포장':'other','상품':'other',
 '상태':'other','배송상태':'other','출고제비용':'other',
 '도착제비용':'other','착불운임':'other','운임':'other','합계':'other'
};
const headerKey=value=>String(value??'').trim().toLowerCase().replace(/[^가-힣a-z0-9]/g,'');
function companyMapping(sheet){
 const columns=sheet?.columns||[], fields=new Map();
 if(S.profile!=='daesin')return {valid:false,fields};
 const headers=new Map(columns.map(c=>[headerKey(c.header_text),c.column_index]));
 const valid=['운송장정보','발화주','수화주'].every(k=>headers.has(k))&&
   (headers.has('도로명주소')||headers.has('지번주소'));
 if(!valid)return {valid:false,fields};
 for(const c of columns){const label=DAESIN_LABELS[headerKey(c.header_text)];if(label)fields.set(c.column_index,label);}
 const road=headers.get('도로명주소'),jibun=headers.get('지번주소');
 if(road!==undefined){fields.set(road,'recipient_address');if(jibun!==undefined)fields.set(jibun,'other');}
 else if(jibun!==undefined)fields.set(jibun,'recipient_address');
 return {valid:true,fields,hasBothAddresses:road!==undefined&&jibun!==undefined};
}

const S={date:'',id:'',data:null,sheet:0,page:0,busy:false,profile:'generic'};
const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text??'');return e;};
const $=id=>document.getElementById(id);
const bt=(text,fn)=>{const e=el('button',text);e.type='button';e.onclick=fn;return e;};
let dialog;
function msg(text,bad=false){$('rawMsg').textContent=text;$('rawMsg').style.color=bad?'#a12637':'#17644b';}
async function run(fn){if(S.busy)return;S.busy=true;$('rawBusy').textContent='처리 중…';try{return await fn();}catch(e){msg(e.message||'요청 실패',true);}finally{S.busy=false;$('rawBusy').textContent='';}}
const req=(path,opt)=>API.request(path,opt||{});
function init(){
 const style=el('style');style.textContent='.raw-dlg{width:min(1040px,96vw);max-width:96vw;max-height:93vh;overflow:auto;box-sizing:border-box;padding:18px;border-radius:14px;border:1px solid #a6b7c6;background:#f8fafc;color:#223448}.raw-dlg::backdrop{background:#0b1828ab}.raw-dlg h2{font-size:19px;margin:0}.raw-dlg p{font-size:13px}.raw-dlg .bar{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin:11px 0}.raw-dlg button{padding:8px 12px;border-radius:7px;border:1px solid #a8b7c3;background:#eaf0f5;color:#243649;cursor:pointer}.raw-dlg button.primary{background:#175c6d;color:white;border-color:#175c6d}.raw-dlg select,.raw-dlg input[type=number]{padding:7px;background:white;color:#203346;border:1px solid #afbecb;border-radius:6px}.raw-dlg .wrap{overflow:auto;max-height:370px;border:1px solid #dae0e8;border-radius:8px}.raw-dlg table{border-collapse:collapse;font-size:12px;width:100%}.raw-dlg th,.raw-dlg td{min-width:90px;padding:8px;border-bottom:1px solid #dce3eb;vertical-align:top;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}.raw-dlg th{position:sticky;top:0;background:#eaf0f5}.raw-dlg .labelpick{min-width:160px}.raw-dlg .sample{max-width:260px}.raw-dlg #rawMsg{min-height:18px}.raw-dlg #rawSaved{max-width:95vw}@media(max-width:600px){.raw-dlg{max-width:100vw;width:100vw;padding:12px}}';
 document.head.append(style);dialog=el('dialog');dialog.className='raw-dlg';
 dialog.innerHTML='<div class="bar"><h2>원본 엑셀 · 업체별 컬럼 분석</h2><button type="button" id="rawClose">닫기</button></div><p>전체 시트·행·열을 먼저 저장합니다. 라벨 분석과 확정은 나중에 수행하며 기존 회차는 변경하지 않습니다.</p><div class="bar"><label for="rawProfile">업체 형식</label><select id="rawProfile"><option value="daesin">대신택배</option><option value="generic">일반 / 기타 업체 (자동 분석)</option></select></div><div class="bar"><input type="file" id="rawFile" accept=".xlsx,.xlsm,.xls,.csv"><button type="button" id="rawUpload" class="primary">원본 저장</button></div><div class="bar"><span>저장된 파일</span><select id="rawSaved"></select><button type="button" id="rawParse">원본 행 저장</button><button type="button" id="rawAnalyze" class="primary">컬럼 분석</button><span id="rawBusy"></span></div><p id="rawMsg" role="status"></p><div id="rawMain"></div>';
 document.body.append(dialog);
 $('rawClose').onclick=()=>dialog.close();
 $('rawUpload').onclick=()=>run(upload);
 $('rawParse').onclick=()=>run(parse);
 $('rawAnalyze').onclick=()=>run(analyze);
 $('rawSaved').onchange=()=>run(()=>load($('rawSaved').value));
  $('rawProfile').onchange=()=>{S.profile=$('rawProfile').value;render();msg(COMPANY_NAMES[S.profile]+' 형식 선택 완료. 제안된 라벨을 확인하고 저장하세요.');};
}
async function open(date,profile='generic'){
 if(!dialog)init();
 S.date=/^\d{4}-\d{2}-\d{2}$/.test(date||'')?date:new Date().toLocaleDateString('sv-SE');
 S.profile=Object.prototype.hasOwnProperty.call(COMPANY_NAMES,profile)?profile:'generic';
 $('rawProfile').value=S.profile;
 if(!dialog.open)dialog.showModal();
 msg('');
 await run(()=>refresh());
}
async function refresh(prefer){
 const r=await req('raw-imports?date='+encodeURIComponent(S.date));
 const sel=$('rawSaved');sel.replaceChildren();
 for(const item of r.imports||[]){const x=el('option',item.original_name+' / '+item.status);x.value=item.id;sel.append(x);}
 if(!sel.options.length){sel.append(el('option','저장된 파일 없음'));S.data=null;S.id='';render();return;}
 if(prefer&&Array.from(sel.options).some(x=>x.value===prefer))sel.value=prefer;
 await load(sel.value);
}
async function upload(){
 const file=$('rawFile').files[0];if(!file){msg('파일을 선택하세요.',true);return;}
 const body=new FormData();body.set('file',file);body.set('date',S.date);
 const r=await req('raw-imports',{method:'POST',body,file:true});
 msg('원본 저장 완료. 원본 행을 분석합니다.');$('rawFile').value='';
 try{await req('raw-imports/'+encodeURIComponent(r.import_id)+'/parse',{method:'POST',body:{}});}
 catch(e){msg('원본은 저장됐지만 행 분석에 실패했습니다: '+e.message,true);}
 S.sheet=0;await refresh(r.import_id);
}
async function load(id){
 if(!id)return;
 const r=await req('raw-imports/'+encodeURIComponent(id));
 S.id=id;S.data=r.import;S.sheet=Math.min(S.sheet,Math.max(0,(S.data.sheets||[]).length-1));S.page=0;render();
}
async function parse(){
 if(!S.id)return;
 const r=await req('raw-imports/'+encodeURIComponent(S.id)+'/parse',{method:'POST',body:{}});
 S.data=r.import;render();msg('전체 컬럼과 행을 저장했습니다.');
}
async function analyze(){
 if(!S.id)return;
 const r=await req('raw-imports/'+encodeURIComponent(S.id)+'/analyze',{method:'POST',body:{}});
 S.data=r.import;render();msg('컬럼 추천 완료. 확인 후 라벨을 저장하세요.');
}
function sheet(){return S.data?.sheets?.[S.sheet];}
async function setHeader(n){
 const r=await req('raw-imports/'+encodeURIComponent(S.id)+'/header',{method:'POST',body:{sheet_id:sheet().id,header_row:Number(n)}});
 S.data=r.import;render();msg('제목 행을 변경했습니다.');
}
async function save(){
 const cells=Array.from($('rawMain').querySelectorAll('select[data-col]')).map(x=>({sheet_id:sheet().id,column_index:Number(x.dataset.col),label:x.value}));
 const r=await req('raw-imports/'+encodeURIComponent(S.id)+'/labels',{method:'POST',body:{columns:cells}});
 S.data=r.import;render();msg('컬럼 라벨 저장 완료.');
}
function render(){
 const root=$('rawMain');root.replaceChildren();
 $('rawParse').disabled=!S.id;$('rawAnalyze').disabled=!S.data||!['parsed','analyzed','labeled'].includes(S.data.status);
 if(!S.data){root.append(el('p','원본 엑셀을 업로드하세요.'));return;}
 root.append(el('p',S.data.original_name+' · 상태 '+S.data.status));
 root.append(bt('원본 다운로드',()=>API.download('raw-imports/'+encodeURIComponent(S.id)+'/file',S.data.original_name).catch(e=>msg(e.message,true))));
 if(S.data.parse_error)root.append(el('p','분석 오류: '+S.data.parse_error));
 if(!S.data.sheets?.length){root.append(el('p','원본 행 저장을 누르면 컬럼을 확인할 수 있습니다.'));return;}
 const toolbar=el('div');toolbar.className='bar';toolbar.append(el('strong','시트'));
 const choose=el('select');
 S.data.sheets.forEach((s,i)=>{const o=el('option',s.sheet_name+' ('+s.row_count+'행, '+s.column_count+'열)');o.value=i;choose.append(o);});
 choose.value=S.sheet;choose.onchange=()=>{S.sheet=Number(choose.value);S.page=0;render();};toolbar.append(choose);
 const sh=sheet();toolbar.append(el('span','제목 행'));
 const rowNum=el('input');rowNum.type='number';rowNum.min=1;rowNum.max=sh.row_count;rowNum.value=sh.header_row;rowNum.style.width='72px';
 toolbar.append(rowNum,bt('제목 행 변경',()=>run(()=>setHeader(rowNum.value))));root.append(toolbar);
 const profile=companyMapping(sh);
 if(S.profile==='daesin'){
   const note=el('p',profile.valid
     ? '대신택배 형식 확인. 운송장·발화주·수화주·주소 등은 업체 규칙으로 자동 선택됩니다. 검토 후 라벨 저장하세요.'
     : '대신택배의 필수 헤더(운송장정보·발화주·수화주·주소)가 확인되지 않았습니다. 일반 형식으로 전환하거나 제목 행을 확인하세요.');
   note.style.color=profile.valid?'#17644b':'#a12637';root.append(note);
   if(profile.hasBothAddresses)root.append(el('p','도로명주소를 우선 사용합니다. 도로명주소가 빈 행의 지번주소 대체는 별도의 서버 조회 보완이 필요합니다.'));
 }
 const acts=el('div');acts.className='bar';
 acts.append(bt(profile.valid?'대신택배 규칙 다시 적용':'추천 라벨 적용',()=>{
   for(const c of sh.columns||[]){
     if(c.reviewed&&!profile.valid)continue;
     const choice=profile.valid?profile.fields.get(c.column_index):(c.confidence>=.8&&c.suggested_label!=='unclassified'?c.suggested_label:null);
     if(choice){const select=root.querySelector('select[data-col="'+c.column_index+'"]');if(select)select.value=choice;}
   }
 }));
 const saver=bt('라벨 저장',()=>run(save));saver.className='primary';acts.append(saver);root.append(acts);
 const wrap=el('div');wrap.className='wrap';const table=el('table');const thead=el('thead'),h=el('tr');
 ['열','원본 컬럼명','데이터 예시','추천 라벨','최종 라벨','판단 근거'].forEach(t=>h.append(el('th',t)));thead.append(h);table.append(thead);
 const body=el('tbody');
 for(const col of sh.columns||[]){
  const tr=el('tr');
  tr.append(el('td',col.column_index+1),el('td',col.header_text||'(빈 제목)'));
  const ex=el('td',(col.examples||[]).join(' / '));ex.className='sample';tr.append(ex);
  tr.append(el('td',(LABELS[col.suggested_label]||'미분류')+(col.confidence?' · 판단점수 '+Math.round(100*col.confidence)+'/100':'')));
  const s=el('select');s.className='labelpick';s.dataset.col=col.column_index;
  let freightGroup=null;
  for(const [key,label] of Object.entries(LABELS)){
   const o=el('option',label);o.value=key;
   if(key==='freight_amount'||key==='freight_payment_type'){
    if(!freightGroup){freightGroup=el('optgroup');freightGroup.label='운임';s.append(freightGroup);}
    freightGroup.append(o);
   }else{s.append(o);}
  }
  s.value=profile.valid?(profile.fields.get(col.column_index)||(col.reviewed?col.assigned_label:'unclassified')):(col.reviewed?col.assigned_label:'unclassified');const td=el('td');td.append(s);tr.append(td);const why=el('td',col.basis||'판단 근거 없음');why.style.maxWidth='350px';tr.append(why);body.append(tr);
 }
 table.append(body);wrap.append(table);root.append(wrap);
 const preview=el('div');preview.className='bar';preview.append(el('strong','원본 데이터 미리보기'));
 preview.append(bt('전체 행 조회',()=>run(async()=>{S.page=1;await showRows();})));root.append(preview);
 const holder=el('div');holder.id='rawRows';root.append(holder);showRows().catch(e=>msg(e.message,true));
}
async function showRows(){
 const holder=$('rawRows');if(!holder)return;holder.replaceChildren();
 const sh=sheet();let rows=sh.preview_rows||[];
 if(S.page>0){
  const r=await req('raw-imports/'+encodeURIComponent(S.id)+'/rows?sheet_id='+encodeURIComponent(sh.id)+'&offset='+(S.page-1)*30+'&limit=30');
  rows=r.rows||[];
  const nav=el('div');nav.className='bar';
  const prev=bt('이전',()=>run(async()=>{S.page=Math.max(1,S.page-1);await showRows();}));prev.disabled=S.page===1;
  const next=bt('다음',()=>run(async()=>{S.page++;await showRows();}));next.disabled=rows.length<30;
  nav.append(prev,el('span',S.page+'페이지'),next);holder.append(nav);
 }
 const div=el('div');div.className='wrap';const tbl=el('table');const th=el('thead'),tr=el('tr');tr.append(el('th','#'));
 for(let i=0;i<sh.column_count;i++)tr.append(el('th',(sh.columns[i]?.header_text||'')+' ['+(i+1)+']'));
 th.append(tr);tbl.append(th);const body=el('tbody');
 for(const r of rows){const t=el('tr');t.append(el('td',r.row_no));for(const v of r.cells||[])t.append(el('td',v));body.append(t);}
 tbl.append(body);div.append(tbl);holder.append(div);
}
window.DSDRawImports={open};
})();