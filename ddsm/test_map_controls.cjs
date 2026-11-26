const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),{url:'https://llsshh.com/ddsm/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window,d=w.document,$=id=>d.getElementById(id);
const markers=[],fitCalls=[],centers=[],zooms=[],notices=[];
let watches=0,cleared=[],success,failure;
Object.defineProperty(w.navigator,'geolocation',{value:{
  watchPosition(ok,err,opts){success=ok;failure=err;watches++;assert.equal(opts.enableHighAccuracy,true);return watches;},
  clearWatch(id){cleared.push(id);}
}});
class LatLng{constructor(lat,lng){this.a=lat;this.b=lng;}lat(){return this.a;}lng(){return this.b;}}
class Marker{constructor(opts){Object.assign(this,opts);markers.push(this);}setMap(map){this.map=map;}getPosition(){return this.position;}setPosition(p){this.position=p;}setIcon(i){this.icon=i;}setTitle(t){this.title=t;}}
class Bounds{constructor(){this.points=[];}extend(p){this.points.push(p);}}
class MapMock{constructor(){this.handlers={};}setCenter(p){centers.push(p);}setZoom(n){zooms.push(n);}fitBounds(b,p){fitCalls.push({b,p});}}
const n={LatLng,Marker,LatLngBounds:Bounds,Map:MapMock,Point:class{},Size:class{},Position:{TOP_RIGHT:1},Event:{addListener(){},trigger(){}}};
w.DDSM_NaverMap={loadSdk:async()=>n};
w.eval(fs.readFileSync(path.join(__dirname,'delivery-map.js'),'utf8'));
const dm=w.DDSM_DeliveryMap;
const stops=[{id:'a',roundNo:1,position:1,lat:36.99,lng:127.92},{id:'b',roundNo:1,position:2,lat:36.98,lng:127.91}];
(async()=>{
 await dm.render('2026-11-26',stops,{},1);
 assert.equal(watches,0);
 assert.equal(dm.fitAll(),true);
 assert.equal(fitCalls.at(-1).b.points.length,2);
 dm.locate(msg=>notices.push(msg));assert.equal(watches,1);
 success({coords:{latitude:37,longitude:127}});
 assert.equal($('mapLocate').getAttribute('aria-pressed'),'true');
 assert.equal(centers.at(-1).lat(),37);
 const currentMarker=markers.find(m=>m.zIndex===1000);
 assert.ok(currentMarker);
 const centerCount=centers.length;
 success({coords:{latitude:37.01,longitude:127.01}});
 assert.equal(currentMarker.getPosition().lat(),37.01);
 assert.equal(centers.length,centerCount);
 dm.locate(msg=>notices.push(msg));assert.equal(watches,1);assert.equal(centers.at(-1).lat(),37.01);
 assert.equal(dm.fitAll(),true);assert.equal(fitCalls.at(-1).b.points.length,2);
 await dm.render('2026-11-26',[{id:'c',roundNo:2,position:1,lat:36.9,lng:127.8}],{},2);
 assert.equal(dm.fitAll(),true);assert.equal(centers.at(-1).lat(),36.9);
 assert.equal(markers.filter(m=>m.map&&m.zIndex!==1000).length,1);
 dm.pause();assert.deepEqual(cleared,[1]);assert.equal(currentMarker.map,null);
 assert.equal($('mapLocate').getAttribute('aria-pressed'),'false');
 success({coords:{latitude:38,longitude:128}});assert.equal(currentMarker.map,null);
 await dm.render('2026-11-26',[],{},3);assert.equal(dm.fitAll(),false);
 dm.locate(msg=>notices.push(msg));failure({code:1});assert.match(notices.at(-1),/권한/);
 assert.deepEqual(cleared,[1,2]);
 console.log('Map control tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>dom.window.close());
