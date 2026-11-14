import test from 'node:test';
import assert from 'node:assert/strict';
import { attachDesignSwitcher } from '../src/design-switcher.js';
function fixture(value, deny=false) {
  const nodes=[]; let focused; const saved=[];
  globalThis.localStorage={getItem:()=>JSON.stringify(value),setItem:(k,v)=>{if(deny)throw Error('denied');saved.push([k,v]);}};
  function element(tag){const listeners={};const node={tag,dataset:{},children:[],attributes:{},open:false,setAttribute(k,v){this.attributes[k]=v;},append(...items){this.children.push(...items);},prepend(item){this.children.unshift(item);},addEventListener(k,fn){listeners[k]=fn;},fire(k,event={}){listeners[k]?.(event);},focus(){focused=this;},showModal(){this.open=true;},close(){this.open=false;this.fire('close');}};nodes.push(node);return node;}
  const host=element('header'); const doc={body:element('body'),createElement:element,querySelector:()=>host,getElementById:id=>nodes.find(n=>n.id===id)};
  return {doc,nodes,saved,focus:()=>focused};
}
test('live selection persists, isolates keyboard and restores trigger focus',()=>{
 const f=fixture('signal-studio'); const api=attachDesignSwitcher({document:f.doc});
 assert.equal(f.doc.body.dataset.readerDesign,'signal-studio');
 api.button.fire('click');assert.equal(api.dialog.open,true);assert.equal(f.focus().dataset.designChoice,'signal-studio');
 const common=f.nodes.find(n=>n.dataset.designChoice==='common-ground');common.fire('click');
 assert.equal(f.doc.body.dataset.readerDesign,'common-ground');assert.deepEqual(f.saved,[['folio:reader-design','"common-ground"']]);
 assert.equal(f.nodes.filter(n=>n.attributes['aria-pressed']==='true').length,1);
 let stopped=false;api.dialog.fire('keydown',{stopPropagation(){stopped=true;}});assert.equal(stopped,true);
 api.dialog.close();assert.equal(f.focus(),api.button);assert.equal(attachDesignSwitcher({document:f.doc}),null);
});
test('invalid saved value falls back and denied persistence reports visit-only selection',()=>{
 const f=fixture('injected-value',true);attachDesignSwitcher({document:f.doc});assert.equal(f.doc.body.dataset.readerDesign,'current');
 f.nodes.find(n=>n.dataset.designChoice==='margin-house').fire('click');
 assert.equal(f.doc.body.dataset.readerDesign,'margin-house');
 assert.match(f.nodes.find(n=>n.attributes.role==='status').textContent,/visit only/);
});
