// Actual local route handlers, ZIP and SQLite; a route/hook harness replaces
// Fastify and multipart parsing. Does not claim HTTP/session integration coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { openDatabase } from '../server/db.js';
import { registerLocal } from '../server/local.js';
import { extractAnswers, readOfficialAnswers } from '../server/answer-packs.js';
import { writeZip } from '../server/packs.js';
import { currentLibrary } from '../server/content-store.js';
const baseDir=path.resolve('public'),original=JSON.parse(fs.readFileSync(path.join(baseDir,'catalog.json')));
async function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'842-handler-'));const db=await openDatabase(dir),routes={},hooks={};
  t.after(async()=>{await db.close();fs.rmSync(dir,{recursive:true,force:true})});
  const app={db,decorate(k,v){this[k]=v},addHook(k,fn){(hooks[k] ||= []).push(fn)}};
  for(const method of ['get','post','put']) app[method]=(url,...args)=>{const handler=args.pop(),options=args[0]||{};const route={method:method.toUpperCase(),handler};for(const h of hooks.onRoute||[])h(route);routes[method.toUpperCase()+' '+url]={...route,options};};
  const catalog=structuredClone(original);await registerLocal(app,{dataDir:dir,catalog,baseDir,origin:'http://127.0.0.1:19901',launchToken:'synthetic',updateSource:{check:async()=>{throw new Error('no external network')}}});
  async function request(method,url,{body,file}={}) {
    const r=routes[method+' '+url],req={method,url,body,headers:{},cookies:{local_session_19901:'synthetic'},file:async()=>({file:Readable.from(fs.readFileSync(file))})};
    const reply={header(){return this},async send(value){if(value?.[Symbol.asyncIterator]){const b=[];for await(const c of value)b.push(c);return Buffer.concat(b)}return value}};
    try{for(const h of hooks.onRequest||[])await h(req);await r.options.onRequest?.(req,reply);return await r.handler(req,reply)}
    finally{for(const h of hooks.onResponse||[])await h(req,reply)}
  }
  return {dir,db,catalog,app,request};
}
test('actual manual answer handler + selected export contains public answers and selected private published photos, no other drafts',async t=>{
  const {dir,db,catalog,request}=await fixture(t);const [a,b]=catalog.questions.map(q=>q.id);
  const image=await sharp({create:{width:4,height:4,channels:3,background:'white'}}).webp().toBuffer();
  const selected='a'.repeat(40),draft='b'.repeat(40),unselected='c'.repeat(40);
  for(const [id,q] of [[selected,a],[draft,a],[unselected,b]])await db.run('INSERT INTO photos VALUES(?,?,?)',id,q,image);
  await db.run('INSERT INTO answers VALUES(?,?,?,?)',a,JSON.stringify([draft]),JSON.stringify([selected]),'fixture');
  await db.run('INSERT INTO answers VALUES(?,?,?,?)',b,JSON.stringify([unselected]),JSON.stringify([unselected]),'fixture');
  const before=await db.all('SELECT * FROM answers');
  const bytes=await request('POST','/api/local/export-answers',{body:{ids:[a],revision:1,edition:'fixture selected'}});
  const zip=path.join(dir,'selected.zip');fs.writeFileSync(zip,bytes);const out=path.join(dir,'extracted');fs.mkdirSync(out);const result=await extractAnswers(zip,out);
  assert.deepEqual(result.answers,{[a]:['answers/'+selected+'.webp']});assert.ok(!bytes.includes(Buffer.from(draft+'.webp')));assert.ok(!bytes.includes(Buffer.from(unselected+'.webp')));
  await request('POST','/api/local/import-answers',{file:zip});assert.deepEqual(await db.all('SELECT * FROM answers'),before);
  const current=()=>readOfficialAnswers(dir,catalog,currentLibrary(dir,baseDir),baseDir);
  assert.equal(current().value.revision,1);
  await assert.rejects(request('POST','/api/local/import-answers',{file:zip}));
  const future=path.join(dir,'future.zip');await writeZip(future,[{name:'answers.json',bytes:Buffer.from(JSON.stringify({...result,revision:2,requiresProgram:'99.0.0'}))},{name:'answers/'+selected+'.webp',bytes:image}]);
  await assert.rejects(request('POST','/api/local/import-answers',{file:future}));assert.equal(current().value.revision,1);assert.deepEqual(await db.all('SELECT * FROM answers'),before);
});
test('actual handler gate blocks import during write and reports 409 without consuming upload',async t=>{
  const {app,request}=await fixture(t);app.localActiveWrites=1;
  await assert.rejects(request('POST','/api/local/import-pack',{file:'should-not-be-read'}),e=>e.statusCode===409);
  assert.equal(app.localActiveWrites,1);
});
