/* DSD scan: works in map and list; the server owns the manifest lookup. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const css=document.createElement('style');
 css.textContent=[
 '.dsd-scan-pop{position:fixed;z-index:2200;left:50%;bottom:110px;transform:translate(-50%,20px);max-width:90vw;width:max-content;padding:14px 24px;border-radius:14px;background:rgba(23,40,52,.83);backdrop-filter:blur(12px);color:white;text-align:center;pointer-events:none;opacity:0;box-shadow:0 10px 30px #0003;display:flex;flex-direction:column;gap:5px}',
 '.dsd-scan-pop strong{font-size:14px;overflow-wrap:anywhere}.dsd-scan-pop small{color:#bef0d4;font-size:12px}',
 '.dsd-scan-pop.on{animation:scan-receipt 2.8s ease-in-out forwards}',
 '@keyframes scan-receipt{0%{opacity:0;transform:translate(-50%,15px)}12%{opacity:1;transform:translate(-50%,0)}75%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,65px)}}',
 '.dsd-scan-dialog{width:min(430px,96vw);max-width:96vw;box-sizing:border-box;border-radius:16px;border:1px solid #9dabb8;background:#f8fafc;color:#1b2938;padding:20px}',
 '.dsd-scan-dialog::backdrop{background:#0b1623aa}.dsd-scan-dialog h2{font-size:18px;margin:0}',
 '.dsd-scan-dialog p{font-size:13px;color:#566475}.dsd-scan-head{display:flex;justify-content:space-between;align-items:center}',
 '.dsd-scan-dialog form{display:flex;gap:7px;margin:12px 0}.dsd-scan-dialog input{flex:1;min-width:0;background:white;color:#172333;border:1px solid #aab6c6;border-radius:7px;padding:10px;font-size:16px}',
 '.dsd-scan-dialog button{padding:9px 12px;border:1px solid #9aabba;border-radius:7px;cursor:pointer}.dsd-scan-dialog form button{background:#18675d;color:white}',
 '.dsd-scan-dialog video{width:100%;max-height:40vh;min-height:170px;object-fit:cover;margin-top:10px;border-radius:10px;background:#09121c}.dsd-scan-dialog video[hidden]{display:none}',
 '.dsd-scan-msg.error{color:#aa3333}.dsd-scan-map-button{font-size:15px;font-weight:700}',
 '.dsd-scan-dialog{width:min(540px,96vw);max-height:88vh;overflow:auto}',
 '.dsd-scan-pop.pending small{color:#ffdf9e}',
 '.dsd-scan-slip{margin-top:13px;border-top:1px solid #c5d0db;padding-top:12px;font-size:13px;color:#233548}',
 '.dsd-scan-slip h3{margin:0 0 9px;font-size:15px}.dsd-scan-slip h4{font-size:12px;margin:14px 0 6px}',
 '.dsd-scan-slip .scan-row{display:grid;grid-template-columns:130px minmax(0,1fr);gap:8px;padding:7px 0;border-bottom:1px solid #e3e9ee}',
 '.dsd-scan-slip .scan-key{color:#586979}.dsd-scan-slip .scan-value{font-weight:600;overflow-wrap:anywhere;white-space:pre-wrap}',
 '.dsd-scan-slip .scan-raw{background:#f0f4f7;padding:6px 10px;border-radius:8px}',
 '.dsd-scan-slip .scan-pending{padding:9px;background:#fff4df;color:#895c14;border-radius:8px;font-size:12px;margin:8px 0}',
 '.dsd-scan-slip .scan-source{color:#607080;font-size:11px;margin:6px 0;overflow-wrap:anywhere}',
 '@media(max-width:480px){.dsd-scan-slip .scan-row{grid-template-columns:104px minmax(0,1fr)}}',
 '@media(prefers-reduced-motion:reduce){.dsd-scan-pop.on{animation:none;opacity:1;transform:translate(-50%,0)}}'
 ].join('\n');
 document.head.append(css);
 let dialog,input,msg,video,cameraBtn,stream=null,frame=0,detecting=false;
 let zxingControls=null,zxingLoader=null,cameraStarting=false,cameraSession=0;
 // Pin the decoding library; iPhone browsers do not consistently expose BarcodeDetector.
 const ZXING_CDNS=[
   'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js',
   'https://unpkg.com/@zxing/browser@0.2.1/umd/zxing-browser.min.js'
 ];
 function supportsZXing(){
   const browser=window.ZXingBrowser;
   return !!(browser && (browser.BrowserMultiFormatOneDReader || browser.BrowserMultiFormatReader));
 }
 function loadZXing(){
   if(supportsZXing())return Promise.resolve(window.ZXingBrowser);
   if(zxingLoader)return zxingLoader;
   zxingLoader=(async()=>{
     for(const url of ZXING_CDNS){
       try{
         await new Promise((resolve,reject)=>{
           const script=document.createElement('script');
           let finished=false;
           const finish=(error)=>{
             if(finished)return;finished=true;clearTimeout(timeout);
             script.onerror=null;script.onload=null;
             if(error){script.remove();reject(error);}else resolve();
           };
           const timeout=setTimeout(()=>finish(Error('ZXing loading timeout')),12000);
           script.src=url;script.async=true;
           script.onload=()=>finish();
           script.onerror=()=>finish(Error('ZXing loading error'));
           document.head.appendChild(script);
         });
         if(supportsZXing())return window.ZXingBrowser;
       }catch(_){}
     }
     throw Error('아이폰 바코드 인식 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하거나 운송장번호를 직접 입력하세요.');
   })().catch(error=>{zxingLoader=null;throw error;});
   return zxingLoader;
 }
 function cameraActive(){return !!stream||!!zxingControls||cameraStarting;}
 const queue=[];let busy=false,last='',lastAt=0,toastTimer=0;

 function notice(receipt){
   const pop=$('dsdScanReceipt');
   const pending=!!receipt.pending_reason;
   pop.classList.toggle('pending',pending);
   $('dsdScanReceiptAddress').textContent=receipt.address||'받는 분 주소 확인 필요';
   $('dsdScanReceiptText').textContent=pending?'원본 조회 완료 · 배송지 등록 대기'
      :receipt.already_added?'이미 등록된 배송지입니다'
      :receipt.added?'배송지가 추가되었습니다':'운송장 원본을 찾았습니다';
   pop.classList.remove('on');void pop.offsetWidth;pop.classList.add('on');
   clearTimeout(toastTimer);toastTimer=setTimeout(()=>pop.classList.remove('on'),2800);
 }
 const SCAN_FIELD_LABELS={
   waybill:'운송장번호',recipient_name:'받는 분',recipient_phone:'수취인 연락처',
   recipient_address:'받는 분 주소',recipient_detail:'상세주소',
   sender_name:'보내는 분',sender_phone:'발송인 연락처',sender_address:'발송인 주소',
   item_name:'상품명',quantity:'수량',freight_amount:'운임 금액',freight_payment_type:'운임 결제 구분',payment_type:'결제구분 (기존)',cod_amount:'착불금액 (기존)',
   company:'업체명',memo:'배송 요청사항'
 };
 function scanRow(label,value){
   const row=document.createElement('div');row.className='scan-row';
   const name=document.createElement('span');name.className='scan-key';name.textContent=label;
   const val=document.createElement('span');val.className='scan-value';val.textContent=String(value??'');
   row.append(name,val);return row;
 }
 function renderSlip(receipt){
   const target=$('dsdScanSlip');
   target.replaceChildren();target.hidden=false;
   const title=document.createElement('h3');title.textContent='운송장 상세정보';target.append(title);
   if(receipt.pending_reason){
     const warning=document.createElement('p');warning.className='scan-pending';
     warning.textContent=receipt.pending_reason;target.append(warning);
   }
   if(receipt.source){
     const source=document.createElement('p');source.className='scan-source';
     source.textContent=receipt.source.filename+' · '+receipt.source.sheet+' · '+receipt.source.row_no+'행';
     target.append(source);
   }
   const fields=receipt.fields||{};
   for(const [key,label] of Object.entries(SCAN_FIELD_LABELS)){
     const value=fields[key];
     if(['freight_amount','freight_payment_type','cod_amount','payment_type'].includes(key))continue;
     if(value!==undefined && String(value).trim())target.append(scanRow(label,value));
   }
   const fareAmount=fields.freight_amount ?? fields.cod_amount;
   const farePayment=fields.freight_payment_type ?? fields.payment_type;
   if((fareAmount!==undefined && String(fareAmount).trim()) || (farePayment!==undefined && String(farePayment).trim())){
     const heading=document.createElement('h4');heading.textContent='운임';target.append(heading);
     if(fareAmount!==undefined && String(fareAmount).trim())target.append(scanRow('금액',fareAmount));
     if(farePayment!==undefined && String(farePayment).trim())target.append(scanRow('결제 구분',farePayment));
   }
   const extra=Array.isArray(receipt.unclassified)?receipt.unclassified:[];
   if(extra.length){
     const head=document.createElement('h4');head.textContent='추가 원본 데이터 · 미분류 '+extra.length+'개';
     target.append(head);
     const content=document.createElement('div');content.className='scan-raw';
     for(const item of extra){
       if(item && item.value!==undefined)content.append(scanRow(item.header||('열 '+(item.column_index+1)),item.value));
     }
     target.append(content);
   }
   if(Array.isArray(receipt.warnings)&&receipt.warnings.length){
     const heading=document.createElement('h4');heading.textContent='확인이 필요한 항목';
     target.append(heading);
     for(const warning of receipt.warnings){
       const p=document.createElement('p');p.className='scan-pending';p.textContent=warning;target.append(p);
     }
   }
 }
 function status(text,error){msg.textContent=text;msg.classList.toggle('error',!!error);}
 async function consume(){
   if(busy)return;busy=true;
   while(queue.length){
     const code=queue.shift();status('운송장 조회 중…',false);
     try{
       if(typeof window.DSD_SCAN_WAYBILL!=='function')throw Error('DSD 배송 화면이 준비되지 않았습니다.');
       await window.DSD_SCAN_WAYBILL(code,receipt=>{
         renderSlip(receipt);
         notice(receipt);
         status(receipt.pending_reason || (receipt.already_added?'이미 등록된 운송장입니다.':receipt.added?'추가 완료 · 다음 운송장을 스캔하세요.':'운송장 원본 조회 완료.'),!!receipt.pending_reason);
       });
     }catch(e){status(e.message||'등록하지 못했습니다.',true);}
     if(dialog.open&&!cameraActive())input.focus({preventScroll:true});
   }
   busy=false;
 }
 function enqueue(raw){
   const v=String(raw||'').trim();
   if(!v)return;
   const now=Date.now();
   if(v===last&&now-lastAt<4500)return;
   last=v;lastAt=now;queue.push(v);consume();
 }
 function stopCamera(){
   cameraSession++;
   if(frame)cancelAnimationFrame(frame);frame=0;
   detecting=false;
   if(zxingControls){
     try{zxingControls.stop();}catch(_){}
     zxingControls=null;
   }
   if(stream){stream.getTracks().forEach(track=>track.stop());stream=null;}
   if(video){
     try{video.pause();}catch(_){}
     video.srcObject=null;video.hidden=true;
   }
   cameraStarting=false;
   if(cameraBtn){cameraBtn.disabled=false;cameraBtn.textContent='카메라 스캔';}
 }
 async function detect(){
   if(!stream||!dialog.open)return;
   if(!detecting&&video.readyState>=2){
     detecting=true;
     try{
       const codes=await window.dsdDetector.detect(video);
       if(codes.length)enqueue(codes[0].rawValue);
     }catch(_){}
     finally{detecting=false;}
   }
   if(stream&&dialog.open)frame=requestAnimationFrame(detect);
 }
 async function startNativeCamera(session){
   const preferred=['code_128','ean_13','ean_8','itf','codabar'];
   const supported=typeof BarcodeDetector.getSupportedFormats==='function'
     ?await BarcodeDetector.getSupportedFormats():preferred;
   const formats=preferred.filter(format=>supported.includes(format));
   if(!formats.length)throw Error('기본 카메라가 운송장 바코드 형식을 지원하지 않습니다.');
   const detector=new BarcodeDetector({formats});
   const media=await navigator.mediaDevices.getUserMedia({audio:false,
     video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
   if(session!==cameraSession||!dialog.open){
     media.getTracks().forEach(track=>track.stop());
     return;
   }
   window.dsdDetector=detector;
   stream=media;video.srcObject=stream;video.hidden=false;
   video.muted=true;video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');
   await video.play();
   if(session!==cameraSession||!dialog.open){stopCamera();return;}
   status('바코드를 가로로 맞춰주세요. 자동으로 조회합니다.',false);
   frame=requestAnimationFrame(detect);
 }
 async function startZXingCamera(session){
   status('아이폰용 바코드 인식기를 준비하는 중…',false);
   const zx=await loadZXing();
   if(session!==cameraSession||!dialog.open)return;
   const Reader=zx.BrowserMultiFormatOneDReader||zx.BrowserMultiFormatReader;
   const reader=new Reader(undefined,{delayBetweenScanAttempts:350,delayBetweenScanSuccess:600});
   video.hidden=false;video.muted=true;
   video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');
   const controls=await reader.decodeFromConstraints({
     audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}
   },video,result=>{
     if(session!==cameraSession||!dialog.open||!result)return;
     const raw=typeof result.getText==='function'?result.getText():result.text;
     if(raw)enqueue(raw);
   });
   if(session!==cameraSession||!dialog.open){
     controls.stop();return;
   }
   zxingControls=controls;
   status('카메라 준비 완료 · 운송장 바코드를 가로로 맞춰주세요.',false);
 }
 async function camera(){
   if(cameraActive()){
     stopCamera();
     return;
   }
   if(!navigator.mediaDevices?.getUserMedia){
     status('카메라 사용이 불가능합니다. Safari에서 HTTPS 접속과 카메라 권한을 확인하세요.',true);
     return;
   }
   const session=++cameraSession;
   cameraStarting=true;cameraBtn.disabled=true;
   const iOS=/iPhone|iPad|iPod/i.test(navigator.userAgent)||
     (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
   try{
     if(!iOS&&typeof window.BarcodeDetector==='function'){
       try{await startNativeCamera(session);}
       catch(error){
         if(session!==cameraSession||!dialog.open)return;
         if(stream){stream.getTracks().forEach(track=>track.stop());stream=null;}
         video.srcObject=null;video.hidden=true;
         await startZXingCamera(session);
       }
     }else{
       await startZXingCamera(session);
     }
     if(session===cameraSession&&dialog.open&&
        (stream||zxingControls)){
       cameraBtn.textContent='카메라 끄기';
     }
   }catch(error){
     if(session===cameraSession&&dialog.open){
       stopCamera();
       const denied=error?.name==='NotAllowedError'||error?.name==='PermissionDeniedError';
       const detail=denied
         ?'카메라 접근이 거부됐습니다. 아이폰 설정에서 Safari의 카메라 권한을 허용하세요.'
         :error?.name==='NotFoundError'
           ?'사용할 카메라를 찾지 못했습니다.'
           :(error?.message||'카메라를 시작하지 못했습니다.');
       status(detail,true);
     }
   }finally{
     if(session===cameraSession){
       cameraStarting=false;cameraBtn.disabled=false;
     }
   }
 }
 function setup(){
   dialog=document.createElement('dialog');dialog.className='dsd-scan-dialog';
   dialog.innerHTML='<div class="dsd-scan-head"><h2>운송장 스캔</h2><button id="dsdScanClose" type="button" aria-label="닫기">✕</button></div>'
    +'<p>현재 회차에 등록합니다. 바코드 리더기로 읽거나 번호를 입력하세요.</p>'
    +'<form id="dsdScanForm"><input id="dsdScanCode" autocomplete="off" spellcheck="false" placeholder="바코드 스캔 또는 번호 입력" aria-label="운송장번호" /><button type="submit">추가</button></form>'
    +'<button id="dsdScanCam" type="button">카메라 스캔</button><video id="dsdScanVideo" autoplay playsinline webkit-playsinline muted hidden></video><p id="dsdScanMessage" class="dsd-scan-msg" aria-live="polite"></p><section id="dsdScanSlip" class="dsd-scan-slip" hidden aria-label="운송장 상세정보"></section>';
   document.body.append(dialog);
   const pop=document.createElement('div');pop.id='dsdScanReceipt';pop.className='dsd-scan-pop';pop.setAttribute('role','status');
   pop.setAttribute('aria-live','polite');
   pop.innerHTML='<strong id="dsdScanReceiptAddress"></strong><small id="dsdScanReceiptText"></small>';
   document.body.append(pop);
   input=$('dsdScanCode');msg=$('dsdScanMessage');video=$('dsdScanVideo');cameraBtn=$('dsdScanCam');
   function open(){if($('app')?.classList.contains('hidden'))return;if(!dialog.open)dialog.showModal();input.value='';$('dsdScanSlip').replaceChildren();$('dsdScanSlip').hidden=true;status('스캔 준비 · Enter로 등록합니다.');input.focus({preventScroll:true});}
   $('mapScanBtn')?.addEventListener('click',open);
   $('listScanBtn')?.addEventListener('click',open);
   $('dsdScanClose').addEventListener('click',()=>dialog.close());
   dialog.addEventListener('close',stopCamera);
   document.addEventListener('visibilitychange',()=>{if(document.hidden&&cameraActive())stopCamera();});
   $('dsdScanForm').addEventListener('submit',e=>{e.preventDefault();const s=input.value;input.value='';enqueue(s);input.focus({preventScroll:true});});
   cameraBtn.addEventListener('click',camera);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();