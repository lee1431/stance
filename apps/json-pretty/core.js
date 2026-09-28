(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  root.JsonPretty=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  function kindOf(value){
    if(value===null) return "null";
    if(Array.isArray(value)) return "배열";
    return {object:"객체",string:"문자열",number:"숫자",boolean:"불리언"}[typeof value]||typeof value;
  }

  function inspect(value){
    let keys=0,items=0,maxDepth=0;
    function walk(node,depth){
      maxDepth=Math.max(maxDepth,depth);
      if(Array.isArray(node)){
        items+=node.length;
        node.forEach(item=>walk(item,depth+1));
      }else if(node&&typeof node==="object"){
        const names=Object.keys(node);
        keys+=names.length;
        names.forEach(name=>walk(node[name],depth+1));
      }
    }
    walk(value,0);
    return {rootType:kindOf(value),keys,items,depth:maxDepth};
  }

  function locateError(text,error){
    const match=String(error&&error.message||"").match(/position\s+(\d+)/i);
    const position=match?Math.min(Number(match[1]),text.length):text.length;
    const before=text.slice(0,position);
    const lines=before.split("\n");
    return {position,line:lines.length,column:lines[lines.length-1].length+1};
  }

  function transform(text,mode,indent){
    if(typeof text!=="string"||!text.trim()) return {ok:false,code:"EMPTY",message:"정리할 JSON을 입력해 주세요."};
    try{
      const value=JSON.parse(text);
      const space=indent==="tab"?"\t":Math.max(1,Math.min(8,Number(indent)||2));
      const output=mode==="minify"?JSON.stringify(value):JSON.stringify(value,null,space);
      return {ok:true,output,stats:inspect(value),bytes:new TextEncoder().encode(output).length};
    }catch(error){
      const at=locateError(text,error);
      return {ok:false,code:"INVALID",message:`JSON 문법을 확인해 주세요 · ${at.line}행 ${at.column}열`,...at};
    }
  }

  return {transform,inspect,locateError};
});
