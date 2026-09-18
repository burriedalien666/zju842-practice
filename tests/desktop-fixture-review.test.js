import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { desktopFixtureEntries, waitForFixture, redactFixtureOutput } from '../scripts/desktop-fixture.js';
test('E07: candidate fixture excludes runtime state and secrets without weakening installer',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'842-fixture-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const name of ['.app-lock','.app-current.json','userdata/site.sqlite','server/main.js','server/.env','runtime/node','node_modules/pkg/index.js','package.json','tests/x.js','.git/config','.env.example']) {
    fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),'fixture');
  }
  assert.deepEqual(desktopFixtureEntries(root).map(e=>e.name).sort(),['node_modules/pkg/index.js','package.json','runtime/node','server/main.js']);
});
test('E07: terminal job error is reported immediately; timeouts report last job, session URL redacted',async()=>{
  await assert.rejects(waitForFixture(async()=>false,{timeout:1000,interval:1,inspect:async()=>({job:{state:'failed',message:'invalid zip path'}})}),/invalid zip path/);
  await assert.rejects(waitForFixture(async()=>false,{timeout:5,interval:1,inspect:async()=>({job:{state:'downloading',received:10}}),output:()=> 'TEST_START_URL=http://localhost/__open/private'}),e=>/downloading/.test(e.message)&&!e.message.includes('private'));
  assert.equal(redactFixtureOutput('TEST_START_URL=http://localhost/__open/secret'),'TEST_START_URL=[REDACTED]');
});
