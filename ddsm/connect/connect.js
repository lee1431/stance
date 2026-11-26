(() => {
  'use strict';
  const API='https://mrdindoin.ddns.net/ddsm/api/connection/';
  const status=document.getElementById('status'),retry=document.getElementById('retry');
  const params=new URLSearchParams(location.hash.slice(1));
  let busy=false;
  async function connect(){
    if(busy)return;busy=true;retry.hidden=true;status.textContent='기기 연결 중…';
    try{
      const admin=params.get('admin'),center=params.get('center'),invite=params.get('invite');
      if(admin&&!center&&!invite){
        if(!/^[A-Za-z0-9_-]{43,128}$/.test(admin))throw Error('관리자 연결 링크가 올바르지 않습니다.');
        const res=await fetch(API+'centers',{credentials:'omit',cache:'no-store',headers:{Authorization:'Bearer adm_'+admin}});
        const data=await res.json().catch(()=>null);
        if(!res.ok||!data?.ok)throw Error(data?.error||'관리자 연결 실패');
        localStorage.setItem('ddsm:center:admin:v1',admin);
        location.replace('../admin/');return;
      }
      if(!admin&&center&&invite){
        await window.DDSM_CenterLink.connect(location.href,location.origin);
        location.replace('../');return;
      }
      throw Error('센터에서 전달받은 연결 링크 또는 QR코드를 사용하세요.');
    }catch(e){status.textContent=e.message||'연결 실패';retry.hidden=false;}
    finally{busy=false;}
  }
  retry.addEventListener('click',connect);void connect();
})();
