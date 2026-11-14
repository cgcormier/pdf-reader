import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { attachFocusExitCue } from '../src/focus-exit-cue.js';
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const classes = () => {const values=new Set();return {add:v=>values.add(v),remove:v=>values.delete(v),contains:v=>values.has(v)};};
function fakeDocument() {
  const doc = new EventTarget();
  doc.createElement=()=>({classList:classes(),attributes:{},setAttribute(k,v){this.attributes[k]=v;},remove(){this.removed=true;}});
  doc.body={classList:classes(),append(node){doc.cue=node;}};
  return doc;
}
test('cue shows once per mode entry, fades, and hides on exit',async()=> {
  const doc=fakeDocument();const controller=attachFocusExitCue({document:doc,delay:25,fade:5});
  assert.equal(doc.cue.hidden,true);
  doc.body.classList.add('focus-mode');doc.dispatchEvent(new Event('reader-focus-change'));
  assert.equal(doc.cue.textContent,'Esc to leave focus');assert.equal(doc.cue.hidden,false);
  assert.equal(doc.cue.attributes['aria-hidden'],'true');
  await sleep(40);assert.equal(doc.cue.hidden,true);
  doc.dispatchEvent(new Event('reader-focus-change'));assert.equal(doc.cue.hidden,true,'redundant event must not revive reminder');
  doc.body.classList.remove('focus-mode');doc.dispatchEvent(new Event('reader-focus-change'));
  doc.body.classList.add('focus-mode');doc.dispatchEvent(new Event('reader-focus-change'));assert.equal(doc.cue.hidden,false);
  doc.body.classList.remove('focus-mode');doc.dispatchEvent(new Event('reader-focus-change'));assert.equal(doc.cue.hidden,true);
  controller.destroy();
});
test('immersive change replaces cue and cleanup cancels timers/listeners',async()=> {
  const doc=fakeDocument();doc.body.classList.add('focus-mode');
  const controller=attachFocusExitCue({document:doc,delay:20,fade:5});
  doc.body.classList.add('immersive-mode');doc.dispatchEvent(new Event('reader-immersive-change'));
  assert.equal(doc.cue.textContent,'Esc to leave immersive reading');
  doc.body.classList.remove('immersive-mode');doc.dispatchEvent(new Event('reader-immersive-change'));
  assert.equal(doc.cue.textContent,'Esc to leave focus');
  controller.destroy();assert.equal(doc.cue.removed,true);
  doc.body.classList.remove('focus-mode');doc.dispatchEvent(new Event('reader-focus-change'));
  await sleep(35);assert.equal(doc.cue.hidden,false,'destroy cleared future timer work');
});
test('cue styling is non-interactive, fixed and motion-reduced',async()=> {
  const css=await readFile(new URL('../src/focus-exit-cue.css',import.meta.url),'utf8');
  assert.match(css,/position: fixed/);assert.match(css,/pointer-events: none/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
});
test('touch cue names an available exit rather than requiring a keyboard',()=> {
  const doc=fakeDocument();
  doc.defaultView={matchMedia:()=>({matches:true})};
  doc.body.classList.add('focus-mode');
  const controller=attachFocusExitCue({document:doc});
  assert.equal(doc.cue.textContent,'Tap focus icon to exit');
  doc.body.classList.add('immersive-mode');
  doc.dispatchEvent(new Event('reader-immersive-change'));
  assert.equal(doc.cue.textContent,'Tap page number to exit');
  controller.destroy();
});
