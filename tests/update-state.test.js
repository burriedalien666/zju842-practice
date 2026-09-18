import { createContentStage } from "../server/content-staging.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUpdates } from '../server/updates.js';
const asset = name => ({ release: 'fixture', name, size: 8 });
function manifest(revision = 3) { return { format: 1, libraryId: 'zju842', program: { version: '0.5.3', protocol: 1, assets: Object.fromEntries(['windows-x64', 'macos-x64', 'macos-arm64'].map(p => [p, asset(`zju842-0.5.3-${p}.zip`)])) }, library: { revision, edition: 'fixture', requiresProgram: '0.4.0', asset: asset('library.842pack') }, answers: { revision: 1, edition: 'fixture', requiresProgram: '0.4.0', requiresLibraryRevision: 3, asset: asset('answers.842answers') } }; }
function fixture(t, prepare = () => {}, installers = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), '842-state-')); t.after(() => fs.rmSync(dataDir, { recursive: true, force: true })); prepare(dataDir);
  const catalog = { questions: [], libraryRevision: 2 }, source = { checks: 0, target: manifest(), async check() { this.checks++; if (this.checkWait) await this.checkWait; return structuredClone(this.target); }, async download(a, file) { if (this.downloadWait) await this.downloadWait; fs.writeFileSync(file, 'fixture'); } };
  const app = { localActiveWrites: 0, db: { async get() { if (this.wait) await this.wait; return { value: "null", revision: this.revision || 0 }; } } };
  const installed = [];
  const updates = createUpdates({ app, dataDir, catalog, answers: () => ({ value: { revision: 0 } }), source, version: '0.5.3', installLibrary: async (f, item) => { installed.push(item.revision); catalog.libraryRevision = item.revision; }, installAnswers: async () => {}, ...installers });
  return { dataDir, catalog, source, app, updates, installed };
}
async function settled(updates) { for (let i = 0; i < 200; i++) { const j = updates.status().job; if (['done', 'failed'].includes(j?.state)) return j; await new Promise(r => setTimeout(r, 10)); } throw new Error('Job timeout: ' + JSON.stringify(updates.status().job)); }
test('state: corrupt optional cache/settings do not prevent local startup; bad settings disable automatic network', async t => {
  const { updates, source } = fixture(t, dir => { for (const n of ['update-cache.json', 'update-settings.json', 'last-update-result.json']) fs.writeFileSync(path.join(dir, n), '{'); });
  assert.equal(updates.status().settings.autoCheck, false); await updates.check(true); assert.equal(source.checks, 0); await updates.check(false); assert.equal(source.checks, 1);
});
test('state: concurrent manual/automatic checks share one actual request; manual ignores completed six-hour cache', async t => {
  const { updates, source } = fixture(t); let release; source.checkWait = new Promise(r => release = r);
  const a = updates.check(false), b = updates.check(true); assert.equal(source.checks, 1); release(); await Promise.all([a, b]);
  assert.equal(updates.status().checking, false); await updates.check(true); assert.equal(source.checks, 1); await updates.check(false); assert.equal(source.checks, 2);
});
test('state: consent target is snapshotted before async revision check; another check cannot substitute assets', async t => {
  const { updates, app, source, installed } = fixture(t); await updates.check(); let release;
  app.db.wait = new Promise(r => release = r); const starting = updates.start('library', 3, '0');
  source.target = manifest(4); await updates.check(); release(); await starting; await settled(updates);
  assert.deepEqual(installed, [3]); assert.equal(updates.status().job.target, 3);
});
test('state: download-directory failure ends job rather than escaping the async task', async t => {
  const { updates, dataDir, installed } = fixture(t); fs.writeFileSync(path.join(dataDir, 'update-downloads'), 'not a directory'); await updates.check(); await updates.start('library', 3, '0');
  const job = await settled(updates); assert.equal(job.state, 'failed'); assert.equal(updates.busy, false); assert.equal(updates.pauseWrites, false); assert.deepEqual(installed, []);
});
test('state: same request ID is idempotent; reusing consent for another target is rejected', async t => {
  const { updates, installed } = fixture(t); await updates.check(); const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const one = await updates.start('library', 3, '0', id), two = await updates.start('library', 3, '0', id); assert.equal(one.job.id, two.job.id);
  await settled(updates); await updates.start('library', 3, '0', id); assert.deepEqual(installed, [3]);
  await assert.rejects(updates.start('library', 4, '0', id));
});
test('state: writes changed during download prevent installation; partial downloads and stale files are cleaned', async t => {
  const { updates, app, source, dataDir, installed } = fixture(t); await updates.check();
  const dir = path.join(dataDir, 'update-downloads'); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'a'.repeat(16) + '.download'), 'stale'); fs.writeFileSync(path.join(dir, 'leave-me'), 'keep');
  let release; source.downloadWait = new Promise(r => release = r); await updates.start('library', 3, '0'); await new Promise(r => setTimeout(r, 10)); app.db.revision = 1; release();
  assert.equal((await settled(updates)).state, 'failed'); assert.deepEqual(installed, []); assert.deepEqual(fs.readdirSync(dir), ['leave-me']); assert.equal(updates.pauseWrites, false);
});

test('R02 update job exposes original code plus separate safe cleanup diagnostics', async t => {
  let dataDir;
  const setup=fixture(t,()=>{}, {installLibrary: async()=>{
    const stage=createContentStage(dataDir,'edition');
    const original=Object.assign(new Error('disk full fixture'),{code:'ENOSPC'});
    const rm=fs.rmSync;
    fs.rmSync=(p,o)=>{if(p===stage.directory)throw Object.assign(new Error('private cleanup path'),{code:'EPERM'});return rm(p,o);};
    try{stage.cleanup(original);}finally{fs.rmSync=rm;}
    throw original;
  }});
  dataDir=setup.dataDir;
  await setup.updates.check();await setup.updates.start('library',3,'0');
  const job=await settled(setup.updates);
  assert.equal(job.state,'failed');assert.equal(job.code,'ENOSPC');assert.equal(job.stage,'installation');
  assert.equal(job.cleanupPending,true);assert.equal(job.cleanupErrors.length,1);assert.equal(job.cleanupErrors[0].code,'EPERM');
  assert.match(job.message,/\u672a\u6e05\u7406\u5b8c\u6210/);
  assert.equal(JSON.stringify(job).includes(dataDir),false);assert.equal(setup.updates.pauseWrites,false);
});
