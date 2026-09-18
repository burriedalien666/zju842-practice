import { contentCleanupDetails } from "../server/content-staging.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { writeZip, packPaths } from '../server/packs.js';
import { createContentStore, currentLibrary } from '../server/content-store.js';
import { openDatabase } from '../server/db.js';
import { ensureLocalStudySchema, writeLocalStudy, readLocalStudy } from '../server/study-version.js';
import { validateStudy } from '../src/study.js';
import { scheduleReview } from '../src/review.js';
import { createUpdates } from '../server/updates.js';
const baseDir = fileURLToPath(new URL('../public', import.meta.url));
const original = JSON.parse(fs.readFileSync(path.join(baseDir, 'catalog.json')));
const [qid, qid2] = original.questions.map(q => q.id);
const root = fs.mkdtempSync(path.join(os.tmpdir(), '842-content-review-'));
const image = await sharp({create:{width:7,height:5,channels:3,background:'white'}}).webp().toBuffer();
let counter = 0;
async function answerPack(value, extras = [], missing = [], payload = image) {
  const file = path.join(root, 'answers-' + (++counter) + '.zip');
  const paths = [...new Set(Object.values(value.answers).flat())].filter(n => !missing.includes(n));
  await writeZip(file, [{name:'answers.json',bytes:Buffer.from(JSON.stringify(value))},
    ...paths.map(name => ({name,bytes:payload})), ...extras]);
  return file;
}
const answers = (revision, values = {[qid]:['answers/a.webp','answers/b.webp'],[qid2]:['answers/c.webp']}) => ({format:1,kind:'answers',libraryId:'zju842',revision,edition:'ARTIFICIAL REVIEW FIXTURE',requiresProgram:'0.5.0',requiresLibraryRevision:2,answers:values});
async function libraryPack(value) {
  const file = path.join(root, 'library-' + (++counter) + '.zip');
  await writeZip(file, [...packPaths(value)].map(name => name === 'catalog.json' ? {name,bytes:Buffer.from(JSON.stringify(value))} : {name,file:path.join(baseDir,name)}));
  return file;
}
const nextCatalog = () => {
  const c = structuredClone(original); c.libraryRevision = 3; c.updateKind = 'library'; c.edition = 'ARTIFICIAL REVIEW FIXTURE';
  const q = structuredClone(c.questions[0]); q.id = 'fixture-extra-question'; c.questions.push(q);
  return c;
};
const r1 = await answerPack(answers(1));
const r2 = await answerPack(answers(2, {[qid]:['answers/replaced.webp']}));
const empty = await answerPack(answers(3, {}));
const r3library = await libraryPack(nextCatalog());
function instance(t) {
  const dataDir = fs.mkdtempSync(path.join(root, 'data-'));
  const catalog = structuredClone(original);
  const store = createContentStore({dataDir,catalog,baseDir,version:'0.5.3'});
  return {dataDir,catalog,store};
}
function restart(dataDir) {
  const dir = currentLibrary(dataDir,baseDir);
  const catalog = JSON.parse(fs.readFileSync(path.join(dir,'catalog.json')));
  return {catalog,store:createContentStore({dataDir,catalog,baseDir,version:'0.5.3'})};
}
function files(root) { return fs.existsSync(root) ? fs.readdirSync(root).sort() : []; }
test.after(() => fs.rmSync(root,{recursive:true,force:true}));

