import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeZip } from '../server/packs.js';
import { stageProgram } from '../server/updates.js';
import { extractUpdateZip } from '../server/update-files.js';
// Actual ZIP boundary/staging only. The runtime bytes are deliberately inert;
// these tests cannot establish any OS/native dependency/startup compatibility.
async function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'842-stage-review-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'.app-versions'));let n=0;
  const entries=[{name:'package.json',bytes:Buffer.from(JSON.stringify({name:'zju842-practice',version:'0.5.3',desktopUpdateProtocol:1}))},...['server/desktop.js','server/desktop-app.js','dist/index.html','runtime/node'].map(name=>({name,bytes:Buffer.from('INERT TEST FIXTURE')}))];
  async function pack(extra=[],prefix='zju842-0.5.3-macos-x64/',change=e=>e){const f=path.join(dir,++n+'.zip');await writeZip(f,[...entries,...extra].map(e=>({...change(e),name:prefix+e.name})));return f;}
  return{dir,pack};
}
test('actual ZIP staging preserves old pointers, enforces prefix/version/protocol and excludes runtime-state paths',async t=>{
  const {dir,pack}=await fixture(t);fs.writeFileSync(path.join(dir,'.app-current.json'),'old-pointer');
  const good=await stageProgram(await pack(),dir,'0.5.3','macos-x64');assert.match(good,/^0\.5\.3-/);assert.equal(fs.readFileSync(path.join(dir,'.app-current.json'),'utf8'),'old-pointer');
  for(const name of ['.app-lock','userdata/site.sqlite','server/.env','server/userdata/private','unknown.txt']){
    await assert.rejects(stageProgram(await pack([{name,bytes:Buffer.from('fixture')}]),dir,'0.5.3','macos-x64'));
    assert.deepEqual(fs.readdirSync(path.join(dir,'.app-versions')),[good]);
  }
  await assert.rejects(stageProgram(await pack([],'zju842-0.5.3-windows-x64/'),dir,'0.5.3','macos-x64'));
  await assert.rejects(stageProgram(await pack([],undefined,e=>e.name==='package.json'?{...e,bytes:Buffer.from(JSON.stringify({name:'zju842-practice',version:'0.5.4',desktopUpdateProtocol:2}))}:e),dir,'0.5.3','macos-x64'));
});
test('actual ZIP extraction rejects duplicates and unsafe relative names and enforces expanded size',async t=>{
  const {dir}=await fixture(t);const out=path.join(dir,'out');fs.mkdirSync(out);
  const duplicate=path.join(dir,'duplicate.zip');await writeZip(duplicate,[{name:'x',bytes:Buffer.from('one')},{name:'x',bytes:Buffer.from('two')}]);
  await assert.rejects(extractUpdateZip(duplicate,out,()=>true));
  const unsafe=path.join(dir,'unsafe.zip');await writeZip(unsafe,[{name:'safe/file',bytes:Buffer.from('fixture')}]);
  fs.writeFileSync(unsafe,Buffer.from(fs.readFileSync(unsafe).toString('latin1').replaceAll('safe/file','../x/file'),'latin1'));
  const clean=path.join(dir,'clean');fs.mkdirSync(clean);await assert.rejects(extractUpdateZip(unsafe,clean,()=>true));assert.deepEqual(fs.readdirSync(clean),[]);
  const huge=path.join(dir,'size.zip');await writeZip(huge,[{name:'large',bytes:Buffer.alloc(64)}]);await assert.rejects(extractUpdateZip(huge,out,()=>true,32));
});
