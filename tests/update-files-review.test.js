import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicJson, readJson } from '../server/update-files.js';
test('atomic JSON: failed rename preserves previous pointer and removes private temporary file', t => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), '842-pointer-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); const file = path.join(d, 'pointer.json');
  atomicJson(file, { revision: 1 }); const original = fs.renameSync;
  fs.renameSync = () => { throw Object.assign(new Error('disk'), { code: 'ENOSPC' }); };
  try { assert.throws(() => atomicJson(file, { revision: 2 })); } finally { fs.renameSync = original; }
  assert.deepEqual(readJson(file), { revision: 1 }); assert.deepEqual(fs.readdirSync(d), ['pointer.json']);
  atomicJson(file, { revision: 2 }); assert.deepEqual(readJson(file), { revision: 2 });
});

test('desktop diagnostics retain only bounded allowed fields; never persist secret messages', async t => {
  const {recordDesktopEvent}=await import('../server/desktop-diagnostics.js');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'842-diagnostic-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'desktop-diagnostics.json'),JSON.stringify({events:[{at:1,event:'ready',password:'secret',code:'secret://password'}]}));
  for(let i=0;i<25;i++)recordDesktopEvent(dir,'uncaught',{code:'ECONNRESET',message:'secret-token'});
  const text=fs.readFileSync(path.join(dir,'desktop-diagnostics.json'),'utf8');assert.equal(JSON.parse(text).events.length,20);assert.equal(text.includes('secret'),false);
});
