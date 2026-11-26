const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,25));
const dom=new JSDOM(read('admin/index.html'),{url:'https://llsshh.com/ddsm/admin/',runScripts:'outside-only'});
const w=dom.window,$=id=>w.document.getElementById(id);
let oldApi=true,requests=[],token='s_a_'+'k'.repeat(64);
let recurring={id:1,recipient_name:'고객A',phone:'',address:'충주시 문화동',lat:null,lng:null},updates=0;
w.localStorage.setItem('ddsm:center:admin:v1','x'.repeat(64));
w.DDSM_NaverMap={loadSdk:async()=>{throw Error('mock SDK disabled');}};
function result(ok,status,body){return {ok,status,json:async()=>body};}
w.fetch=async(url,opts)=>{
 const endpoint=url.split('/ddsm/api/')[1];
 requests.push({endpoint,auth:opts.headers.Authorization});
 if(endpoint==='connection/admin-centers'){
   assert.equal(opts.headers.Authorization,undefined);
   if(oldApi)return result(false,404,{ok:false,error:'old API'});
   return result(true,200,{ok:true,centers:[{id:'a',name:'충주센터'},{id:'b',name:'다른센터'}]});
 }
 if(endpoint==='connection/admin-login'){
   assert.equal(opts.headers.Authorization,undefined);
   const body=JSON.parse(opts.body);
   if(body.password!=='test-password')return result(false,403,{ok:false,error:'비밀번호가 일치하지 않습니다.'});
   assert.equal(body.center,'a');
   return result(true,200,{ok:true,center:'a',token,expires_at:Date.now()/1000+3600});
 }
 assert.equal(opts.headers.Authorization,'Bearer '+token);
 if(endpoint==='admin/me')return result(true,200,{ok:true,admin:true});
 if(endpoint.startsWith('admin/deliveries?'))return result(true,200,{ok:true,total:0,located:0,unlocated:0,rows:[],columns:[]});
 if(endpoint.startsWith('admin/recurring-recipients?'))return result(true,200,{ok:true,recipients:[{...recurring}]});
 if(endpoint==='admin/recurring-recipients/1/update'){updates++;recurring={...recurring,...JSON.parse(opts.body)};return result(true,200,{ok:true});}
 throw Error('Unexpected endpoint '+endpoint);
};
(async()=>{
 w.eval(read('admin/admin.js'));await tick();
 assert.equal($('adminPasswordRow').hidden,false);
 assert.equal($('adminPassword').required,true);
 assert.equal($('openCenter').disabled,true);
 assert.equal(w.localStorage.getItem('ddsm:center:admin:v1'),null);
 assert.ok(!requests.some(x=>x.endpoint==='connection/centers'));
 assert.match($('centerStatus').textContent,/S10/);
 oldApi=false;$('retryCenter').click();await tick();
 assert.equal($('centerSelect').options.length,2);
 assert.equal($('dashboard').hidden,true);
 assert.equal($('centerSelect').disabled,false);
 assert.equal($('adminPasswordRow').hidden,false);
 assert.equal(w.localStorage.getItem('ddsm:center:admin:v1'),null);
 $('adminPassword').value='incorrect';
 $('centerLoginForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 assert.match($('centerStatus').textContent,/비밀번호/);
 assert.equal($('dashboard').hidden,true);
 $('adminPassword').value='test-password';
 $('centerLoginForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
 assert.equal($('dashboard').hidden,false);
 assert.equal($('centerPanel').hidden,true);
 assert.equal($('adminPassword').value,'');
 assert.equal(JSON.parse(w.sessionStorage.getItem('ddsm:admin:session:v2')).token,token);
 assert.equal(w.localStorage.getItem('ddsm:center:admin:v1'),null);
 assert.ok(requests.some(x=>x.endpoint==='admin/me'));
 const fields=$('recurringBody').querySelectorAll('input');
 assert.equal(fields.length,3);
 fields[0].value='고객A 변경';fields[0].dispatchEvent(new w.Event('input'));
 fields[1].value='01012345678';fields[1].dispatchEvent(new w.Event('input'));
 fields[2].value='충주시 금봉로 21';fields[2].dispatchEvent(new w.Event('input'));
 const before=requests.filter(x=>x.endpoint.startsWith('admin/deliveries?')).length;
 $('recurringBody').querySelector('button.primary').click();
 await tick();await tick();
 assert.equal(updates,1);
 assert.equal(recurring.recipient_name,'고객A 변경');
 assert.equal(recurring.address,'충주시 금봉로 21');
 assert.equal($('recurringBody').querySelectorAll('input')[1].value,'01012345678');
 assert.ok(requests.filter(x=>x.endpoint.startsWith('admin/deliveries?')).length>before);
 assert.match($('importStatus').textContent,/갱신 완료/);
 console.log('Direct admin login and recurring edit test passed');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>dom.window.close());
