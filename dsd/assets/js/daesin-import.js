/* DSD - Daesin Freight dedicated manifest form. Uses the existing raw-import API. */
(function(){
'use strict';
const API=window.DSD_API;
const $=id=>document.getElementById(id);
const node=(tag,value)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=String(value??'');return e;};
const FIELDS=[
 {key:'waybill',title:'운송장번호',required:true,aliases:['운송장정보','운송장번호','송장번호','운송장']},
 {key:'recipient_name',title:'받는 분 (수화주)',required:true,aliases:['수화주','수하주','수하인','수취인','받는분']},
 {key:'recipient_address',title:'배송지 주소',required:true,aliases:['도로명주소','수화주도로명주소','수취인도로명주소','받는분도로명주소','지번주소','수화주지번주소','수취인주소','받는분주소','배송주소','주소']},
 {key:'sender_name',title:'보내는 분 (발화주)',aliases:['발화주','보내는분','송하인','발송인']},
 {key:'item_name',title:'품명',aliases:['품명','물품명','화물명']},
 {key:'quantity',title:'수량',aliases:['수량','박스수','화물수량']},
 {key:'memo',title:'특기사항',aliases:['특기사항','배송메모','배송요청사항','배달요청사항']},
 {key:'recipient_phone',title:'받는 분 연락처',aliases:['수화주전화','수취인전화','받는분전화','수하인전화번호','수화주연락처']}
];
const S={date:'',id:'',data:null,sheetIndex:0,busy:false,choices:{},dialog:null};
const normalize=s=>String(s??'').toLowerCase().replace(/[^가-힣a-z0-9]/g,'');
const req=(path,opts)=>API.request(path,opts||{});
function message(text,bad=false){
 const e=$('daesinMsg');
 if(!e)return;
 e.textContent=text;e.style.color=bad?'#b42332':'#14704f';
}
function chooseColumn(columns,def,used){
 const keys=def.aliases.map(normalize);
 let found=columns.find(c=>!used.has(c.column_index)&&keys.includes(normalize(c.header_text)));
 if(!found&&def.key==='recipient_address'){
   found=columns.find(c=>!used.has(c.column_index)&&
     /도로명주소|지번주소|배송주소|수취인주소|수화주주소|받는분주소/.test(normalize(c.header_text))&&
     !/발송|발화주|보내는|송하인/.test(normalize(c.header_text)));
 }
 if(!found&&def.key==='waybill'){
   found=columns.find(c=>!used.has(c.column_index)&&/운송장|송장번호/.test(normalize(c.header_text)));
 }
 return found?found.column_index:-1;
}
function choicesFor(sheet){
 const columns=sheet?.columns||[],used=new Set(),result={};
 for(const def of FIELDS){
   const index=chooseColumn(columns,def,used);
   result[def.key]=index;
   if(index>=0)used.add(index);
 }
 return result;
}
function currentSheet(){return S.data?.sheets?.[S.sheetIndex]||null;}
async function work(task){
 if(S.busy)return;
 S.busy=true;
 for(const id of ['daesinUpload','daesinLoad','daesinSave','daesinReparse'])if($(id))$(id).disabled=true;
 try{await task();}
 catch(e){message(e?.message||'처리 중 오류가 발생했습니다.',true);}
 finally{
   S.busy=false;
   for(const id of ['daesinUpload','daesinLoad','daesinSave','daesinReparse'])if($(id))$(id).disabled=false;
   if($('daesinSave'))$('daesinSave').disabled=!currentSheet();
 }
}
function setup(){
 const style=node('style');
 style.textContent='.daesin-dlg{width:min(740px,96vw);max-width:96vw;max-height:92vh;overflow-y:auto;border:1px solid #cbd8e5;border-radius:17px;padding:20px;background:#fbfdff;color:#203346}.daesin-dlg::backdrop{background:#0b1828ab}.daesin-dlg h2{font-size:19px;margin:0}.daesin-dlg p{font-size:13px;line-height:1.6;margin:8px 0}.daesin-dlg .daesin-row{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin:12px 0}.daesin-dlg label{font-weight:800;font-size:12px}.daesin-dlg input,.daesin-dlg select{max-width:100%;min-height:37px;padding:7px;border:1px solid #b9c9d9;border-radius:8px;background:#fff}.daesin-dlg input[type=file]{max-width:100%;flex:1 1 270px}.daesin-dlg button{border:1px solid #b9c9d9;border-radius:9px;padding:9px 13px;background:#eef4fa;color:#213b58;font-weight:800;cursor:pointer}.daesin-dlg button.daesin-primary{background:#186b82;color:#fff;border-color:#186b82}.daesin-dlg button:disabled{opacity:.48;cursor:default}.daesin-dlg .daesin-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.daesin-dlg .daesin-field{background:#fff;border:1px solid #dbe5ed;padding:11px;border-radius:10px;min-width:0}.daesin-dlg .daesin-field select{width:100%;margin-top:7px}.daesin-dlg .daesin-field.is-missing{border-color:#d87979;background:#fff8f8}.daesin-dlg .daesin-info{background:#eef5fc;border-radius:10px;padding:10px 12px}.daesin-dlg .daesin-preview{overflow:auto;max-height:260px}.daesin-dlg table{border-collapse:collapse;width:100%;min-width:580px;font-size:12px}.daesin-dlg th,.daesin-dlg td{padding:8px;border-bottom:1px solid #e5ebf2;text-align:left;vertical-align:top;overflow-wrap:anywhere}.daesin-dlg th{position:sticky;top:0;background:#edf2f8}.daesin-dlg #daesinMsg{min-height:21px}.daesin-dlg details{margin:10px 0;font-size:12px}.daesin-dlg summary{cursor:pointer;font-weight:750}.daesin-dlg .daesin-muted{color:#62788c}@media(max-width:600px){.daesin-dlg{padding:13px}.daesin-dlg .daesin-fields{grid-template-columns:1fr}}';
 document.head.append(style);
 const dlg=node('dialog');dlg.className='daesin-dlg';
 dlg.innerHTML='<div class="daesin-row"><h2>대신택배 · 원본 엑셀 등록</h2><button type="button" id="daesinClose">닫기</button></div><p>대신택배 전용 양식입니다. 별도 컬럼 분석 없이 운송장정보·수화주·주소 등을 고정된 항목에 연결합니다. 원본 전체는 그대로 보관합니다.</p><div class="daesin-row"><label>배송일 <strong id="daesinDate"></strong></label></div><div class="daesin-row"><input type="file" id="daesinFile" accept=".xls,.xlsx,.xlsm,.csv"><button type="button" class="daesin-primary" id="daesinUpload">파일 업로드 · 읽기</button></div><div class="daesin-row"><label for="daesinSaved">기존 업로드</label><select id="daesinSaved"></select><button type="button" id="daesinLoad">불러오기</button><button type="button" id="daesinReparse">다시 읽기</button></div><p id="daesinMsg" role="status"></p><div id="daesinMain"></div><div class="daesin-row"><button type="button" id="daesinSave" class="daesin-primary" disabled>대신택배 배송정보 저장</button></div>';
 document.body.append(dlg);S.dialog=dlg;
 $('daesinClose').onclick=()=>dlg.close();
 $('daesinUpload').onclick=()=>work(upload);
 $('daesinLoad').onclick=()=>work(()=>load($('daesinSaved').value));
 $('daesinReparse').onclick=()=>work(async()=>{
   if(!S.id){message('저장된 원본을 먼저 선택하세요.',true);return;}
   const result=await req('raw-imports/'+encodeURIComponent(S.id)+'/parse',{method:'POST',body:{}});
   S.data=result.import;resetChoices();render();message('원본을 다시 읽었습니다.');
 });
 $('daesinSave').onclick=()=>work(save);
}
async function refresh(preferred){
 const out=await req('raw-imports?date='+encodeURIComponent(S.date)+(API.centerId()?'&center_id='+encodeURIComponent(API.centerId()):''));
 const select=$('daesinSaved');select.replaceChildren();
 for(const item of out.imports||[]){
   const opt=node('option',(item.original_name||'원본 파일')+' · '+item.status);opt.value=item.id;select.append(opt);
 }
 if(!select.options.length){S.data=null;S.id='';render();message('저장된 원본이 없습니다. 대신택배 엑셀 파일을 선택하세요.');return;}
 if(preferred&&[...select.options].some(x=>x.value===preferred))select.value=preferred;
 await load(select.value);
}
async function load(id){
 if(!id)return;
 const data=await req('raw-imports/'+encodeURIComponent(id));
 S.id=id;S.data=data.import;
 const index=(S.data.sheets||[]).findIndex(sh=>{
   const h=sh.columns.map(c=>normalize(c.header_text));
   return h.includes('운송장정보')&&h.includes('수화주');
 });
 S.sheetIndex=index>=0?index:0;
 resetChoices();render();
}
function resetChoices(){S.choices=choicesFor(currentSheet());}
async function upload(){
 const file=$('daesinFile').files[0];
 if(!file){message('대신택배 엑셀 파일을 선택하세요.',true);return;}
 if(!/\.(xls|xlsx|xlsm|csv)$/i.test(file.name)){message('XLS, XLSX, XLSM 또는 CSV 파일만 선택할 수 있습니다.',true);return;}
 const fd=new FormData();fd.set('file',file);fd.set('date',S.date);if(API.centerId())fd.set('center_id',API.centerId());
 const out=await req('raw-imports',{method:'POST',body:fd,file:true});
 try{await req('raw-imports/'+encodeURIComponent(out.import_id)+'/parse',{method:'POST',body:{}});}
 catch(e){await refresh(out.import_id);throw Error('원본은 보관됐지만 읽기에 실패했습니다: '+e.message);}
 $('daesinFile').value='';
 await refresh(out.import_id);
 message('원본 파일을 읽었습니다. 자동 지정된 배송정보를 확인하고 저장하세요.');
}
function render(){
 const root=$('daesinMain');root.replaceChildren();
 const sh=currentSheet();$('daesinSave').disabled=!sh;
 if(!S.data){root.append(node('p','원본을 업로드하거나 기존 파일을 불러오세요.'));return;}
 if(!sh){root.append(node('p','원본을 아직 읽지 못했습니다. 다시 읽기를 눌러 보세요.'));if(S.data.parse_error)root.append(node('p',S.data.parse_error));return;}
 const header=node('p',sh.sheet_name+' · 원본 '+Math.max(0,sh.row_count-sh.header_row)+'건 · '+sh.column_count+'개 컬럼 · 제목 행 '+sh.header_row);
 header.className='daesin-info';root.append(header);
 const note=node('p','운송장번호, 받는 분, 배송지 주소가 필수입니다. 값이 없는 행은 바코드 조회 시 주소 확인이 필요할 수 있습니다.');
 note.className='daesin-muted';root.append(note);
 const grid=node('div');grid.className='daesin-fields';
 for(const def of FIELDS){
   const block=node('div');block.className='daesin-field';
   const label=node('label',def.title+(def.required?' *':''));label.htmlFor='daesin-field-'+def.key;
   const select=node('select');select.id='daesin-field-'+def.key;select.dataset.role=def.key;
   const blank=node('option','해당 항목 없음');blank.value='-1';select.append(blank);
   for(const col of sh.columns){
     const opt=node('option',(col.column_index+1)+'열 · '+(col.header_text||'(제목 없음)'));
     opt.value=String(col.column_index);select.append(opt);
   }
   select.value=String(S.choices[def.key]??-1);
   select.onchange=()=>{S.choices[def.key]=Number(select.value);block.classList.toggle('is-missing',!!def.required&&Number(select.value)<0);};
   if(def.required&&S.choices[def.key]<0)block.classList.add('is-missing');
   block.append(label,select);grid.append(block);
 }
 root.append(grid);
 const used=new Set(Object.values(S.choices).filter(v=>v>=0));
 const others=sh.columns.filter(c=>!used.has(c.column_index));
 const detail=node('details');const summary=node('summary','나머지 원본 '+others.length+'개 컬럼 보관 (분류 누락 없이 보존)');
 detail.append(summary);
 const ul=node('ul');
 for(const col of others)ul.append(node('li',(col.column_index+1)+'열 · '+(col.header_text||'(제목 없음)')+' → 원본 보관'));
 detail.append(ul);root.append(detail);
 const caption=node('p','실제 원본 미리보기 · 처음 5건');caption.style.fontWeight='800';root.append(caption);
 const scroll=node('div');scroll.className='daesin-preview';
 const table=node('table'),thead=node('thead'),tr=node('tr');
 for(const t of ['운송장번호','수화주','배송주소','품명','수량'])tr.append(node('th',t));
 thead.append(tr);table.append(thead);
 const tbody=node('tbody');
 for(const row of sh.preview_rows||[]){
   const t=node('tr');
   for(const role of ['waybill','recipient_name','recipient_address','item_name','quantity']){
     const col=S.choices[role],value=col>=0?row.cells?.[col]:'';
     t.append(node('td',value||'—'));
   }
   tbody.append(t);
 }
 table.append(tbody);scroll.append(table);root.append(scroll);
 const review=node('p','유의: 배송 주소가 두 컬럼(도로명/지번)으로 제공되면 현재는 선택한 한 컬럼으로 바코드 조회합니다. 다른 주소열도 원본에 보존됩니다.');
 review.className='daesin-muted';root.append(review);
}
async function save(){
 const sh=currentSheet();if(!sh){message('원본을 먼저 읽어주세요.',true);return;}
 const roles={};const used=new Set();
 for(const def of FIELDS){
   const select=$('daesin-field-'+def.key);
   const i=Number(select?.value??-1);
   if(def.required&&i<0){message(def.title+' 컬럼을 선택해야 합니다.',true);return;}
   if(i>=0&&used.has(i)){message('한 원본 컬럼을 여러 항목에 중복 지정할 수 없습니다.',true);return;}
   if(i>=0){roles[i]=def.key;used.add(i);}
 }
 if(!sh.preview_rows?.length){message('저장할 배송 데이터가 없습니다.',true);return;}
 const columns=sh.columns.map(c=>({
   sheet_id:sh.id,column_index:c.column_index,label:roles[c.column_index]||'other'
 }));
 const result=await req('raw-imports/'+encodeURIComponent(S.id)+'/labels',{method:'POST',body:{columns}});
 S.data=result.import;
 S.choices=choicesFor(currentSheet());
 render();
 message('대신택배 전용 양식 저장 완료. 운송장번호로 조회할 수 있습니다. 배송일과 주소 누락 여부를 확인해 주세요.');
}
async function open(date){
 if(!S.dialog)setup();
 S.date=/^\d{4}-\d{2}-\d{2}$/.test(date||'')?date:new Date().toLocaleDateString('sv-SE');
 $('daesinDate').textContent=S.date;
 if(!S.dialog.open)S.dialog.showModal();
 message('');
 await work(()=>refresh());
}
window.DSDDaesinImports={open};
})();