test('real ZIP/store: nonempty r0->r1->r2->empty r3; pictures, SQLite drafts/published/photos and study survive restart', async t => {
  const {dataDir,store} = instance(t); const db = await openDatabase(dataDir);
  t.after(() => db.close()); await ensureLocalStudySchema(db);
  const study = validateStudy({version:2,records:{[qid]:{star:true,state:'review',review:scheduleReview(null,'wrong',{},1000)}},lists:[{name:'fixture-list',ids:[qid]}],papers:{'2009':{started:1000,finished:null,marks:{[qid]:'wrong'}}},examDate:'2026-12-20',lastQuestion:qid},new Set(original.questions.map(q=>q.id)));
  await writeLocalStudy(db,study,'0');
  await db.run('INSERT INTO photos VALUES(?,?,?)','private-photo',qid,Buffer.from('synthetic-private-bytes'));
  await db.run('INSERT INTO answers VALUES(?,?,?,?)',qid,'["private-photo"]','["private-photo"]','fixture');
  const snapshot = async () => ({study:await readLocalStudy(db), photos:await db.all('SELECT * FROM photos'),answers:await db.all('SELECT * FROM answers')});
  const before = await snapshot();
  await store.installAnswers(r1); assert.equal(store.official().value.revision,1);
  assert.equal(Object.keys(store.official().value.answers).length,2);
  assert.equal(Object.values(store.official().value.answers).flat().length,3);
  for (const n of Object.values(store.official().value.answers).flat()) assert.deepEqual(fs.readFileSync(path.join(store.official().directory,n)),image);
  const oldDirectory = store.official().directory;
  await store.installAnswers(r2); assert.deepEqual(store.official().value.answers,{[qid]:['answers/replaced.webp']});
  assert.ok(fs.existsSync(oldDirectory)); assert.deepEqual(await snapshot(),before);
  await store.installAnswers(empty); assert.deepEqual(store.official().value.answers,{});
  assert.equal(restart(dataDir).store.official().value.revision,3); assert.deepEqual(await snapshot(),before);
});
test('real ZIP/store: added question r2->r3; public answers retained; library and answer dependencies enforce cross-order', async t => {
  const {dataDir,catalog,store} = instance(t);
  const needs = await answerPack({...answers(2,{'fixture-extra-question':['answers/new.webp']}),requiresLibraryRevision:3});
  await assert.rejects(store.installAnswers(needs)); assert.equal(store.official().value.revision,0);
  await store.installAnswers(r1); await store.installLibrary(r3library);
  assert.equal(catalog.questions.length,original.questions.length+1); assert.equal(catalog.libraryRevision,3);
  assert.equal(store.official().value.revision,1);
  const q = catalog.questions.at(-1); assert.ok(fs.existsSync(path.join(store.library,q.images[0].src)));
  await store.installAnswers(needs); assert.deepEqual(restart(dataDir).store.official().value.answers,{'fixture-extra-question':['answers/new.webp']});
  await assert.rejects(store.installLibrary(r3library)); await assert.rejects(store.installAnswers(r1));
});
test('real ZIP/store: corrupt, missing, duplicate-referenced, extra and disguised answer images reject without pointer change', async t => {
  const {dataDir,store} = instance(t); await store.installAnswers(r1);
  const pointer = fs.readFileSync(path.join(dataDir,'official-answers.json'));
  const before = files(path.join(dataDir,'libraries'));
  const png = await sharp({create:{width:3,height:3,channels:3,background:'white'}}).png().toBuffer();
  const invalid = [
    await answerPack(answers(2),[],['answers/a.webp']),
    await answerPack(answers(2),[{name:'answers/unused.webp',bytes:image}]),
    await answerPack(answers(2,{[qid]:['answers/a.webp','answers/a.webp']})),
    await answerPack(answers(2),[],[],image.subarray(0,20)),
    await answerPack(answers(2),[],[],png),
    await answerPack({...answers(2),requiresProgram:'99.0.0'}),
    await answerPack({...answers(2),libraryId:'wrong'}),
  ];
  for (const zip of invalid) { await assert.rejects(store.installAnswers(zip)); assert.deepEqual(fs.readFileSync(path.join(dataDir,'official-answers.json')),pointer); assert.deepEqual(files(path.join(dataDir,'libraries')),before); }
});
test('real ZIP/store: answer pointer ENOSPC leaves old images and version; retry succeeds', async t => {
  const {dataDir,store} = instance(t); await store.installAnswers(r1);
  const rename = fs.renameSync; fs.renameSync = (a,b) => { if (b === path.join(dataDir,'official-answers.json')) throw Object.assign(new Error('injected disk full'),{code:'ENOSPC'}); return rename(a,b); };
  try { await assert.rejects(store.installAnswers(r2),{code:'ENOSPC'}); } finally { fs.renameSync = rename; }
  assert.equal(restart(dataDir).store.official().value.revision,1);
  await store.installAnswers(r2); assert.equal(restart(dataDir).store.official().value.revision,2);
});
test('real ZIP/store: library pointer failure leaves disk and live catalog old; retry plus reload sees r3', async t => {
  const {dataDir,catalog,store} = instance(t); await store.installAnswers(r1);
  const rename = fs.renameSync; fs.renameSync = (a,b) => { if (b === path.join(dataDir,'library.json')) throw Object.assign(new Error('injected access denied'),{code:'EACCES'}); return rename(a,b); };
  try { await assert.rejects(store.installLibrary(r3library),{code:'EACCES'}); } finally { fs.renameSync = rename; }
  assert.equal(catalog.libraryRevision,2); assert.equal(currentLibrary(dataDir,baseDir),baseDir); assert.equal(store.official().value.revision,1);
  await store.installLibrary(r3library); assert.equal(catalog.libraryRevision,3); assert.equal(restart(dataDir).catalog.libraryRevision,3);
});
test('real ZIP/store: legacy import cannot delete or reuse old IDs; pure migration creates independent answer pointer', async t => {
  const {dataDir,store} = instance(t);
  for (const edit of [c=>c.questions.pop(),c=>c.questions[0].year++,c=>c.libraryRevision=1]) {
    const c=structuredClone(original); delete c.updateKind; edit(c); const file=await libraryPack(c);
    await assert.rejects(store.installLibrary(file)); assert.equal(currentLibrary(dataDir,baseDir),baseDir);
  }
  await store.installLibrary(r3library); assert.ok(fs.existsSync(path.join(dataDir,'official-answers.json')));
  assert.equal(restart(dataDir).store.official().value.revision,0);
});
test('actual update state machine + real ZIP installation: mocked release download installs r3 then nonempty answers', async t => {
  const {dataDir,catalog,store}=instance(t); const db=await openDatabase(dataDir); t.after(()=>db.close()); await ensureLocalStudySchema(db);
  const asset = {release:'fixture',name:'library.842pack',size:fs.statSync(r3library).size};
  const manifest = {format:1,libraryId:'zju842',program:{protocol:1,version:'0.5.3',assets:Object.fromEntries(['windows-x64','macos-x64','macos-arm64'].map(p=>[p,{release:'fixture',name:`zju842-0.5.3-${p}.zip`,size:1}]))},library:{revision:3,edition:'fixture',requiresProgram:original.requiresProgram,asset},answers:{revision:1,edition:'fixture',requiresProgram:'0.5.0',requiresLibraryRevision:2,asset:{release:'fixture',name:'answers.842answers',size:fs.statSync(r1).size}}};
  const source={check:async()=>manifest,download:async(asset,file,progress)=>{const fixture=asset.name.endsWith('.842pack')?r3library:r1; fs.copyFileSync(fixture,file); progress(asset.size,asset.size);}};
  const updates=createUpdates({app:{db,localActiveWrites:0},dataDir,catalog,answers:store.official,installLibrary:store.installLibrary,installAnswers:store.installAnswers,source});
  await updates.check();
  for(const [kind,target] of [['library',3],['answers',1]]) {
    await updates.start(kind,target,'0'); const deadline=Date.now()+15000;
    while(updates.busy&&Date.now()<deadline) await new Promise(r=>setTimeout(r,10));
    assert.equal(updates.status().job.state,'done',updates.status().job.message);
  }
  assert.equal(restart(dataDir).catalog.libraryRevision,3); assert.equal(store.official().value.revision,1);
});

