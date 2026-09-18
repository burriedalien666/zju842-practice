// Controlled reproductions against an explicitly supplied, untouched OLD source.
// Temp files only. Requires that source's dependencies, or a disclosed test loader.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
if(!process.argv[2]) throw new Error('Usage: node scripts/reproduce-update-baseline.js <untouched-v0.5.2-source>');
const old=path.resolve(process.argv[2]);
const {GitHubUpdates}=await import(pathToFileURL(path.join(old,'server/update-source.js')));
const {createUpdates}=await import(pathToFileURL(path.join(old,'server/updates.js')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'842-baseline-repro-'));
const asset=name=>({release:'fixture',name,size:8});
const manifest=(revision=3)=>({format:1,libraryId:'zju842',program:{version:'0.5.3',protocol:1,assets:Object.fromEntries(['windows-x64','macos-x64','macos-arm64'].map(p=>[p,asset(`zju842-0.5.3-${p}.zip`)]))},library:{revision,edition:'fixture',requiresProgram:'0.4.0',asset:asset('library.842pack')},answers:{revision:1,edition:'fixture',requiresProgram:'0.4.0',requiresLibraryRevision:2,asset:asset('answers.842answers')}});
const app={localActiveWrites:0,db:{async get(){if(this.wait)await this.wait;return{value:'null',revision:0};}}};
let version=3;const installed=[];
const source={check:async()=>manifest(version),download:async(a,f)=>fs.writeFileSync(f,'fixture')};
const options={app,dataDir:dir,catalog:{libraryRevision:2,questions:[]},answers:()=>({value:{revision:0}}),source,installLibrary:async(f,item)=>installed.push(item.revision),installAnswers:async()=>{}};
try {
  let calls=0;const network=new GitHubUpdates(async()=>{calls++;throw Object.assign(new Error('fixture reset'),{code:'ECONNRESET'});});
  await assert.rejects(network.download(asset('fixture.zip'),path.join(dir,'reset'),()=>{}));assert.equal(calls,1);console.log('REPRODUCED: original reset path performs one attempt, no bounded retry');
  const html=Buffer.from('<html>not a release</html>');
  await new GitHubUpdates(async()=>new Response(html,{headers:{'Content-Type':'text/html'}})).download({...asset('fixture.zip'),size:html.length},path.join(dir,'html'),()=>{});
  console.log('REPRODUCED: original downloader accepts an exact-length HTML response (installer may still reject it)');
  let n=0;const body=new ReadableStream({pull(c){if(n++===0)c.enqueue(Buffer.from('part'));else c.error(new Error('fixture truncated'));}});
  await assert.rejects(new GitHubUpdates(async()=>new Response(body)).download(asset('fixture.zip'),path.join(dir,'partial'),()=>{}));
  assert.equal(fs.existsSync(path.join(dir,'partial')),true);console.log('REPRODUCED: original downloader leaves its partial file (outer update job normally cleans it)');
  fs.writeFileSync(path.join(dir,'update-cache.json'),'{');assert.throws(()=>createUpdates(options),SyntaxError);fs.unlinkSync(path.join(dir,'update-cache.json'));
  console.log('REPRODUCED: corrupt optional update-cache JSON aborts update-center creation');
  const updates=createUpdates(options);await updates.check();let release;app.db.wait=new Promise(r=>release=r);
  const start=updates.start('library',3,'0');version=4;await updates.check();release();await start;
  for(let i=0;i<100&&updates.status().job.state!=='done';i++)await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(installed,[4]);assert.equal(updates.status().job.target,3);console.log('REPRODUCED: approved target r3 can install r4 after cache changes during revision wait');
  fs.writeFileSync(path.join(dir,'update-downloads','keep'),'fixture');fs.rmSync(path.join(dir,'update-downloads'),{recursive:true});fs.writeFileSync(path.join(dir,'update-downloads'),'not-directory');
  const errorPromise=new Promise(resolve=>process.once('unhandledRejection',resolve));
  await updates.start('library',4,'0');const e=await errorPromise;
  assert.ok(['EEXIST','ENOTDIR'].includes(e.code));assert.equal(updates.status().job.state,'downloading');
  console.log('REPRODUCED: download mkdir rejection escapes task catch; observer captured '+e.code+'; original user service-exit cause remains UNKNOWN');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
