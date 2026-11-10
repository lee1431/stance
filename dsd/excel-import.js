/* DSD Excel import. Files are parsed in the browser; the workbook is never uploaded. */
(function(root){
  'use strict';
  const $=id=>document.getElementById(id);
  const MAX_BYTES=10*1024*1024,MAX_ROWS=500;
  const XLSX_URL='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  const FIELD_IDS=['excelAddressCol','excelNameCol','excelDetailCol','excelWaybillCol','excelQtyCol'];
  const labels={
    excelAddressCol:['수취인주소','받는분주소','받는사람주소','수령인주소','수하인주소','배송주소','도착지주소','배달주소','주소','address','roadaddress'],
    excelNameCol:['수취인명','수취인','받는분','받는사람','수령인','수하인','고객명','성명','업체명','상호명','점포명','이름','recipient','name'],
    excelDetailCol:['상세주소','상세위치','주소상세','추가주소','detailaddress','비고','배송메모','메모'],
    excelWaybillCol:['운송장번호','송장번호','운송장','송장','trackingnumber','waybill','invoice'],
    excelQtyCol:['배송수량','수량','박스수','박스','수량합계','quantity','qty']
  };
  let options=null,workbook=null,rows=[],filename='',busy=false,cancelled=false,failures=[];
  let libraryLoading=null;
  const trim=v=>String(v==null?'':v).trim().replace(/\s+/g,' ');
  const key=v=>trim(v).toLowerCase().replace(/[\s._()\-\/\[\]:]/g,'');
  function status(message){$('excelStatus').textContent=message;}
  function loadLibrary(){
    if(root.XLSX)return Promise.resolve(root.XLSX);
    if(libraryLoading)return libraryLoading;
    libraryLoading=new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      const t=setTimeout(()=>{s.remove();reject(Error('엑셀 읽기 모듈 연결 시간이 초과됐습니다.'));},15000);
      s.src=XLSX_URL;s.async=true;
      s.onload=()=>{clearTimeout(t);root.XLSX?resolve(root.XLSX):reject(Error('엑셀 모듈 초기화에 실패했습니다.'));};
      s.onerror=()=>{clearTimeout(t);reject(Error('엑셀 모듈을 다운로드하지 못했습니다. 인터넷 연결을 확인하세요.'));};
      document.head.append(s);
    }).catch(e=>{libraryLoading=null;throw e;});
    return libraryLoading;
  }
  function sheetRows(){
    const name=$('excelSheetSelect').value;
    if(!workbook||!workbook.Sheets[name])return [];
    return root.XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:'',raw:false,blankrows:true});
  }
  function guessHeader(list){
    let best=0,score=-1;
    for(let i=0;i<Math.min(20,list.length);i++){
      const row=list[i]||[];
      const headings=row.map(key);
      const n=headings.filter(v=>v.includes('주소')||v.includes('address')).length*4+
        headings.filter(v=>/수취|받는|수령|고객|송장|invoice|tracking/.test(v)).length*2;
      if(n>score){best=i;score=n;}
    }
    return best+1;
  }
  function bestColumn(headings,id){
    const names=labels[id],keys=headings.map(key);
    for(const expected of names){
      const target=key(expected);
      const exact=keys.findIndex((v,i)=>v===target&&!(id==='excelAddressCol'&&/발송|보내는|송하인|출발|반송|상세|청구/.test(keys[i])));
      if(exact>=0)return exact;
    }
    for(const expected of names){
      const target=key(expected);
      const match=keys.findIndex(v=>v.includes(target)&&!(id==='excelAddressCol'&&/발송|보내는|송하인|출발|반송|상세|청구/.test(v)));
      if(match>=0)return match;
    }
    return -1;
  }
  function renderColumns(){
    const headerRow=Math.max(1,Number($('excelHeaderRow').value)||1);
    const headings=rows[headerRow-1]||[];
    const width=Math.max(headings.length,0,...rows.slice(headerRow,headerRow+15).map(r=>r.length));
    for(const id of FIELD_IDS){
      const select=$(id);select.replaceChildren();
      if(id!=='excelAddressCol'){const o=document.createElement('option');o.value='';o.textContent='사용 안 함';select.append(o);}
      for(let i=0;i<width;i++){
        const o=document.createElement('option');o.value=String(i);
        o.textContent=(root.XLSX.utils.encode_col(i)+'열')+' · '+(trim(headings[i])||'(제목 없음)');
        select.append(o);
      }
      const matched=bestColumn(headings,id);
      select.value=matched>=0?String(matched):'';
      if(select.selectedIndex<0)select.selectedIndex=0;
    }
    renderPreview();
  }
  function selection(id){const value=$(id).value;return value===''?-1:Number(value);}
  function buildEntries(){
    const header=Math.max(1,Number($('excelHeaderRow').value)||1);
    const addressCol=selection('excelAddressCol'),nameCol=selection('excelNameCol'),
      detailCol=selection('excelDetailCol'),waybillCol=selection('excelWaybillCol'),qtyCol=selection('excelQtyCol');
    if(addressCol<0)throw Error('배송지 주소 열을 지정하세요.');
    const entries=[],invalid=[];
    for(let i=header;i<rows.length;i++){
      const row=rows[i]||[];
      if(!row.some(v=>trim(v)))continue;
      const base=trim(row[addressCol]),detail=detailCol>=0?trim(row[detailCol]):'';
      if(!base){invalid.push({row:i+1,address:'',reason:'주소 없음'});continue;}
      const full=base+(detail&&!base.includes(detail)?' '+detail:'');
      if(full.length>250||base.length>250||base.length<5){
        invalid.push({row:i+1,address:full,reason:'주소 길이 확인 필요'});continue;
      }
      const company=nameCol>=0?trim(row[nameCol]).slice(0,70):'';
      const waybill=waybillCol>=0?trim(row[waybillCol]).slice(0,100):'';
      const rawQty=qtyCol>=0?trim(row[qtyCol]):'';
      const quantity=rawQty&&Number(rawQty)>0?Math.min(9999,Math.floor(Number(rawQty))):1;
      entries.push({row:i+1,company,address:full,geoAddress:base,waybill,quantity,
        filename,sheet:$('excelSheetSelect').value});
      if(entries.length>MAX_ROWS)throw Error('한 번에 '+MAX_ROWS+'건까지 등록할 수 있습니다. 파일을 나누어 업로드하세요.');
    }
    return {entries,invalid};
  }
  function renderPreview(){
    const body=$('excelPreviewBody');body.replaceChildren();
    try{
      const {entries,invalid}=buildEntries();
      $('excelPreviewCount').textContent='가져올 배송지 '+entries.length+'건 · 주소 누락/오류 '+invalid.length+'건';
      for(const item of entries.slice(0,5)){
        const tr=document.createElement('tr');
        for(const v of [item.row,item.company||'(이름 없음)',item.address,item.waybill||'-']){
          const td=document.createElement('td');td.textContent=String(v);tr.append(td);
        }
        body.append(tr);
      }
      status(entries.length?'원본 파일은 이 기기에서만 읽습니다. 주소 확인 후 등록하세요.':'주소 열을 확인해 주세요.');
      $('excelImportBtn').disabled=busy||!entries.length;
    }catch(e){status(e.message);$('excelPreviewCount').textContent='주소 열 매핑을 확인하세요.';$('excelImportBtn').disabled=true;}
  }
  async function chooseFile(file){
    if(!file)return;
    if(!/\.(xlsx|xls|xlsm)$/i.test(file.name))throw Error('엑셀 파일(.xlsx, .xls, .xlsm)만 선택하세요.');
    if(file.size>MAX_BYTES)throw Error('엑셀 파일은 10MB 이하만 지원합니다.');
    status('엑셀 파일을 읽는 중...');
    const XLSX=await loadLibrary();
    const bytes=await file.arrayBuffer();
    const opened=XLSX.read(bytes,{type:'array',dense:true});
    if(!opened.SheetNames.length)throw Error('엑셀 시트가 없습니다.');
    workbook=opened;filename=file.name;failures=[];
    const sheets=$('excelSheetSelect');sheets.replaceChildren();
    for(const name of opened.SheetNames){
      const o=document.createElement('option');o.value=name;o.textContent=name;sheets.append(o);
    }
    rows=sheetRows();
    $('excelHeaderRow').value=String(guessHeader(rows));
    $('excelFilename').textContent=filename+' · '+(file.size/1024).toFixed(0)+'KB';
    $('excelResult').hidden=true;$('excelDownloadErrors').hidden=true;
    $('excelDialog').showModal();
    renderColumns();
  }
  function csvCell(v){const s=String(v==null?'':v);return '"'+s.replace(/"/g,'""')+'"';}
  function downloadFailures(){
    if(!failures.length)return;
    const data=[['원본행','주소','사유'],...failures.map(x=>[x.row,x.address,x.reason])];
    const content='\uFEFF'+data.map(r=>r.map(csvCell).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='dsd-excel-errors.csv';document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function importCurrent(){
    if(busy)return;
    let parsed;try{parsed=buildEntries();}catch(e){status(e.message);return;}
    const target=options.context();
    if(!target.mapReady){status('네이버 지도가 연결된 뒤에 등록할 수 있습니다.');return;}
    if(target.date!==target.selectedDate){status('선택한 배송일과 현재 회차가 다릅니다. 회차를 먼저 선택해 주세요.');return;}
    if(!parsed.entries.length){status('등록할 주소가 없습니다.');return;}
    if(!confirm(target.date+' '+target.roundNo+'회차에 엑셀 '+parsed.entries.length+'건을 등록하고 코스를 저장할까요?\n같은 주소의 배송건은 별도 건으로 유지됩니다.'))return;
    busy=true;cancelled=false;failures=[];$('excelImportBtn').disabled=true;$('excelCancelBtn').textContent='등록 중단';
    $('excelResult').hidden=true;$('excelDownloadErrors').hidden=true;
    try{
      const result=await options.importStops(parsed.entries,{
        target,
        cancelled:()=>cancelled,
        progress:(done,total,ok,fail)=>status('좌표 확인 '+done+'/'+total+'건 · 성공 '+ok+' · 실패 '+fail)
      });
      failures=parsed.invalid.concat(result.failures||[]);
      const done='엑셀 '+result.added+'건 등록 · 중복 송장 '+(result.skipped||0)+'건 건너뜀 · 실패 '+failures.length+'건';
      $('excelResult').textContent=done+(result.added?' · '+target.roundNo+'회차 코스 저장 완료.':' · 새로 등록된 배송지는 없습니다.');
      $('excelResult').hidden=false;$('excelDownloadErrors').hidden=!failures.length;
      status(failures.length?'실패한 행은 [실패 목록 CSV]에서 확인하고 원본을 수정하세요.':'등록이 완료되었습니다. 왼쪽 저장된 코스에서 확인하세요.');
    }catch(e){status('등록 실패: '+e.message+' · 기존 배송지는 그대로 유지됩니다.');}
    finally{busy=false;$('excelCancelBtn').textContent='닫기';$('excelImportBtn').disabled=false;}
  }
  function init(cfg){
    options=cfg;
    $('excelUploadBtn').addEventListener('click',()=>$('excelFileInput').click());
    $('excelFileInput').addEventListener('change',async e=>{
      const file=e.target.files&&e.target.files[0];e.target.value='';
      if(!file)return;
      try{await chooseFile(file);}catch(error){cfg.notify('엑셀 읽기 실패: '+error.message);}
    });
    $('excelSheetSelect').addEventListener('change',()=>{rows=sheetRows();$('excelHeaderRow').value=String(guessHeader(rows));renderColumns();});
    $('excelHeaderRow').addEventListener('change',renderColumns);
    for(const id of FIELD_IDS)$(id).addEventListener('change',renderPreview);
    $('excelImportBtn').addEventListener('click',importCurrent);
    $('excelDownloadErrors').addEventListener('click',downloadFailures);
    $('excelCancelBtn').addEventListener('click',()=>{
      if(busy){cancelled=true;status('중단 요청됨 · 현재 주소 검색이 끝나면 종료됩니다.');return;}
      $('excelDialog').close();
    });
    $('excelDialog').addEventListener('cancel',e=>{
      if(busy){e.preventDefault();cancelled=true;status('중단 요청됨 · 현재 주소 검색이 끝나면 종료됩니다.');}
    });
  }
  root.DsdExcel=Object.freeze({init});
}(window));
