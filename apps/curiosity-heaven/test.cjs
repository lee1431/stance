// Run with node apps/curiosity-heaven/test.cjs; no writes to production.
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const code = fs.readFileSync(__dirname + "/app.js", "utf8");
class Element {
  constructor() { this.children = []; this.value = ""; this.textContent = ""; this.events = {}; }
  replaceChildren() { this.children = []; }
  append(...children) { this.children.push(...children); }
  setAttribute() {}
  addEventListener(event, handler) { this.events[event] = handler; }
}
function setup(fetch, storage) {
  const elements = Object.fromEntries(["filters","cards","search","count","status","refresh","more","random"].map(id=>["#"+id,new Element()]));
  const opened = [], ctx = {
    document: {querySelector:s=>elements[s],createElement:()=>new Element(),addEventListener(){},hidden:false},
    fetch, AbortController, URL, Intl, console: {error(){}}, Date, Math,
    setTimeout: (fn, ms)=>setTimeout(fn, ms < 10000 ? 0 : ms), clearTimeout, setInterval(){},
    localStorage: storage || {getItem(){return null;},setItem(){}},
    window: {open:(...args)=>opened.push(args)}
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return {ctx,elements,opened};
}
const tick = async state => {
  for(let i=0;i<200;i++) { if (!vm.runInContext("loading", state.ctx)) return; await new Promise(r=>setTimeout(r,2)); }
  throw new Error("Load did not settle");
};
function response(rows,page,size=200) {
  return {ok:true,status:200,json:async()=>({ok:true,data:{items:rows.slice((page-1)*size,page*size),page,page_size:size,total:rows.length,has_more:page*size<rows.length}})};
}
const rows = Array.from({length:450},(_,i)=>({id:String(i),created_at:1791976756,data:{question:"질문 "+i+"?",category:i%2?"홀수":"짝수",date_key:"2026-10-14"}}));
(async()=>{
  const calls=[];
  const s=setup(async url=>{const p=Number(new URL(url).searchParams.get("page"));calls.push(p);return response(rows,p);});
  await tick(s);
  assert.equal(vm.runInContext("items.length",s.ctx),450);
  assert.deepEqual(calls,[1,2,3,1]);
  assert.equal(s.elements["#cards"].children.length,60);
  s.elements["#search"].value="질문 449";s.elements["#search"].events.input();
  assert.equal(s.elements["#cards"].children.length,1);
  assert.equal(s.elements["#cards"].children[0].href,"https://www.google.com/search?q="+encodeURIComponent("질문 449?"));
  s.elements["#random"].onclick(); assert.equal(s.opened[0][0],s.elements["#cards"].children[0].href);
  s.elements["#search"].value="";s.elements["#search"].events.input();
  s.elements["#filters"].children.find(x=>x.textContent==="홀수").onclick();
  assert.match(s.elements["#count"].textContent,/225/);
  s.elements["#more"].onclick();assert.equal(s.elements["#cards"].children.length,120);
  const dup=vm.runInContext('normalizeRows([{data:{question:"Ａ 질문?",category:"a"}},{data:{question:"a질문 !",category:"b"}},{data:{question:123,category:"a"}}])',s.ctx);
  assert.equal(dup.items.length,1);assert.equal(dup.duplicates,1);assert.equal(dup.invalid,1);
  let growingCalls=0;
  const growing=setup(async url=>{
    const p=Number(new URL(url).searchParams.get("page"));growingCalls++;
    return response(growingCalls===1?rows.slice(0,400):rows,p);
  });
  await tick(growing);assert.equal(vm.runInContext("items.length",growing.ctx),450);
  assert.equal(growingCalls,6);
  const empty=setup(async()=>response([],1));await tick(empty);
  assert.equal(vm.runInContext("items.length",empty.ctx),0);assert.equal(empty.elements["#random"].disabled,true);
  const bad=setup(async url=> url.startsWith("./") ? {ok:true,json:async()=>JSON.parse(fs.readFileSync(__dirname+"/seeds.json"))} :
    {ok:true,json:async()=>({ok:true,data:{items:[rows[0]],page:1,page_size:200,total:3,has_more:false}})});
  await tick(bad);assert.match(bad.elements["#status"].textContent,/初|초기 질문 50/);
  assert.equal(vm.runInContext("items.length",bad.ctx),50);
  const cached=setup(async()=>{throw new Error("offline")},{getItem:()=>JSON.stringify({items:rows.map(r=>r.data),saved_at:"2026-10-14T00:00:00Z"}),setItem(){throw new Error("quota");}});
  await tick(cached);assert.equal(vm.runInContext("items.length",cached.ctx),450);
  assert.match(cached.elements["#status"].textContent,/가져오지 못했습니다/);
  const repeated=setup(async url=>{
    const p=Number(new URL(url).searchParams.get("page"));
    if(p===1)return response(rows,1);
    return {ok:true,json:async()=>({ok:true,data:{items:rows.slice(0,200),page:p,page_size:200,total:450,has_more:true}})};
  },{getItem:()=>JSON.stringify({items:[],saved_at:"2026-10-14"}),setItem(){}});
  await tick(repeated);assert.match(repeated.elements["#status"].textContent,/가져오지 못했습니다/);
  console.log("PASS: 450 rows / 3 pages, growth restart, search, categories, random, links, more cards, deduplication, invalid data, empty, incomplete/repeated pages, fallback and cache");
})().catch(error=>{console.error(error);process.exitCode=1;});