test('ZIP export failure is a rejected promise, cleans owned partial file and never deletes an existing file', async () => {
  const bad=path.join(root,'failed-export.zip');
  await assert.rejects(writeZip(bad,[{name:'missing.txt',file:path.join(root,'not-present')}]),{code:'ENOENT'});
  assert.equal(fs.existsSync(bad),false);
  fs.writeFileSync(bad,'keep-existing');
  await assert.rejects(writeZip(bad,[{name:'test',bytes:Buffer.from('fixture')}]),{code:'EEXIST'});
  assert.equal(fs.readFileSync(bad,'utf8'),'keep-existing');
});

for (const kind of ['answers', 'library']) test(`R02 actual ${kind} store preserves pointer fault when stage cleanup fails; retry succeeds`, async t => {
  const {dataDir, catalog, store} = instance(t); await store.installAnswers(r1);
  const libraries = path.resolve(dataDir, 'libraries');
  const before = files(libraries), pointer = fs.readFileSync(path.join(dataDir, 'official-answers.json'));
  const code = kind === 'answers' ? 'ENOSPC' : 'EACCES';
  const primary = Object.assign(new Error('injected original ' + code), {code});
  const target = path.join(dataDir, kind === 'answers' ? 'official-answers.json' : 'library.json');
  const rename = fs.renameSync, rm = fs.rmSync, attempts = [];
  fs.renameSync = (a,b) => { if(b === target) throw primary; return rename(a,b); };
  fs.rmSync = (p, options) => {
    if(options?.recursive && path.dirname(p) === libraries && !before.includes(path.basename(p))) {
      attempts.push(p); throw Object.assign(new Error('injected cleanup failure'), {code:'EPERM'});
    }
    return rm(p, options);
  };
  try {
    await assert.rejects(kind === 'answers' ? store.installAnswers(r2) : store.installLibrary(r3library), e => {
      assert.equal(e, primary); assert.equal(e.code, code); assert.equal(e.message, 'injected original ' + code);
      const details = contentCleanupDetails(e);
      assert.equal(details.cleanupPending, true); assert.equal(details.cleanupErrors.length, 1);
      assert.equal(details.cleanupErrors[0].code, 'EPERM');
      assert.equal(JSON.stringify(details).includes(dataDir), false);
      return true;
    });
  } finally { fs.renameSync = rename; fs.rmSync = rm; }
  assert.equal(attempts.length, 1); assert.ok(fs.existsSync(attempts[0]));
  assert.deepEqual(fs.readFileSync(path.join(dataDir, 'official-answers.json')), pointer);
  assert.equal(store.official().value.revision, 1); assert.equal(catalog.libraryRevision, 2);
  assert.equal(currentLibrary(dataDir, baseDir), baseDir);
  for(const name of before) assert.ok(fs.existsSync(path.join(libraries,name)));
  if(kind === 'answers') { await store.installAnswers(r2); assert.equal(store.official().value.revision, 2); }
  else { await store.installLibrary(r3library); assert.equal(catalog.libraryRevision, 3); }
  // A subsequent retry must not sweep the previous residue or any retained version.
  assert.ok(fs.existsSync(attempts[0]));
});

