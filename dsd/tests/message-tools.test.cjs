const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const sandbox={window:{DSD_API:{}},navigator:{userAgent:'Android'}};
vm.runInNewContext(fs.readFileSync('dsd/assets/js/messages.js','utf8'),sandbox);
const t=sandbox.window.DSDMessageTools;
const profile={bank:'테스트은행',account:'123-456',holder:'기사'};
const make=(type,fee,collected=false)=>({waybill:'123456',collected,fields:{sender_name:'발송상사',item_name:'부품',freight_payment_type:type,freight_amount:fee}});
assert.equal(t.amount('5,000원'),5000);
for(const bad of ['',null,'-500','5천','1.2','1e3'])assert.equal(t.amount(bad),null);
assert.equal(t.payment({freight_amount:'5000'}),'unknown');
assert.equal(t.payment({freight_payment_type:'선불'}),'prepaid');
let r=t.buildMessage('scheduled',[make('착불','5000'),make('착불','3000'),make('선불','10000')],profile,'');
assert.match(r.body,/8,000원/);assert.match(r.body,/발송상사/);assert.match(r.body,/부품/);assert.doesNotMatch(r.body,/입금 부탁/);
r=t.buildMessage('done',[make('착불','5000',true)],profile,'현관 앞');
assert.doesNotMatch(r.body,/입금|계좌/);assert.match(r.body,/현관 앞/);
r=t.buildMessage('done',[make('착불','5000',true),make('착불','3000')],profile,'');
assert.match(r.body,/3,000원/);assert.match(r.body,/입금 부탁/);
assert(t.buildMessage('done',[make('착불','')],profile,'').missing);
assert(t.buildMessage('done',[make('착불','5000')],{},'').accountMissing);
assert(t.validPhone('010-1234-5678'));assert(!t.validPhone('0101234;0105678'));assert(!t.validPhone(''));
assert.match(t.smsUrl('010-1234-5678','안녕 & +','Android'),/^sms:01012345678\?body=/);
assert.match(t.smsUrl('01012345678','안녕','iPhone'),/^sms:01012345678&body=/);
let launched='';
t.launchSmsDraft('', '배송 안내', url=>{launched=url;});
assert.match(launched,/^sms:\?body=/); // Missing number can be entered in the message app.
launched='';t.launchSmsDraft('010-1234-5678','배송 안내',url=>{launched=url;});
assert.match(launched,/^sms:01012345678\?body=/); // Synchronous; no saving/API dependency.
assert.throws(()=>t.launchSmsDraft('잘못된 번호','안내',()=>{}),/연락처/);
assert.throws(()=>t.launchSmsDraft('01012345678','',()=>{}),/문자 내용/);
console.log('Message composition and synchronous draft launch assertions passed');

