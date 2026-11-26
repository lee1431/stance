const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const jsQR=require('./vendor/jsQR.js');
const dom=new JSDOM('<!doctype html><div id="qr"></div>',{runScripts:'outside-only'});
const w=dom.window;
w.eval(fs.readFileSync(path.join(__dirname,'vendor/qrcode.js'),'utf8'));
for(const length of [43,64,128]){
 const link='https://llsshh.com/ddsm/connect/#center=chungju&invite='+'a'.repeat(length);
 const qr=new w.QRCode(w.document.getElementById('qr'),{text:link,useSVG:true,correctLevel:w.QRCode.CorrectLevel.M});
 const m=qr._oQRCode,n=m.getModuleCount(),scale=6,width=(n+8)*scale;
 const rgba=new Uint8ClampedArray(width*width*4);rgba.fill(255);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(m.isDark(y,x))
   for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){
     const i=(((y+4)*scale+dy)*width+(x+4)*scale+dx)*4;
     rgba[i]=rgba[i+1]=rgba[i+2]=0;
   }
 assert.equal(jsQR(rgba,width,width,{inversionAttempts:'attemptBoth'})?.data,link);
}
dom.window.close();console.log('Actual QR encode/decode roundtrip OK');