test('R02 migration answer-pointer failure cleans both unactivated stages and leaves base content effective', async t => {
  const {dataDir, catalog, store} = instance(t);
  const rename = fs.renameSync, primary = Object.assign(new Error('migration pointer disk full'), {code:'ENOSPC'});
  fs.renameSync = (a,b) => { if(b === path.join(dataDir,'official-answers.json')) throw primary; return rename(a,b); };
  try { await assert.rejects(store.installLibrary(r3library), e => e === primary); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(files(path.join(dataDir,'libraries')), []);
  assert.equal(currentLibrary(dataDir,baseDir),baseDir); assert.equal(catalog.libraryRevision,2);
  assert.equal(store.official().value.revision,0); assert.deepEqual(contentCleanupDetails(primary),{});
});

test('R02 after migration commits, library pointer failure retains the now-active answer directory', async t => {
  const {dataDir,catalog,store}=instance(t);
  const beforeAnswers = structuredClone(store.official().value);
  const rename=fs.renameSync, primary=Object.assign(new Error('library pointer denied'),{code:'EACCES'});
  fs.renameSync=(a,b)=>{if(b===path.join(dataDir,'library.json'))throw primary;return rename(a,b);};
  try{await assert.rejects(store.installLibrary(r3library),e=>e===primary);}
  finally{fs.renameSync=rename;}
  assert.equal(catalog.libraryRevision,2); assert.equal(currentLibrary(dataDir,baseDir),baseDir);
  assert.deepEqual(store.official().value,beforeAnswers);
  assert.deepEqual(files(path.join(dataDir,'libraries')),[path.basename(store.official().directory)]);
  assert.deepEqual(contentCleanupDetails(primary),{});
});

test('R02 migration image-copy failure removes its incomplete answer stage without changing legacy answers', async t => {
  const dataDir=fs.mkdtempSync(path.join(root,'migration-'));
  const legacy=path.join(dataDir,'base');fs.mkdirSync(path.join(legacy,'answers'),{recursive:true});
  fs.writeFileSync(path.join(legacy,'answers/legacy.webp'),image);
  const catalog=structuredClone(original);catalog.officialAnswers={[qid]:['answers/legacy.webp']};
  const store=createContentStore({dataDir,catalog,baseDir:legacy,version:'0.5.3'});
  const before=structuredClone(store.official().value),copy=fs.copyFileSync;
  const primary=Object.assign(new Error('copy disk failure'),{code:'EIO'});
  fs.copyFileSync=(a,b,...rest)=>{if(a===path.join(legacy,'answers/legacy.webp'))throw primary;return copy(a,b,...rest);};
  try{await assert.rejects(store.installLibrary(r3library),e=>e===primary);}
  finally{fs.copyFileSync=copy;}
  assert.deepEqual(files(path.join(dataDir,'libraries')),[]);
  assert.deepEqual(store.official().value,before); assert.deepEqual(fs.readFileSync(path.join(legacy,'answers/legacy.webp')),image);
  assert.equal(currentLibrary(dataDir,legacy),legacy);
});
