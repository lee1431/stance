/* DSD dated rounds: confidential browser-side AES-GCM payloads in append-only UVB items.
   The current UVB collection may not be provisioned; writes must be verified before success. */
(function(root){
 'use strict';
 const API='https://localflow.ddns.net/uvb/v1/apps/dsd/items';
 const PAGE_SIZE=200;
 const encoded=new TextEncoder();
 const b64=bytes=>{let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out);};
 const from64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
 const dateOK=date=>/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date+'T00:00:00Z'));
 const roundOK=n=>Number.isSafeInteger(n)&&n>=1&&n<=1000000;
 const isRound=d=>d && d.kind==='dsd-round'&&d.schema_version===1&&
    dateOK(d.date_key)&&roundOK(d.round_no)&&typeof d.center_id==='string'&&
    typeof d.snapshot_id==='string'&&d.sealed?.algorithm==='AES-256-GCM';
 const aad=d=>encoded.encode(['dsd-round',d.center_id,d.date_key,d.round_no,d.snapshot_id].join('|'));
 async function key(password,salt){
   if(typeof password!=='string'||password.length<12)throw Error('암호는 12자 이상으로 지정해 주세요.');
   const material=await crypto.subtle.importKey('raw',encoded.encode(password),'PBKDF2',false,['deriveKey']);
   return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 }
 async function seal(data,password,meta){
   if(!dateOK(meta.date_key)||!roundOK(meta.round_no))throw Error('저장 날짜/회차가 올바르지 않습니다.');
   if(!crypto?.subtle||!crypto?.getRandomValues)throw Error('HTTPS 암호화 기능이 필요합니다.');
   const salt=crypto.getRandomValues(new Uint8Array(16));
   const iv=crypto.getRandomValues(new Uint8Array(12));
   const raw=encoded.encode(JSON.stringify(data));
   if(raw.byteLength>1500000)throw Error('회차 데이터 크기가 1.5MB를 초과했습니다.');
   const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(meta)},await key(password,salt),raw);
   return {algorithm:'AES-256-GCM',kdf:'PBKDF2-SHA256-250000',salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(ciphertext))};
 }
 async function unseal(d,password){
   if(!isRound(d))throw Error('DSD 회차 형식이 아닙니다.');
   try{
     const salt=from64(d.sealed.salt),iv=from64(d.sealed.iv),raw=from64(d.sealed.ciphertext);
     if(salt.length!==16||iv.length!==12||raw.length>1500100)throw Error('invalid payload');
     const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad(d)},await key(password,salt),raw);
     const data=JSON.parse(new TextDecoder().decode(clear));
     if(!data||data.date_key!==d.date_key||data.round_no!==d.round_no||
        !Array.isArray(data.stops)||!Array.isArray(data.ids)||!Array.isArray(data.pinnedLastIds)||
        data.stops.length>5000)throw Error('invalid decrypted structure');
     return data;
   }catch(e){if(e.message?.includes('12자'))throw e;throw Error('회차 복호화 실패: 암호 오류 또는 데이터 손상');}
 }
 async function getAll(){
   const result=[],seen=new Set();
   for(let page=1;page<=500;page++){
     const res=await fetch(API+'?page='+page+'&page_size='+PAGE_SIZE+'&order=asc',{cache:'no-store'});
     if(!res.ok)throw Error('UVB 목록 HTTP '+res.status);
     const body=await res.json(),d=body.data;
     if(body.ok!==true||!d||!Array.isArray(d.items)||typeof d.has_more!=='boolean')
       throw Error('UVB 목록 응답 형식이 맞지 않습니다.');
     for(const row of d.items){
       if(typeof row?.id!=='string'||seen.has(row.id))throw Error('UVB 중복 항목 ID');
       seen.add(row.id);if(isRound(row.data))result.push(row);
     }
     if(!d.has_more)return result;
     if(!d.items.length)throw Error('UVB 페이지가 비어 있습니다.');
   }
   throw Error('UVB 페이지 조회 한도를 초과했습니다.');
 }
 function latest(rows,centerId){
   const grouped=new Map();
   for(const row of rows){
     const d=row.data;
     if(!isRound(d)||d.center_id!==centerId)continue;
     const k=d.date_key+'#'+d.round_no,prev=grouped.get(k);
     if(!prev||Number(row.created_at)>Number(prev.created_at)||
       (Number(row.created_at)===Number(prev.created_at)&&String(row.id)>String(prev.id)))
       grouped.set(k,row);
   }
   return [...grouped.values()].sort((a,b)=>b.data.date_key.localeCompare(a.data.date_key)||a.data.round_no-b.data.round_no);
 }
 async function save({password,centerId,centerName,date,round,data}){
   if(!centerId||!dateOK(date)||!roundOK(round))throw Error('센터·날짜·회차를 확인하세요.');
   const snapshot_id=crypto.randomUUID();
   const meta={kind:'dsd-round',schema_version:1,center_id:centerId,center_name:String(centerName||'센터').slice(0,60),
     date_key:date,round_no:round,snapshot_id,saved_at:new Date().toISOString()};
   const sealed=await seal(data,password,meta),payload={...meta,sealed};
   // Never send clear customer data; send one append-only revision per Save action.
   let postError=null;
   try{
     const res=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
     const response=await res.json().catch(()=>({}));
     if(!res.ok||response.ok!==true)throw Error('UVB 저장 HTTP '+res.status+': '+(response.error||'등록 실패'));
   }catch(e){postError=e;}
   // Confirm by reading back snapshot_id; in case the POST response was lost, no blind retry.
   let rows;
   try{rows=await getAll();}catch(e){
     throw Error('서버 저장 여부를 확인할 수 없습니다. 중복 저장하지 말고 목록을 새로고침하세요. '+e.message);
   }
   const found=rows.find(row=>row.data?.snapshot_id===snapshot_id);
   if(found)return found;
   if(postError)throw postError;
   throw Error('UVB 저장 후 항목 재조회에 실패했습니다. 확인 전까지 저장 완료로 취급하지 않습니다.');
 }

 // Delete every stored revision for one center/date/round, never a different round.
 // The server must authorize DELETE /items/:id. Unsupported endpoints must fail visibly.
 async function removeRound({centerId,date,round}){
   if(!centerId||!dateOK(date)||!roundOK(round))throw Error('삭제할 센터·날짜·회차를 확인하세요.');
   const matches=rows=>rows.filter(row=>row.data?.center_id===centerId&&
     row.data.date_key===date&&row.data.round_no===round);
   const target=matches(await getAll());
   let completed=0;
   try{
     for(const row of target){
       const response=await fetch(API+'/'+encodeURIComponent(row.id),{method:'DELETE',cache:'no-store'});
       if(!response.ok)throw Error('UVB 삭제 HTTP '+response.status+' (항목 '+row.id+')');
       completed++;
     }
   }catch(error){
     let remaining='확인 불가';
     try{remaining=String(matches(await getAll()).length);}catch(_){}
     throw Error('UVB 삭제 미완료 ('+completed+'/'+target.length+'건 처리, 남은 기록 '+remaining+'건): '+error.message);
   }
   const remaining=matches(await getAll());
   if(remaining.length)throw Error('삭제 검증 실패: UVB에 '+remaining.length+'개 기록이 남았습니다. 브라우저 코스는 유지됩니다.');
   return {deleted:completed};
 }
 root.DsdRounds=Object.freeze({getAll,latest,unseal,save,removeRound,dateOK,roundOK});
}(window));