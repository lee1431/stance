(function(root){
'use strict';
function normalize(value){return String(value||'').trim().toLowerCase().replace(/\.$/,'');}
function matchDnsName(hostname,pattern){
 const host=normalize(hostname),name=normalize(pattern);
 if(!host||!name)return false;
 if(!name.includes('*'))return host===name;
 if(!name.startsWith('*.')||name.slice(2).includes('*'))return false;
 const suffix=name.slice(2),hostParts=host.split('.'),suffixParts=suffix.split('.');
 return hostParts.length===suffixParts.length+1&&hostParts.slice(1).join('.')===suffix;
}
function evaluateCertificate(input){
 const checks=[];
 const add=(key,label,ok,detail)=>checks.push({key,label,ok:Boolean(ok),detail});
 const names=Array.isArray(input.names)?input.names:[];
 add('name','주소 이름',names.some(name=>matchDnsName(input.hostname,name)),input.hostname+' ↔ '+(names.join(', ')||'이름 없음'));
 const now=Date.parse(input.now),start=Date.parse(input.notBefore),end=Date.parse(input.notAfter);
 add('time','유효 기간',Number.isFinite(now)&&Number.isFinite(start)&&Number.isFinite(end)&&start<=now&&now<=end,(input.notBefore||'?')+' ~ '+(input.notAfter||'?'));
 add('signature','서명 연결',input.signatureValid,'서버 인증서와 중간 인증기관의 서명');
 add('chain','중간 인증서',input.chainComplete,'신뢰 루트까지 이어지는 경로');
 add('root','신뢰 루트',input.trustedRoot,'브라우저의 신뢰 저장소에 포함');
 add('purpose','사용 목적',input.serverAuth,'서버 인증에 허용된 키 사용');
 const firstFailure=checks.find(check=>!check.ok);
 return {ok:!firstFailure,checks,firstFailure:firstFailure||null};
}
const scenarios={
 valid:{label:'정상 사슬',hostname:'shop.example.test',names:['shop.example.test','www.example.test'],now:'2026-10-04T12:00:00Z',notBefore:'2026-09-15T00:00:00Z',notAfter:'2026-12-14T23:59:59Z',signatureValid:true,chainComplete:true,trustedRoot:true,serverAuth:true},
 wrongName:{label:'다른 주소',hostname:'pay.example.test',names:['shop.example.test','www.example.test'],now:'2026-10-04T12:00:00Z',notBefore:'2026-09-15T00:00:00Z',notAfter:'2026-12-14T23:59:59Z',signatureValid:true,chainComplete:true,trustedRoot:true,serverAuth:true},
 expired:{label:'기간 만료',hostname:'shop.example.test',names:['shop.example.test'],now:'2026-10-04T12:00:00Z',notBefore:'2026-06-01T00:00:00Z',notAfter:'2026-09-01T23:59:59Z',signatureValid:true,chainComplete:true,trustedRoot:true,serverAuth:true},
 missingIntermediate:{label:'중간 누락',hostname:'shop.example.test',names:['*.example.test'],now:'2026-10-04T12:00:00Z',notBefore:'2026-09-15T00:00:00Z',notAfter:'2026-12-14T23:59:59Z',signatureValid:true,chainComplete:false,trustedRoot:true,serverAuth:true},
 unknownRoot:{label:'모르는 루트',hostname:'shop.example.test',names:['*.example.test'],now:'2026-10-04T12:00:00Z',notBefore:'2026-09-15T00:00:00Z',notAfter:'2026-12-14T23:59:59Z',signatureValid:true,chainComplete:true,trustedRoot:false,serverAuth:true}
};
if(typeof module!=='undefined'&&module.exports)module.exports={normalize,matchDnsName,evaluateCertificate,scenarios};
if(!root||!root.document)return;
const d=root.document,$=selector=>d.querySelector(selector),lab=$('#certificate-lab');
if(!lab)return;
const host=$('#cert-host'),names=$('#cert-names'),now=$('#cert-now'),start=$('#cert-start'),end=$('#cert-end'),chain=$('#cert-chain'),rootTrust=$('#cert-root'),signature=$('#cert-signature'),purpose=$('#cert-purpose'),status=$('#cert-status'),list=$('#cert-checks');
function fill(data){host.value=data.hostname;names.value=data.names.join(', ');now.value=data.now.slice(0,10);start.value=data.notBefore.slice(0,10);end.value=data.notAfter.slice(0,10);chain.checked=data.chainComplete;rootTrust.checked=data.trustedRoot;signature.checked=data.signatureValid;purpose.checked=data.serverAuth;run();}
function read(){return {hostname:host.value,names:names.value.split(',').map(value=>value.trim()).filter(Boolean),now:now.value,notBefore:start.value,notAfter:end.value,chainComplete:chain.checked,trustedRoot:rootTrust.checked,signatureValid:signature.checked,serverAuth:purpose.checked};}
function run(){
 const input=read();
 if(!normalize(input.hostname)||!input.names.length||!input.now||!input.notBefore||!input.notAfter){status.className='demo-log error';status.textContent='주소, 인증서 이름, 확인일과 유효 기간을 모두 입력해 주세요.';list.replaceChildren();return;}
 const result=evaluateCertificate(input);
 list.replaceChildren(...result.checks.map(check=>{const li=d.createElement('li'),mark=d.createElement('span'),text=d.createElement('span'),small=d.createElement('small');li.className=check.ok?'pass':'fail';mark.textContent=check.ok?'통과':'실패';text.textContent=check.label;small.textContent=check.detail;li.append(mark,text,small);return li;}));
 status.className='demo-log '+(result.ok?'success':'error');
 status.textContent=result.ok?'이 모형의 여섯 검사를 모두 통과했습니다. 실제 브라우저는 정책·철회·투명성 등 더 많은 검사를 합니다.':result.firstFailure.label+' 검사에서 연결을 신뢰할 수 없습니다.';
}
lab.querySelectorAll('[data-scenario]').forEach(button=>{button.disabled=false;button.addEventListener('click',()=>fill(scenarios[button.dataset.scenario]));});
$('#cert-run').disabled=false;$('#cert-run').addEventListener('click',run);
fill(scenarios.valid);
})(typeof window!=='undefined'?window:null);
