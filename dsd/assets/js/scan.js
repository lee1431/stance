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
 '.dsd-scan-dialog video{width:100%;max-height:36vh;margin-top:10px}.dsd-scan-dialog video[hidden]{display:none}',
 '.dsd-scan-msg.error{color:#aa3333}.dsd-scan-map-button{font-size:15px;font-weight:700}',
 '@media(prefers-reduced-motion:reduce){.dsd-scan-pop.on{animation:none;opacity:1;transform:translate(-50%,0)}}'
 ].join('\n');
 document.head.append(css);
 let dialog,input,msg,video,cameraBtn,stream=null,frame=0,detecting=false;
 const queue=[];let busy=false,last='',lastAt=0,toastTimer=0;
 function notice(address,already){
   const pop=$('dsdScanReceipt');
   $('dsdScanReceiptAddress').textContent=address||'주소 확인 필요';
   $('dsdScanReceiptText').textContent=already?'이미 추가된 배송지입니다':'배송지가 추가되었습니다';
   pop.classList.remove('on');void pop.offsetWidth;pop.classList.add('on');
   clearTimeout(toastTimer);toastTimer=setTimeout(()=>pop.classList.remove('on'),2800);
 }
 function status(text,error){msg.textContent=text;msg.classList.toggle('error',!!error);}
 async function consume(){
   if(busy)return;busy=true;
   while(queue.length){
     const code=queue.shift();status('운송장 조회 중…',false);
     try{
       if(typeof window.DSD_SCAN_WAYBILL!=='function')throw Error('DSD 배송 화면이 준비되지 않았습니다.');
       await window.DSD_SCAN_WAYBILL(code,receipt=>{
         notice(receipt.address,receipt.already_added);
         status(receipt.already_added?'이미 등록된 운송장입니다.':'추가 완료. 다음 운송장을 스캔하세요.',false);
       });
     }catch(e){status(e.message||'등록하지 못했습니다.',true);}
     if(dialog.open)input.focus({preventScroll:true});
   }
   busy=false;
 }
 function enqueue(raw){
   const v=String(raw||'').trim();
   if(!v)return;
   const now=Date.now();
   if(v===last&&now-lastAt<1700)return;
   last=v;lastAt=now;queue.push(v);consume();
 }
 function stopCamera(){
   if(frame)cancelAnimationFrame(frame);frame=0;
   if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;
   if(video){video.pause();video.srcObject=null;video.hidden=true;}
   if(cameraBtn)cameraBtn.textContent='카메라 스캔';
 }
 async function detect(){
   if(!stream||!dialog.open)return;
   if(!detecting&&video.readyState>=2){
     detecting=true;
     try{const codes=await window.dsdDetector.detect(video);if(codes.length)enqueue(codes[0].rawValue);}
     catch(_){}
     finally{detecting=false;}
   }
   if(stream&&dialog.open)frame=requestAnimationFrame(detect);
 }
 async function camera(){
   if(stream){stopCamera();input.focus();return;}
   if(!('BarcodeDetector' in window)||!navigator.mediaDevices?.getUserMedia){
     status('카메라 바코드 인식 미지원. 바코드 리더기나 직접 입력을 이용하세요.',true);return;
   }
   try{
     const preferred=['code_128','ean_13','ean_8','itf','codabar'];
     const available=typeof BarcodeDetector.getSupportedFormats==='function'?await BarcodeDetector.getSupportedFormats():preferred;
     window.dsdDetector=new BarcodeDetector({formats:preferred.filter(f=>available.includes(f))});
     stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
     video.srcObject=stream;video.hidden=false;await video.play();
     if(!dialog.open){stopCamera();return;}
     cameraBtn.textContent='카메라 끄기';status('바코드를 카메라에 맞춰주세요.',false);
     frame=requestAnimationFrame(detect);
   }catch(e){stopCamera();status('카메라를 시작하지 못했습니다. 권한을 확인하세요.',true);}
 }
 function setup(){
   dialog=document.createElement('dialog');dialog.className='dsd-scan-dialog';
   dialog.innerHTML='<div class="dsd-scan-head"><h2>운송장 스캔</h2><button id="dsdScanClose" type="button" aria-label="닫기">✕</button></div>'
    +'<p>현재 회차에 등록합니다. 바코드 리더기로 읽거나 번호를 입력하세요.</p>'
    +'<form id="dsdScanForm"><input id="dsdScanCode" autocomplete="off" spellcheck="false" placeholder="바코드 스캔 또는 번호 입력" aria-label="운송장번호" /><button type="submit">추가</button></form>'
    +'<button id="dsdScanCam" type="button">카메라 스캔</button><video id="dsdScanVideo" playsinline muted hidden></video><p id="dsdScanMessage" class="dsd-scan-msg" aria-live="polite"></p>';
   document.body.append(dialog);
   const pop=document.createElement('div');pop.id='dsdScanReceipt';pop.className='dsd-scan-pop';pop.setAttribute('role','status');
   pop.setAttribute('aria-live','polite');
   pop.innerHTML='<strong id="dsdScanReceiptAddress"></strong><small id="dsdScanReceiptText"></small>';
   document.body.append(pop);
   input=$('dsdScanCode');msg=$('dsdScanMessage');video=$('dsdScanVideo');cameraBtn=$('dsdScanCam');
   function open(){if($('app')?.classList.contains('hidden'))return;if(!dialog.open)dialog.showModal();input.value='';status('스캔 준비 · Enter로 등록합니다.');input.focus({preventScroll:true});}
   $('mapScanBtn')?.addEventListener('click',open);
   $('listScanBtn')?.addEventListener('click',open);
   $('dsdScanClose').addEventListener('click',()=>dialog.close());
   dialog.addEventListener('close',stopCamera);
   $('dsdScanForm').addEventListener('submit',e=>{e.preventDefault();const s=input.value;input.value='';enqueue(s);input.focus({preventScroll:true});});
   cameraBtn.addEventListener('click',camera);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();