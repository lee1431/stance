(function(root){
'use strict';
const natural=new Intl.Collator('ko',{numeric:true,sensitivity:'variant'});
const plain=new Intl.Collator('ko',{numeric:false,sensitivity:'variant'});
function parseInput(value){
 const lines=String(value).split(/\r?\n/).map((text,index)=>({text:text.trim(),index:index+1})).filter(item=>item.text.length);
 if(!lines.length)throw new Error('한 줄 이상 입력해 주세요.');
 if(lines.length>20)throw new Error('한 번에 최대 20줄까지 비교할 수 있습니다.');
 if(lines.some(item=>[...item.text].length>60))throw new Error('한 줄은 60자 이하로 입력해 주세요.');
 return lines;
}
function sortItems(items){
 const copy=()=>items.map(item=>({...item}));
 const lexical=copy().sort((a,b)=>a.text<b.text?-1:a.text>b.text?1:0);
 const naturalOrder=copy().sort((a,b)=>natural.compare(a.text,b.text));
 const numeric=copy().sort((a,b)=>{
  const an=Number(a.text),bn=Number(b.text),af=Number.isFinite(an)&&a.text!=='' ,bf=Number.isFinite(bn)&&b.text!=='';
  if(af&&bf)return an-bn;
  if(af!==bf)return af?-1:1;
  return plain.compare(a.text,b.text);
 });
 return {lexical,natural:naturalOrder,numeric};
}
if(typeof module!=='undefined'&&module.exports)module.exports={parseInput,sortItems};
if(!root||!root.document)return;
const d=root.document,$=s=>d.querySelector(s),input=$('#sort-input');
if(!input)return;
const ids={lexical:$('#sort-lexical'),natural:$('#sort-natural'),numeric:$('#sort-numeric')};
const status=$('#sort-status'),run=$('#sort-run'),example=$('#sort-example'),reset=$('#sort-reset');
const samples=['파일2','파일10','파일1','10','2','1','사과2','사과10','사과2'];
function render(list,target){target.replaceChildren(...list.map(item=>{const li=d.createElement('li'),span=d.createElement('span'),small=d.createElement('small');span.textContent=item.text;small.textContent='입력 '+item.index+'번';li.append(span,small);return li;}));}
function clearResults(){for(const target of Object.values(ids)){const li=d.createElement('li');li.className='placeholder';li.textContent='아직 결과 없음';target.replaceChildren(li);}}
function calculate(){
 try{const items=parseInput(input.value),sets=sortItems(items);for(const key of Object.keys(ids))render(sets[key],ids[key]);status.textContent=items.length+'개 항목을 세 규칙으로 정렬했습니다. 같은 값은 입력 줄 순서를 유지합니다.';status.classList.remove('error');}
 catch(error){clearResults();status.textContent=error.message;status.classList.add('error');}
}
example.disabled=false;run.disabled=false;reset.disabled=false;
example.addEventListener('click',()=>{input.value=samples.join('\n');calculate();});
run.addEventListener('click',calculate);
reset.addEventListener('click',()=>{input.value='';clearResults();status.textContent='항목을 입력하거나 예시를 채워 보세요.';status.classList.remove('error');input.focus();});
})(typeof window!=='undefined'?window:null);
