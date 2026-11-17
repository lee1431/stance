const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.events={};this.value='';this.textContent='';this.open=false;this.attrs={};}
  append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(k,v){this.attrs[k]=v;}
  removeAttribute(k){delete this.attrs[k];}
  addEventListener(k,fn){(this.events[k]??=[]).push(fn);}
  showModal(){this.open=true;}
  get isConnected(){return !!this.parent;}
  get parentElement(){return this.parent;}
  scrollIntoView(){this.scrolled=true;}
  click(){for(const fn of this.events.click||[])fn({target:this});}
}
const body=new Element('body');
let apiCalls=0,launched='';
const context={
 window:{DSD_API:{request:async()=>{apiCalls++;throw Object.assign(Error('old server'),{status:404});}}},
 document:{body,createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})},
 navigator:{userAgent:'Android'},location:{set href(url){launched=url;}},URL,
};
vm.runInNewContext(fs.readFileSync('dsd/assets/js/messages.js','utf8'),context);
function all(n){return [n,...(n.children||[]).flatMap(all)];}
(async()=>{
 await context.window.DSDMessages.open({id:'s1',status:'pending',company:'고객'},'scheduled');
 const nodes=all(body),button=nodes.find(n=>n.tagName==='button'&&n.textContent==='문자 앱 열기');
 assert(button);
 const callsBefore=apiCalls;
 button.click();
 assert.match(launched,/^sms:\?body=/);
 assert.equal(apiCalls,callsBefore); // No save request before navigation, including an old server.
 const phone=nodes.find(n=>n.tagName==='input'&&n.type==='tel');
 phone.value='010-1234-5678';launched='';button.click();
 assert.match(launched,/^sms:01012345678\?body=/);
 phone.value='번호없음';launched='';button.click();
 assert.equal(launched,'');
 const feedback=nodes.find(n=>n.attrs?.role==='status');
 assert.match(feedback.textContent,/연락처/);assert(feedback.scrolled);
 console.log('Message button regression: empty contact, synchronous launch, no save dependency, visible validation feedback passed (DOM mock).');
})().catch(e=>{console.error(e);process.exitCode=1;});
