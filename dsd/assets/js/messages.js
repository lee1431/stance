/* Prepare delivery messages. No sending, delivery receipts or customer storage in the browser. */
(function () {
  'use strict';
  const API = window.DSD_API;
  const text = value => String(value ?? '').trim();
  function amount(value) {
    const raw = text(value).replace(/[,\s₩원]/g, '');
    return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
  }
  function payment(fields) {
    const value = text(fields.freight_payment_type || fields.payment_type).toLowerCase().replace(/\s/g, '');
    if (['착불','수취인부담','받는분부담','받는사람부담','cod','collect','수취'].includes(value)) return 'collect';
    if (['선불','선결제','선지불','발송인부담','보내는분부담','현불','prepaid','paid'].includes(value)) return 'prepaid';
    // A generic freight amount is never evidence of collect payment.
    return 'unknown';
  }
  const digits = phone => text(phone).replace(/[\s()-]/g, '');
  function validPhone(phone) { return /^\+?\d{8,15}$/.test(digits(phone)); }
  function buildMessage(kind, items, profile, place) {
    const lines = kind === 'done' ? ['배송 완료되었습니다.'] : ['안녕하세요. 배송기사입니다.','금일 배송 예정입니다.'];
    let total = 0, missing = false, unknown = false, collect = false;
    items.forEach((item,index) => {
      const f = item.fields;
      if (items.length > 1) lines.push('', '['+(index+1)+'번 물품]');
      lines.push('발송인: '+(text(f.sender_name)||'확인 필요'));
      lines.push('물품명: '+(text(f.item_name)||'확인 필요'));
      if (text(item.waybill)) lines.push('운송장: '+text(item.waybill));
      const type = payment(f);
      if (type === 'unknown') unknown = true;
      if (type === 'collect' && (kind !== 'done' || !item.collected)) {
        collect = true;
        const fee = amount(f.freight_amount ?? f.cod_amount);
        if (fee === null) missing = true;
        else {total += fee;if(!Number.isSafeInteger(total))missing=true;}
      }
    });
    if (kind === 'done' && text(place)) lines.push('보관 장소: '+text(place));
    if (collect) {
      const fee = missing ? '금액 확인 필요' : total.toLocaleString('ko-KR')+'원';
      lines.push('', (kind === 'done' ? '미수 착불 운임: ' : '착불 운임: ')+fee);
      if (kind === 'done') {
        lines.push('입금 부탁드립니다.');
        if (text(profile.bank) && text(profile.account) && text(profile.holder))
          lines.push('입금 계좌: '+text(profile.bank)+' '+text(profile.account)+' / 예금주 '+text(profile.holder));
        else lines.push('입금 계좌: 확인 필요');
      }
    }
    lines.push('감사합니다.');
    return {body:lines.join('\n'),missing,unknown,collect,
      accountMissing:kind==='done' && collect && !(text(profile.bank)&&text(profile.account)&&text(profile.holder))};
  }
  function smsUrl(phone,body,agent=navigator.userAgent) {
    const separator = /iPhone|iPad|iPod/i.test(agent) ? '&' : '?';
    return 'sms:'+digits(phone)+separator+'body='+encodeURIComponent(body);
  }
  // Expose pure composition functions for focused validation and future native integration.
  window.DSDMessageTools = Object.freeze({amount,payment,buildMessage,smsUrl,validPhone});
  function node(tag, cls, content) {
    const n = document.createElement(tag); if(cls)n.className=cls;
    if(content !== undefined)n.textContent=content; return n;
  }
  function button(label,fn,cls='secondary') {
    const b=node('button',cls,label); b.type='button'; b.addEventListener('click',fn); return b;
  }
  let current = null;
  async function open(stop,kind) {
    if(current) return;
    const d=node('dialog','simple-dialog message-dialog');
    current=d;
    const header=node('div','dialog-header');
    header.append(node('h2','',kind==='done'?'완료문자':'배송 예정'),button('✕',()=>d.close(),'icon-button'));
    const root=node('div','message-fields');
    const status=node('p','message-help','물품 정보를 불러오는 중입니다.');
    root.append(status); d.append(header,root); document.body.append(d);
    let photoURL='';
    d.addEventListener('close',()=>{ if(photoURL)URL.revokeObjectURL(photoURL); d.remove(); if(current===d)current=null; });
    d.showModal();
    let items,profile,server=true;
    try {
      const [data,settings] = await Promise.all([
        API.request('stops/'+encodeURIComponent(stop.id)+'/message-data'),API.request('message-profile')]);
      items=data.items; profile=settings.profile;
    } catch(error) {
      if(!d.open)return;
      if(error.status!==404){ status.textContent=error.message; return; }
      server=false; profile={bank:'',account:'',holder:''};
      items=[{...stop,fields:{},collected:false,place:'',source_error:'SERVER_UPDATE'}];
    }
    if(!d.open)return;
    root.replaceChildren(status);
    status.textContent=server ? '같은 회차에서 전체 주소와 수취인 연락처가 일치하는 물품만 함께 표시합니다. 보낼 물품을 확인하세요.'
      : '서버 업데이트가 필요합니다. 지금은 직접 입력해 문자를 작성할 수 있으며 수금·계좌 정보는 저장되지 않습니다.';
    const selected=items[0];
    let dirty=false,saving=false,photo=null;
    const rows=[];
    function input(label,value,type='text',max=150) {
      const l=node('label','message-label',label),i=node('input');i.type=type;i.value=value||'';i.maxLength=max;
      l.append(i);root.append(l);return i;
    }
    const phone=input('받는 분 연락처',selected.fields.recipient_phone,'tel',30);
    const boxes=node('div','message-items');root.append(boxes);
    for(const item of items){
      const box=node('fieldset','message-item');
      const legend=node('legend');
      const include=node('input');include.type='checkbox';
      include.checked=item.id===stop.id || (kind==='done'?item.status==='done':item.status!=='done');
      const includeLabel=node('label','message-check');includeLabel.append(include,document.createTextNode(' '+(item.company||'물품')+' · '+(item.waybill||'운송장 없음')));legend.append(includeLabel);box.append(legend);
      function field(label,value){const l=node('label','message-label',label),i=node('input');i.value=text(value);i.maxLength=150;l.append(i);box.append(l);return i;}
      const sender=field('발송인',item.fields.sender_name),name=field('물품명',item.fields.item_name);
      const payLabel=node('label','message-label','운임 결제 구분'),pay=node('select');
      for(const [v,t] of [['unknown','확인 필요'],['prepaid','선불'],['collect','착불']]){const o=node('option','',t);o.value=v;pay.append(o);}
      pay.value=payment(item.fields);payLabel.append(pay);box.append(payLabel);
      const fee=field('착불 운임 (원)',item.fields.freight_amount ?? item.fields.cod_amount);fee.inputMode='numeric';
      const paidLabel=node('label','message-check'),paid=node('input');paid.type='checkbox';paid.checked=item.collected;
      paidLabel.append(paid,document.createTextNode(' 수금 완료 (완료문자 입금 요청 제외)'));box.append(paidLabel);
      function updatePay(){fee.disabled=pay.value!=='collect';paid.disabled=pay.value!=='collect';}
      updatePay();pay.addEventListener('change',updatePay);
      if(item.source_error)box.append(node('small','message-warning','원본 정보가 없어 직접 확인이 필요합니다.'));
      rows.push({item,include,sender,name,pay,fee,paid});boxes.append(box);
      paid.addEventListener('change',()=>{dirty=true;});
    }
    const place=input('보관 장소 (완료문자)',selected.place);place.parentElement.hidden=kind!=='done';
    const bank=input('입금 은행',profile.bank,'text',50),account=input('계좌번호',profile.account,'text',80),holder=input('예금주',profile.holder,'text',80);
    for(const i of [bank,account,holder,place])i.addEventListener('input',()=>{dirty=true;});
    root.append(node('small','message-help','계좌·수금 여부·보관 장소는 서버에 저장합니다. 연락처·물품 정보의 수정은 이번 문자에만 적용됩니다.'));
    const warning=node('p','message-warning');root.append(warning);
    const previewLabel=node('label','message-label','문자 내용 (수정 가능)'),preview=node('textarea');preview.rows=12;preview.maxLength=10000;previewLabel.append(preview);root.append(previewLabel);
    function chosen(){return rows.filter(r=>r.include.checked).map(r=>({...r.item,collected:r.paid.checked,
      fields:{sender_name:r.sender.value,item_name:r.name.value,freight_payment_type:({collect:'착불',prepaid:'선불'})[r.pay.value]||'',freight_amount:r.fee.value}}));}
    function result(){return buildMessage(kind,chosen(),{bank:bank.value,account:account.value,holder:holder.value},place.value);}
    function refresh(){const r=result();preview.value=r.body;warning.textContent=[r.unknown?'운임 구분을 확인하세요.':'',r.missing?'착불 금액을 입력하세요.':'',r.accountMissing?'입금 계좌를 입력하세요.':''].filter(Boolean).join(' ');}
    root.addEventListener('input',e=>{if(e.target!==preview&&e.target.type!=='file')refresh();});
    root.addEventListener('change',e=>{if(e.target!==preview&&e.target.type!=='file')refresh();});
    refresh();
    function validate(){
      const r=result();
      if(!chosen().length)throw Error('보낼 물품을 선택하세요.');
      if(!validPhone(phone.value))throw Error('수취인 연락처를 확인하세요.');
      if(r.unknown||r.missing||r.accountMissing)throw Error('운임 구분·착불 금액·입금 계좌를 먼저 확인하세요.');
      if(chosen().some(i=>!text(i.fields.sender_name)||!text(i.fields.item_name)))throw Error('발송인과 물품명을 확인하세요.');
      if(!preview.value.trim())throw Error('문자 내용을 입력하세요.');
      if(kind==='done'&&chosen().some(i=>i.status!=='done'))throw Error('완료문자는 배송 완료 처리한 물품에만 보낼 수 있습니다.');
      return preview.value;
    }
    async function save(){
      if(!server)return;
      if(saving)throw Error('저장 중입니다. 잠시 후 다시 눌러주세요.');
      saving=true;
      try{
        await API.request('message-profile',{method:'PUT',body:{bank:bank.value.trim(),account:account.value.trim(),holder:holder.value.trim()}});
        for(const r of rows.filter(r=>r.include.checked))await API.request('stops/'+encodeURIComponent(r.item.id)+'/message-state',{
          method:'PUT',body:{collected:r.paid.checked,place:place.value.trim()}});
        dirty=false;status.textContent='계좌·수금 여부·보관 장소를 저장했습니다.';
      }finally{saving=false;}
    }
    const actions=node('div','message-actions');
    if(server)actions.append(button('계좌·수금·장소 저장',()=>save().catch(e=>{status.textContent=e.message;})));
    actions.append(button('문자 앱 열기',async()=>{
      try{const body=validate();await save();location.href=smsUrl(phone.value,body);
        status.textContent='문자 앱에서 받는 분과 내용을 확인하고 전송하세요. 실제 발송 여부는 DSD에서 확인할 수 없습니다.';
      }catch(e){status.textContent=e.message;}
    },'primary'));
    actions.append(button('내용 복사',async()=>{try{await navigator.clipboard.writeText(preview.value);status.textContent='문자 내용을 복사했습니다.';}catch(_){preview.focus();preview.select();status.textContent='선택된 문자 내용을 길게 눌러 복사하세요.';}}));
    if(kind==='done'){
      const file=input('배송 사진 선택 / 촬영','','file');file.accept='image/jpeg,image/png,image/webp';file.removeAttribute('maxlength');
      const image=node('img','message-photo');image.hidden=true;image.alt='선택한 배송 사진';root.append(image);
      file.addEventListener('change',()=>{
        if(photoURL)URL.revokeObjectURL(photoURL);photo=null;image.hidden=true;
        const f=file.files[0];if(!f)return;
        if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>10*1024*1024){status.textContent='10MB 이하 JPG·PNG·WebP 사진을 선택하세요.';file.value='';return;}
        photo=f;photoURL=URL.createObjectURL(f);image.src=photoURL;image.hidden=false;
      });
      actions.append(button('사진과 내용 공유',()=>{
        try{
          const body=validate();if(!photo)throw Error('배송 사진을 선택하세요.');
          if(server&&dirty)throw Error('계좌·수금·장소를 먼저 저장한 뒤 다시 눌러주세요.');
          const data={files:[photo],text:body};
          if(!navigator.canShare?.({files:[photo]})||!navigator.share)throw Error('이 환경에서는 사진 공유를 지원하지 않습니다. 내용을 복사하고 문자 앱에서 사진을 직접 첨부하세요.');
          navigator.share(data).then(()=>{if(d.open)status.textContent='공유 화면을 닫았습니다. 문자 앱에서 수취인과 사진·본문을 확인하세요. 발송 여부는 확인되지 않습니다.';})
            .catch(e=>{if(d.open&&e.name!=='AbortError')status.textContent='사진 공유 실패: 내용을 복사하고 문자 앱에서 사진을 직접 첨부하세요.';});
        }catch(e){status.textContent=e.message;}
      }));
      root.append(node('p','message-help','사진 공유에서 문자 앱을 선택한 뒤 수취인 번호와 사진·내용을 확인하세요. 앱에 따라 본문이 누락될 수 있어 내용 복사도 제공합니다. 사진은 MMS 요금이 적용될 수 있습니다. 선택한 사진은 DSD 서버에 업로드하지 않습니다.'));
    }
    root.append(actions,node('p','message-help','문자 앱을 열거나 공유해도 자동 전송되지 않으며 배송 상태도 바뀌지 않습니다. 긴 문자는 LMS로 전환될 수 있습니다.'));
  }
  window.DSDMessages=Object.freeze({open});
})();
