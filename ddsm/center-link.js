(function(root){
  'use strict';
  function parse(raw,origin){
    let url;
    try{url=new URL(String(raw||'').trim());}catch(_){throw Error('기사 연결용 QR 또는 링크를 확인하세요.');}
    const p=new URLSearchParams(url.hash.slice(1));
    const center=p.get('center'),invite=p.get('invite');
    if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password||url.search||
       !['/ddsm/','/ddsm/connect/'].includes(url.pathname)||p.getAll('center').length!==1||p.getAll('invite').length!==1||
       [...p.keys()].some(k=>k!=='center'&&k!=='invite')||
       !/^[A-Za-z0-9-]{1,40}$/.test(center||'')||!/^[A-Za-z0-9_-]{43,128}$/.test(invite||'')){
      throw Error('센터의 기사 연결용 QR을 스캔하세요.');
    }
    return '/ddsm/connect/#'+new URLSearchParams({center,invite}).toString();
  }
  async function connect(raw,origin,storage=root.localStorage,fetcher=root.fetch.bind(root)){
    const target=parse(raw,origin);
    const p=new URLSearchParams(target.split('#')[1]),center=p.get('center'),invite=p.get('invite');
    const key='ddsm:device:v1:'+center;
    let device;
    try{
      device=storage.getItem(key);
      if(!/^[a-f0-9]{64}$/.test(device||'')){
        device=Array.from(root.crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
        storage.setItem(key,device);
      }
    }catch(_){throw Error('브라우저 저장소 접근 실패 · 일반 브라우저에서 다시 연결하세요.');}
    let res;
    try{
      res=await fetcher('https://mrdindoin.ddns.net/ddsm/api/connection/driver',{
        method:'POST',credentials:'omit',cache:'no-store',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({center,invite,device})
      });
    }catch(_){throw Error('센터 서버 연결 실패 · 인터넷 연결 및 서버 상태를 확인하세요.');}
    const data=await res.json().catch(()=>null);
    if(!res.ok||data?.ok!==true)throw Error((data?.error||'센터 인증 실패')+' (HTTP '+res.status+')');
    if(data.token!=='d_'+center+'_'+device)throw Error('센터 인증 응답이 올바르지 않습니다.');
    try{storage.setItem('ddsm:center:driver:v1',data.token);}
    catch(_){throw Error('로그인 정보를 저장하지 못했습니다. 브라우저 저장소를 확인하세요.');}
    return data.token;
  }
  async function connectCode(raw,storage=root.localStorage,fetcher=root.fetch.bind(root)){
    const code=String(raw||'').replace(/[\s-]/g,'');
    if(!/^[0-9]{8}$/.test(code))throw Error('숫자 8자리 센터 코드를 입력하세요.');
    async function request(value){
      let res;
      try{res=await fetcher('https://mrdindoin.ddns.net/ddsm/api/connection/code-login',{
        method:'POST',credentials:'omit',cache:'no-store',
        headers:{'Content-Type':'application/json'},body:JSON.stringify(value)
      });}catch(_){throw Error('센터 서버에 연결할 수 없습니다.');}
      const data=await res.json().catch(()=>null);
      if(res.status===404)throw Error('센터 서버 업데이트가 필요합니다.');
      if(!res.ok||data?.ok!==true)throw Error(data?.error||'센터 인증 실패 (HTTP '+res.status+')');
      return data;
    }
    const resolved=await request({code});
    const center=resolved.center;
    if(!/^[A-Za-z0-9-]{1,40}$/.test(center||''))throw Error('센터 정보가 올바르지 않습니다.');
    const key='ddsm:device:v1:'+center;
    let device;
    try{
      device=storage.getItem(key);
      if(!/^[a-f0-9]{64}$/.test(device||'')){
        device=Array.from(root.crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
        storage.setItem(key,device);
      }
    }catch(_){throw Error('브라우저 저장소에 접근할 수 없습니다.');}
    const data=await request({code,center,device});
    if(data.token!=='d_'+center+'_'+device)throw Error('센터 인증 응답이 올바르지 않습니다.');
    try{
      storage.setItem('ddsm:center:name:v1:'+center,String(data.name||resolved.name||center));
      storage.setItem('ddsm:center:driver:v1',data.token);
    }catch(_){throw Error('로그인 정보를 저장하지 못했습니다.');}
    return data.token;
  }
  root.DDSM_CenterLink=Object.freeze({parse,connect,connectCode});
})(typeof window==='undefined'?globalThis:window);
