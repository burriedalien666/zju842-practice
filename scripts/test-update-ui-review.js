// Real browser + actual update-center module. APIs, saving and reload are controlled
// fixtures; this is NOT a Fastify/portable-app/public-network acceptance test.
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const fixture = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/updates.css"><button data-action="local-updates">Updates</button><dialog id="dialog"></dialog><script type="module">
import {createUpdateCenter} from '/updates.js';
const state={settings:{autoCheck:true},entries:{program:{current:'0.5.3',target:'0.5.3',available:false,reason:'source'},library:{current:2,target:3,available:true},answers:{current:0,target:1,available:true}},job:null,checkedAt:null,lastResult:null};
const f=window.fixture={state,checks:0,installs:0,reloads:0,saves:0,toasts:[],lost:false,saveError:false,statusError:null};
const esc=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const center=createUpdateCenter({
 api:async(route,options={})=>{
   if(route.endsWith('/check')){f.checks++;await new Promise((ok,no)=>{f.resolve=ok;f.reject=no;});state.checkedAt=Date.now();}
   else if(route.endsWith('/install')){f.installs++;const body=JSON.parse(options.body);f.requestId=body.requestId;state.job={...body,startedAt:Date.now(),state:'downloading',message:'fixture downloading'};if(f.lost)throw new Error('fixture lost response');}
   else if(route.endsWith('/settings'))state.settings=JSON.parse(options.body);
   else if(f.statusError)throw Object.assign(new Error('fixture connection'),f.statusError);
   return structuredClone(state);
 },dialog:(title,html)=>{const d=document.querySelector('#dialog');d.innerHTML='<h2>'+esc(title)+'</h2>'+html+'<button id="close">Close</button>';document.querySelector('#close').onclick=()=>d.close();if(!d.open)d.showModal();},
 esc,toast:message=>f.toasts.push(message),requireSaved:async()=>{f.saves++;if(f.saveError)throw new Error('fixture unsaved conflict');},revision:()=> '7',reload:()=>f.reloads++,pollInterval:10,
 verifyConnection:async()=>{if(f.statusError)throw Object.assign(new Error('fixture connection'),f.statusError);}
});
f.center=center;f.finish=()=>{state.job.state='done';state.job.message='fixture complete'};
document.querySelector('[data-action="local-updates"]').onclick=()=>center.open();
f.ready=true;
</script>`;
const server=http.createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fixture);}
  const name={'/updates.js':'src/updates.js','/local-connection.js':'src/local-connection.js','/updates.css':'src/updates.css'}[req.url];
  if(!name){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');
  res.end(fs.readFileSync(name,'utf8').replace('import "./updates.css";',''));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser; const errors=[]; let passed=0;
try{
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:process.platform==='win32'?{channel:'chrome'}:{})});
  let page;
  async function reset(){
    await page?.close();
    page=await browser.newPage({viewport:{width:1100,height:900}});
    page.on('pageerror',e=>errors.push(e.message));
    if(process.env.UI_REVIEW_IN_MEMORY === '1') {
      // Offline DOM-only mode. No navigation, server access, or policy changes.
      // about:blank lacks secure-context randomUUID; the test alone supplies it.
      const uuidShim = "if(!crypto.randomUUID)crypto.randomUUID=()=>('10000000-1000-4000-8000-100000000000').replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));";
      const actual = fs.readFileSync('src/local-connection.js','utf8').replaceAll('export ','') + '\n' + fs.readFileSync('src/updates.js','utf8').replace('import "./updates.css";','').replace('import { connectionFeedback } from "./local-connection.js";','').replace('export function createUpdateCenter','function createUpdateCenter');
      await page.setContent(fixture.replace('<link rel="stylesheet" href="/updates.css">','<style>'+fs.readFileSync('src/updates.css','utf8')+'</style>').replace("import {createUpdateCenter} from '/updates.js';",uuidShim+'\n'+actual));
    } else await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>window.fixture?.ready);
  }
  const open=()=>page.locator('[data-action="local-updates"]').click();
  const confirm=async()=>{await page.locator('[data-update-kind="library"]').click();await page.locator('#confirm-update').click();};
  const pass=name=>{passed++;console.log('PASS '+name);};
  await reset();await page.evaluate(()=>{void fixture.center.automatic()});await page.waitForFunction(()=>fixture.checks===1);await open();
  assert.equal(await page.locator('#update-check').isDisabled(),true);
  await page.evaluate(()=>fixture.resolve());await page.waitForFunction(()=>!document.querySelector('#update-check').disabled);
  assert.equal(await page.evaluate(()=>fixture.installs),0);pass('default automatic check + opening center finishes and never auto-installs');
  await reset();await page.evaluate(()=>{void fixture.center.automatic()});await page.waitForFunction(()=>fixture.checks===1);await open();await page.locator('#close').click();
  await page.evaluate(()=>fixture.reject(new Error('GitHub fixture reset')));await page.waitForTimeout(50);assert.equal(await page.locator('#dialog').evaluate(e=>e.open),false);
  await open();await page.evaluate(()=>{document.querySelector('#update-check').click();document.querySelector('#update-check').click()});await page.waitForFunction(()=>fixture.checks===2);
  await page.evaluate(()=>fixture.reject(new Error('GitHub fixture offline')));await page.waitForFunction(()=>!document.querySelector('#update-check').disabled);
  assert.match(await page.locator('#update-error').textContent(),/GitHub fixture offline/);pass('automatic failure while closed; reopen and repeated manual click produce one check');
  await reset();await open();await page.evaluate(()=>fixture.lost=true);await confirm();await page.waitForFunction(()=>fixture.installs===1 && document.querySelector('#update-center'));
  await page.evaluate(()=>fixture.finish());await page.waitForFunction(()=>fixture.reloads===1);
  assert.equal(await page.evaluate(()=>fixture.installs),1);assert.equal(await page.evaluate(()=>fixture.saves),2);pass('lost installation response reconciles same request ID; one install; save before refresh');
  await reset();await open();await page.evaluate(()=>fixture.saveError=true);await confirm();await page.waitForFunction(()=>document.querySelector('#confirm-error').textContent.includes('unsaved'));
  assert.equal(await page.evaluate(()=>fixture.installs),0);assert.equal(await page.locator('#confirm-update').isDisabled(),false);pass('unsaved conflict blocks install and leaves confirmation usable');
  await reset();await open();await confirm();await page.waitForFunction(()=>fixture.installs===1);await page.evaluate(()=>{fixture.state.job={kind:'answers',target:1,requestId:crypto.randomUUID(),state:'done',message:'other job'};});
  await page.waitForFunction(()=>fixture.toasts.length>0);assert.equal(await page.evaluate(()=>fixture.reloads),0);pass('another completed job cannot fake completion or refresh');
  for(const problem of [{code:'LOCAL_CONNECTION'},{statusCode:401},{code:'LOCAL_DIRECTORY'}]){
    await reset();await page.evaluate(p=>fixture.statusError=p,problem);await open();await page.locator('#update-reconnect').waitFor();assert.equal(await page.evaluate(()=>fixture.installs),0);
    await page.evaluate(()=>fixture.statusError=null);await page.locator('#update-reconnect').click();await page.locator('#update-check').waitFor();
  }pass('local disconnect, expired session and changed data directory recover without install/refresh');
  await reset();await open();await confirm();await page.waitForFunction(()=>fixture.installs===1);await page.evaluate(()=>fixture.saveError=true);await page.evaluate(()=>fixture.finish());await page.waitForFunction(()=>fixture.toasts.length>0);
  assert.equal(await page.evaluate(()=>fixture.reloads),0);pass('post-install save conflict prevents automatic reload and retains page');
  fs.mkdirSync('.test-artifacts/update-ui-review',{recursive:true});await page.screenshot({path:'.test-artifacts/update-ui-review/save-conflict.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('UPDATE UI REVIEW: '+passed+' scenarios passed; real Chromium, mocked API/save/reload; inMemory='+String(process.env.UI_REVIEW_IN_MEMORY === '1'));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
