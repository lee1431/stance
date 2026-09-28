'use strict';
const KEY='yame-unit-price-v1';
const units={mass:[['g',1],['kg',1000]],volume:[['mL',1],['L',1000]],count:[['개',1]]};
const bases={mass:100,volume:100,count:1};
const labels={mass:'100g',volume:'100mL',count:'1개'};
const example=()=>({dimension:'volume',items:[{name:'생수 A',price:'12000',amount:'500',unit:'mL',count:'20'},{name:'생수 B',price:'6900',amount:'2',unit:'L',count:'6'}]});
let state=example(),storageOK=true;
try{const saved=JSON.parse(localStorage.getItem(KEY));if(saved&&units[saved.dimension]&&Array.isArray(saved.items)&&saved.items.length>=2&&saved.items.length<=4&&saved.items.every(x=>x&&['name','price','amount','unit','count'].every(k=>typeof x[k]==='string')&&units[saved.dimension].some(u=>u[0]===x.unit)))state=saved;}catch{}
const $=s=>document.querySelector(s),fmt=n=>n.toLocaleString('ko-KR',{maximumFractionDigits:2});
function calculate(item,dimension){const p=Number(item.price),a=Number(item.amount),c=Number(item.count),unit=units[dimension].find(u=>u[0]===item.unit);if(!item.price.trim()||!item.amount.trim()||!item.count.trim()||!Number.isFinite(p)||!Number.isFinite(a)||!Number.isSafeInteger(c)||p<0||a<=0||c<=0||!unit)return null;const total=a*c*unit[1],value=p/total*bases[dimension];return Number.isFinite(total)&&total>0&&Number.isFinite(value)?value:null;}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{storageOK=false;}$('#storage').textContent=storageOK?'입력 내용은 이 기기에 자동 저장됩니다.':'브라우저 저장을 사용할 수 없어 이번 화면에서만 유지됩니다.';}
function render(){
 $('#dimension').value=state.dimension;$('#cards').replaceChildren();
 state.items.forEach((item,i)=>{const card=document.createElement('article');card.className='product';card.innerHTML='<div class="product-head"><input class="name" maxlength="40"><button class="remove" type="button">×</button></div><div class="fields"><label>총 결제금액 (원)<input data-key="price" type="number" min="0" step="any" inputmode="decimal" placeholder="예: 12000"></label><label>한 개 용량 / 수량<div class="unit-row"><input data-key="amount" type="number" min="0" step="any" inputmode="decimal" placeholder="예: 500"><select data-key="unit"></select></div></label><label>묶음 개수<input data-key="count" type="number" min="1" step="1" inputmode="numeric" placeholder="예: 20"></label></div><p class="unit-price"></p><div class="badge"></div>';
 const name=card.querySelector('.name');name.value=item.name;name.setAttribute('aria-label',`상품 ${i+1} 이름`);name.addEventListener('input',()=>{item.name=name.value;save();update();});
 const remove=card.querySelector('.remove');remove.setAttribute('aria-label',`상품 ${i+1} 삭제`);remove.disabled=state.items.length<=2;remove.onclick=()=>{state.items.splice(i,1);save();render();};
 const select=card.querySelector('select');select.setAttribute('aria-label',`상품 ${i+1} 용량 단위`);units[state.dimension].forEach(([u])=>select.add(new Option(u,u)));
 card.querySelectorAll('[data-key]').forEach(input=>{input.value=item[input.dataset.key];input.addEventListener('input',()=>{item[input.dataset.key]=input.value;save();update();});});$('#cards').append(card);
 });$('#add').disabled=state.items.length>=4;update();
}
function update(){const values=state.items.map(x=>calculate(x,state.dimension)),valid=values.filter(x=>x!==null),best=valid.length?Math.min(...valid):null;const winners=[];
 [...$('#cards').children].forEach((card,i)=>{const value=values[i],win=value!==null&&valid.length>=2&&Math.abs(value-best)<1e-9;card.classList.toggle('best',win);if(win)winners.push(state.items[i].name||`상품 ${i+1}`);const output=card.querySelector('.unit-price');output.textContent=value===null?'입력을 확인하세요':`${fmt(value)}원`;if(value!==null){const small=document.createElement('small');small.textContent=` / ${labels[state.dimension]}`;output.append(small);}card.querySelector('.badge').textContent=value===null?'금액 0 이상 · 용량 양수 · 묶음은 양의 정수':win?'✓ 가장 낮은 단가':valid.length>=2?`최저가보다 ${fmt(value-best)}원 높아요`:'';});
 const r=$('#result');r.replaceChildren();if(valid.length<2){r.textContent='상품 2개 이상의 가격·용량·묶음 개수를 입력해주세요.';return;}const title=document.createElement('strong');title.textContent=winners.length>1?`${winners.join(', ')} · 공동 최저 단가`:`${winners[0]}의 단가가 가장 낮아요`;r.append(title,document.createElement('br'));const max=Math.max(...valid),percent=max===0?0:(max-best)/max*100;r.append(`가장 비싼 상품의 단가보다 ${fmt(percent)}% 저렴해요.${valid.length<values.length?' 입력을 마친 상품끼리 비교한 결과입니다.':''}`);
}
$('#dimension').onchange=e=>{state.dimension=e.target.value;state.items.forEach(x=>{x.unit=units[state.dimension][0][0];x.amount='';});save();render();};
$('#add').onclick=()=>{if(state.items.length>=4)return;state.items.push({name:`상품 ${state.items.length+1}`,price:'',amount:'',unit:units[state.dimension][0][0],count:'1'});save();render();};
$('#sample').onclick=()=>{state=example();save();render();};
$('#reset').onclick=()=>{state={dimension:state.dimension,items:[1,2].map(n=>({name:`상품 ${n}`,price:'',amount:'',unit:units[state.dimension][0][0],count:'1'}))};save();render();};
let deferred;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;$('#install').hidden=false;});$('#install').onclick=async()=>{if(!deferred)return;await deferred.prompt();deferred=null;$('#install').hidden=true;};window.addEventListener('appinstalled',()=>$('#install').hidden=true);
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
render();
