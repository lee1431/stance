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
  root.DDSM_CenterLink=Object.freeze({parse});
})(typeof window==='undefined'?globalThis:window);
