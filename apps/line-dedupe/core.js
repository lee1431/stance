(function(root){
'use strict';
function dedupe(text,{trim=true,skipBlank=true}={}){
 if(typeof text!=='string')throw new Error('텍스트를 입력해 주세요.');
 if(text.length>200000)throw new Error('한 번에 200,000자까지 정리할 수 있어요. 목록을 나누어 넣어 주세요.');
 if(!text.length)return {text:'',total:0,kept:0,duplicates:0,blanks:0};
 const lines=text.replace(/\r\n?/g,'\n').split('\n');
 if(lines.length>10000)throw new Error('한 번에 10,000줄까지 정리할 수 있어요.');
 const seen=new Set(),out=[];let duplicates=0,blanks=0;
 for(let line of lines){if(trim)line=line.trim();if(skipBlank&&!line.trim()){blanks++;continue;}if(seen.has(line)){duplicates++;continue;}seen.add(line);out.push(line);}
 return {text:out.join('\n'),total:lines.length,kept:out.length,duplicates,blanks};
}
if(typeof module!=='undefined'&&module.exports)module.exports=dedupe;else root.dedupeLines=dedupe;
})(typeof window==='undefined'?globalThis:window);
