import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateLibraryTransition, validateAnswerTransition } from '../server/content-policy.js';
import { validateAnswers } from '../server/answer-schema.js';
import { validateCatalog } from '../server/catalog.js';
import { registerLocalWriteGate } from '../server/local-write-gate.js';
const current = JSON.parse(fs.readFileSync(new URL('../public/catalog.json', import.meta.url)));
const version = '0.5.3';
const nextLibrary = () => ({ ...structuredClone(current), libraryRevision: 3, updateKind: 'library' });
const nextAnswer = (revision, answers = {}) => ({ format: 1, kind: 'answers', libraryId: 'zju842', revision, requiresLibraryRevision: 2, requiresProgram: '0.5.0', edition: 'test', answers });
test('content: real catalog r2 -> synthetic r3 retains every old ID and accepts a new question', () => {
  const next = nextLibrary(); const q = structuredClone(next.questions[0]); q.id = 'fixture-added'; next.questions.push(q);
  validateCatalog(next); validateLibraryTransition(current, next, { version }); assert.equal(next.questions.length, current.questions.length + 1);
});
test('content: legacy manual import cannot remove IDs, downgrade, change identity or bypass requiresProgram', () => {
  for (const mutate of [x => x.questions.pop(), x => x.libraryRevision = 1, x => x.questions[0].year++, x => x.requiresProgram = '99.0.0', x => x.libraryId = 'other']) {
    const next = nextLibrary(); delete next.updateKind; mutate(next); assert.throws(() => validateLibraryTransition(current, next, { version }));
  }
});
test('content: same standalone revision, mixed standalone answers and changed manifest dependencies rejected', () => {
  const same = nextLibrary(); same.libraryRevision = 2; assert.throws(() => validateLibraryTransition(current, same, { version }));
  const mixed = nextLibrary(); mixed.officialAnswers = { [mixed.questions[0].id]: ['answers/a.webp'] }; assert.throws(() => validateLibraryTransition(current, mixed, { version }));
  assert.throws(() => validateLibraryTransition(current, nextLibrary(), { version, expected: { revision: 3, requiresProgram: '0.4.0' } }));
});
test('content: nonempty answers r0->r1->r2 replacement/removal and explicitly empty higher revision are legal', () => {
  const [a, b] = current.questions.map(q => q.id); const r1 = nextAnswer(1, { [a]: ['answers/a.webp', 'answers/b.webp'], [b]: ['answers/c.webp'] });
  validateAnswers(r1); validateAnswerTransition(current, { revision: 0 }, r1, { version });
  const r2 = nextAnswer(2, { [a]: ['answers/replacement.webp'] }); validateAnswerTransition(current, r1, r2, { version });
  validateAnswerTransition(current, r2, nextAnswer(3, {}), { version });
});
test('content: answers enforce own program/library dependencies, IDs, revision and manifest agreement', () => {
  for (const mutate of [x => x.requiresProgram = '99.0.0', x => x.requiresLibraryRevision = 3, x => x.answers = { unknown: ['answers/a.webp'] }, x => x.libraryId = 'other', x => x.revision = 0]) {
    const next = nextAnswer(1); mutate(next); assert.throws(() => validateAnswerTransition(current, { revision: 0 }, next, { version }));
  }
  assert.throws(() => validateAnswerTransition(current, { revision: 0 }, nextAnswer(1), { version, expected: { revision: 1, requiresLibraryRevision: 1, requiresProgram: '0.5.0' } }));
});
test('content: answer schema rejects duplicate images, invalid program requirement and unsafe indexes', () => {
  for (const answers of [{ a: ['answers/a.webp', 'answers/a.webp'] }, { a: ['answers/a.webp'], b: ['answers/a.webp'] }, { a: ['../a.webp'] }]) assert.throws(() => validateAnswers(nextAnswer(1, answers)));
  const bad = nextAnswer(1); bad.requiresProgram = 'future'; assert.throws(() => validateAnswers(bad));
  const c = structuredClone(current); c.questions[0].id = '__proto__'; assert.throws(() => validateCatalog(c));
});
function gate() {
  const hooks = {}, app = { decorate(k, v) { this[k] = v; }, addHook(k, fn) { (hooks[k] ||= []).push(fn); } }, updates = { pauseWrites: false, busy: false };
  registerLocalWriteGate(app, updates);
  const call = async (hook, req) => { for (const fn of hooks[hook] || []) await fn(req); };
  return { app, updates, hooks, call };
}
test('gate: manual imports block all writes; existing upload/update blocks manual import including query strings', async () => {
  const { app, call, updates } = gate(); const req = { method: 'POST', url: '/api/local/import-pack?x=1' };
  await call('onRequest', req); assert.equal(app.localActiveWrites, 1);
  await assert.rejects(call('onRequest', { method: 'PUT', url: '/api/local/study' }), e => e.statusCode === 409);
  await call('onResponse', req); assert.equal(app.localActiveWrites, 0);
  updates.busy = true; await assert.rejects(call('onRequest', req)); updates.busy = false;
  const upload = { method: 'POST', url: '/api/admin/answers/q/photos' }; await call('onRequest', upload); await assert.rejects(call('onRequest', req)); await call('onResponse', upload);
});
test('gate: aborted in-flight handler remains locked until completed, then releases exactly once', async () => {
  const { app, hooks, call } = gate(); let release;
  const route = { method: 'POST', handler: async () => new Promise(r => release = r) }; hooks.onRoute[0](route);
  const req = { method: 'POST', url: '/api/local/import-pack' }; await call('onRequest', req); const running = route.handler(req, {});
  await call('onRequestAbort', req); assert.equal(app.localActiveWrites, 1);
  await call('onTimeout', req); await call('onResponse', req); assert.equal(app.localActiveWrites, 1);
  await assert.rejects(call('onRequest', { method: 'PUT', url: '/api/local/study' }), e => e.statusCode === 409); release(); await running; assert.equal(app.localActiveWrites, 0);
  await call('onResponse', req); assert.equal(app.localActiveWrites, 0);
});
