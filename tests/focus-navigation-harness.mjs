const frame=document.querySelector('iframe'), output=document.querySelector('#result');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const doc=()=>frame.contentDocument;
const until=async(fn,label)=>{const end=performance.now()+15000;while(!fn()){if(performance.now()>end)throw Error(`Timeout ${label}`);await delay(20);}};
const settled=()=>until(()=>doc()?.querySelector('#book-spread')?.getAttribute('aria-busy')==='false'&&doc()?.querySelector('#book-spread > .paper-page .page-prose p'),'settled');
const key=k=>doc().dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown',{key:k,bubbles:true}));
const saved=()=>JSON.parse(localStorage.getItem('folio:demo')).bookPosition;
const same=(a,b)=>a.page===b.page&&a.offset===b.offset;
const assert=(v,s)=>{if(!v)throw Error(s);};
async function reset(){
 localStorage.removeItem('folio:demo'); localStorage.removeItem('folio:active-book');localStorage.setItem('folio:reading-layout','"pages"');
 const old=doc();frame.src='/';await until(()=>doc()!==old,'reload');await settled();key('f');await until(()=>doc().body.classList.contains('focus-mode'),'focus');await settled();
}
document.querySelector('#run').onclick=async()=>{
 const logs=[];const log=s=>{logs.push(s);output.textContent=logs.join('\n');};
 try{
  for(const [name,keys,phase] of [['immediate next',['ArrowRight','Escape'],'immediate'],['animation',['ArrowRight','Escape'],'animation'],['double Escape',['ArrowRight','Escape','Escape'],'immediate'],['queued next',['ArrowRight','ArrowRight','Escape'],'immediate'],['queued reverse',['ArrowRight','ArrowLeft','Escape'],'immediate']]){
   await reset();for(const k of keys.filter(k=>k!=='Escape')){key(k);await settled();}key('Escape');await until(()=>!doc().body.classList.contains('focus-mode'),'exit');await settled();const target=saved();
   await reset();let input=keys;if(phase==='animation'){key(input[0]);await until(()=>doc().querySelector('.page-turn-layer'),'animation');input=input.slice(1);}for(const k of input)key(k);
   await until(()=>!doc().body.classList.contains('focus-mode'),'exit');await settled();assert(same(saved(),target),`${name}: expected ${JSON.stringify(target)} got ${JSON.stringify(saved())}`);assert(!doc().querySelector('.page-turn-layer'),`${name}: overlay remained`);log(`PASS ${name}`);
  }
  log('ALL FOCUS NAVIGATION CHECKS PASSED');
 }catch(e){log(`FAIL ${e.stack}`);}
};
