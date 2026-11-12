import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source=(await readFile(new URL('../src/immersive-focus.js',import.meta.url),'utf8')).replace("import './immersive-focus.css';",'');
const {attachImmersiveFocus}=await import(`data:text/javascript,${encodeURIComponent(source)}`);
function fixture(overrides = {}) {
 const listeners=new Map(); const nodes=new Map(); const classes=new Set();
 for(const id of ['immersive-button','immersive-page-number','reading-area','focus-button','modal'])nodes.set(id,{hidden:true,attrs:{},addEventListener(type,fn){this[type]=fn;},setAttribute(k,v){this.attrs[k]=v;},focus(){this.focused=true;}});
 const doc={body:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}},fullscreenElement:null,documentElement:{},getElementById:id=>nodes.get(id),addEventListener:(type,fn)=>listeners.set(type,fn),dispatchEvent(){}};
 globalThis.document=doc; globalThis.CustomEvent=class {constructor(type,detail){this.type=type;this.detail=detail;}};
 let focus=false, settled=0;
 const controller=attachImmersiveFocus({setFocus:v=>{focus=v;},beforeChange:async()=>{settled++;},...overrides});
 return {doc,nodes,classes,listeners,controller,get focus(){return focus},get settled(){return settled}};
}
test('immersive viewport works without fullscreen API and exits cleanly',async()=>{
 const f=fixture(); await f.controller.enter(); assert.equal(f.focus,true); assert.ok(f.classes.has('immersive-mode')); assert.equal(f.nodes.get('immersive-page-number').hidden,false);
 await f.controller.exit();assert.equal(f.focus,false);assert.equal(f.nodes.get('immersive-page-number').hidden,true); assert.equal(f.settled,2);
});
test('native fullscreen rejection keeps a usable immersive viewport',async()=>{
 const f=fixture();f.doc.documentElement.requestFullscreen=async()=>{throw Error('denied')};await f.controller.enter();assert.equal(f.controller.active,true);await f.controller.exit();assert.equal(f.controller.active,false);
});
test('keyboard handler leaves editable targets, modals and repeated keys alone',async()=>{
 const f=fixture(); await f.controller.enter(); const key=f.listeners.get('keydown');
 for(const target of [{tagName:'INPUT'},{tagName:'TEXTAREA'},{tagName:'DIV',isContentEditable:true}]) key({key:'f',target});
 key({key:'f',target:{tagName:'BODY'},repeat:true}); f.nodes.get('modal').open=true;key({key:'Escape',target:{tagName:'BUTTON'}});
 assert.equal(f.controller.active,true);
});
test('native fullscreen exit clears immersive state',async()=>{
 const f=fixture();f.doc.documentElement.requestFullscreen=async()=>{f.doc.fullscreenElement={};};await f.controller.enter();f.doc.fullscreenElement=null;f.listeners.get('fullscreenchange')();await new Promise(r=>setTimeout(r,0));assert.equal(f.controller.active,false);
});

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setTimeout(r, 0));
test('native fullscreen is requested synchronously before layout settles', async () => {
 const layout=deferred(); const f=fixture({beforeChange:()=>layout.promise}); let requested=false;
 f.doc.documentElement.requestFullscreen=()=>{requested=true; return Promise.reject(Error('denied'));};
 const entry=f.controller.enter(); assert.equal(requested,true); assert.equal(f.controller.active,false);
 layout.resolve(); await entry; assert.equal(f.controller.active,true); await f.controller.exit();
});
test('exit serializes behind async focus entry without a stale active event', async () => {
 const focusGate=deferred(); const values=[]; const events=[];
 const f=fixture({setFocus:async value=>{if(value) await focusGate.promise; values.push(value);}});
 f.doc.dispatchEvent=event=>events.push(event.detail.detail.active);
 const entry=f.controller.enter(); await tick(); const leaving=f.controller.exit();
 focusGate.resolve(); await Promise.all([entry,leaving]);
 assert.deepEqual(values,[true,false]); assert.deepEqual(events,[false]); assert.equal(f.controller.active,false);
 assert.equal(f.nodes.get('reading-area').focused,undefined);
});
test('entry during async exit is suppressed until cleanup completes', async () => {
 const exitGate=deferred(); const values=[];
 const f=fixture({setFocus:async value=>{if(!value) await exitGate.promise; values.push(value);}});
 await f.controller.enter(); const leaving=f.controller.exit(); await tick(); const attempted=f.controller.enter();
 exitGate.resolve(); await Promise.all([leaving,attempted]); assert.deepEqual(values,[true,false]);
 await f.controller.enter(); assert.deepEqual(values,[true,false,true]); assert.equal(f.controller.active,true);
});
test('fullscreen resolution after exit is cleaned up', async () => {
 const native=deferred(); const f=fixture(); let exits=0;
 f.doc.documentElement.requestFullscreen=()=>native.promise;
 f.doc.exitFullscreen=async()=>{exits++;f.doc.fullscreenElement=null;};
 await f.controller.enter(); await f.controller.exit(); f.doc.fullscreenElement={}; native.resolve(); await tick();
 assert.equal(exits,1); assert.equal(f.doc.fullscreenElement,null); assert.equal(f.controller.active,false);
});
test('pending native request can be adopted by a new entry without stale teardown', async () => {
 const native=deferred(); const f=fixture(); let requests=0, exits=0;
 f.doc.documentElement.requestFullscreen=()=>{requests++;return native.promise;};
 f.doc.exitFullscreen=async()=>{exits++;f.doc.fullscreenElement=null;};
 await f.controller.enter(); await f.controller.exit(); await f.controller.enter();
 f.doc.fullscreenElement={}; native.resolve(); await tick();
 assert.equal(requests,1); assert.equal(exits,0); assert.equal(f.controller.active,true);
 await f.controller.exit(); assert.equal(exits,1);
});
