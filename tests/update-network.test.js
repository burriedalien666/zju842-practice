import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { proxyURL, parseWindowsProxy, parseMacProxy, resolveNetwork, readNetworkConfig, requestHTTPS, readSystemProxy } from '../server/update-network.js';
import { GitHubUpdates, DOWNLOAD_TIMEOUT_MS } from '../server/update-source.js';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
const zip = Buffer.from('504b030400000000', 'hex');
const item = { release: 'fixture', name: 'fixture.zip', size: zip.length };
const url = 'https://github.com/fixture';
function temp(t) { const d = fs.mkdtempSync(path.join(os.tmpdir(), '842-network-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; }
const make = (fn, opts = {}) => new GitHubUpdates(fn, { retryDelay: 1, ...opts });

test('slow full-package downloads get thirty minutes while explicit test deadlines remain supported', async () => {
  const source = new GitHubUpdates();
  let budget;
  source.operation = async (stage, timeout) => { assert.equal(stage, 'asset'); budget = timeout; };
  await source.download(item, 'not-written');
  assert.equal(budget, 30 * 60 * 1000);
  assert.equal(budget, DOWNLOAD_TIMEOUT_MS);
  source.options.downloadTimeout = 75;
  await source.download(item, 'not-written');
  assert.equal(budget, 75);
});

test('policy: explicit proxy > environment > system; direct requires explicit selection', async () => {
  let calls = 0;
  const discover = async () => { calls++; return { proxy: 'http://system.test:8080', noProxy: '' }; };
  let result = await resolveNetwork({ config: { mode: 'proxy', proxyUrl: 'http://chosen.test:8888' }, env: { HTTPS_PROXY: 'http://env.test' }, discover });
  assert.match(result.proxyEnv.HTTPS_PROXY, /chosen/); assert.equal(calls, 0);
  result = await resolveNetwork({ env: { HTTPS_PROXY: 'http://upper.test', https_proxy: 'http://lower.test', NO_PROXY: '.example.test' }, discover });
  assert.match(result.proxyEnv.HTTPS_PROXY, /lower/); assert.equal(calls, 0);
  assert.match(result.proxyEnv.NO_PROXY, /127\.0\.0\.1/); assert.match(result.proxyEnv.NO_PROXY, /\.example\.test/);
  result = await resolveNetwork({ env: {}, discover }); assert.match(result.proxyEnv.HTTPS_PROXY, /system/); assert.equal(calls, 1);
  result = await resolveNetwork({ config: { mode: 'direct' }, env: { HTTPS_PROXY: 'http://env.test' }, discover });
  assert.equal(result.proxyEnv.HTTPS_PROXY, ''); assert.equal(calls, 1);
});
test('policy: missing/invalid explicit configuration never silently falls back', async () => {
  await assert.rejects(resolveNetwork({ config: { mode: 'environment' }, env: {} }), /PROXY|\u4ee3\u7406/);
  await assert.rejects(resolveNetwork({ env: { ALL_PROXY: 'socks5://localhost:1080' } }), /SOCKS/);
  for (const p of ['socks5://host', 'http://host/path', 'http://host?password=secret', 'http://host/#secret', 'http://host\nX:x']) assert.throws(() => proxyURL(p));
  const safe = proxyURL('http://user:p%40ss@localhost:3128'); assert.match(safe, /p%40ss/);
});
test('policy: Windows WinINET and macOS static proxies parsed; PAC/WPAD/SOCKS fail closed', () => {
  assert.equal(parseWindowsProxy({ ProxyEnable: 1, ProxyServer: '127.0.0.1:8080' }).proxy, 'http://127.0.0.1:8080/');
  assert.equal(parseWindowsProxy({ ProxyEnable: 1, ProxyServer: 'http=a:80;https=b:81' }).proxy, 'http://b:81/');
  assert.throws(() => parseWindowsProxy({ AutoConfigURL: 'http://private/pac?secret=x' }), /PAC/);
  assert.throws(() => parseWindowsProxy({ AutoDetect: true }), /WPAD/);
  assert.throws(() => parseWindowsProxy({ ProxyEnable: 1, ProxyServer: 'socks=a:90' }));
  assert.equal(parseMacProxy('<dictionary> {\n HTTPSEnable : 1\n HTTPSProxy : proxy.test\n HTTPSPort : 8080\n}').proxy, 'http://proxy.test:8080/');
  assert.throws(() => parseMacProxy(' ProxyAutoDiscoveryEnable : 1\n'), /WPAD/);
  assert.throws(() => parseMacProxy(' SOCKSEnable : 1\n'), /SOCKS/);
});
test('policy: discovery subprocess failure is sanitized; config file errors are not DIRECT', async t => {
  await assert.rejects(readSystemProxy('win32', async () => { throw new Error('password=do-not-print'); }), e => e.code === 'PROXY_DISCOVERY' && !e.message.includes('do-not-print'));
  const d = temp(t); fs.writeFileSync(path.join(d, 'update-network.json'), '{broken');
  assert.throws(() => readNetworkConfig(d), e => e.code === 'PROXY_CONFIG');
});
test('download: transient reset retries same URL, writes exact bytes and records sanitized diagnostics', async t => {
  const file = path.join(temp(t), 'out'); let calls = 0;
  const source = make(async () => { if (++calls === 1) throw Object.assign(new Error('http://user:password@host?secret=abc'), { code: 'ECONNRESET' }); return new Response(zip); });
  const progress = []; await source.download(item, file, (...p) => progress.push(p));
  assert.deepEqual(fs.readFileSync(file), zip); assert.equal(calls, 2);
  assert.ok(progress.some(p => p[2]?.retrying));
  assert.doesNotMatch(JSON.stringify(source.diagnostic()), /password|secret|http:\/\//);
});
test('download: broken body retries from zero and removes partial output on terminal failure', async t => {
  const file = path.join(temp(t), 'out'); let calls = 0;
  const source = make(async () => { calls++; return new Response(new ReadableStream({ start(c) { c.enqueue(zip.subarray(0, 4)); }, pull(c) { c.error(Object.assign(new Error('broken'), { code: 'ECONNRESET' })); } })); });
  await assert.rejects(source.download(item, file), e => e.code === 'ECONNRESET');
  assert.equal(calls, 3); assert.equal(fs.existsSync(file), false);
});
test('download: incomplete body, oversize, content length, HTML, fake ZIP all fail without residual file', async t => {
  const d = temp(t);
  const cases = [
    [() => new Response(zip.subarray(0, 4)), 'INCOMPLETE'],
    [() => new Response(Buffer.concat([zip, zip])), 'LENGTH_MISMATCH'],
    [() => new Response(zip, { headers: { 'Content-Length': '99' } }), 'LENGTH_MISMATCH'],
    [() => new Response('<html />', { headers: { 'Content-Type': 'text/html' } }), 'HTML_RESPONSE'],
    [() => new Response('notazip!'), 'NOT_ZIP'],
  ];
  for (const [fn, code] of cases) { const file = path.join(d, code); await assert.rejects(make(fn).download(item, file), e => e.code === code); assert.equal(fs.existsSync(file), false); }
});
test('download: existing destination is never overwritten or removed', async t => {
  const file = path.join(temp(t), 'out'); fs.writeFileSync(file, 'keep');
  await assert.rejects(make(async () => new Response(zip)).download(item, file), e => e.code === 'EEXIST');
  assert.equal(fs.readFileSync(file, 'utf8'), 'keep');
});
test('download: fs ENOSPC is not replayed, stream canceled and partial output removed', async t => {
  const file = path.join(temp(t), 'out'); let calls = 0, canceled = false;
  const source = make(async () => { calls++; return new Response(new ReadableStream({ start(c) { c.enqueue(zip); }, cancel() { canceled = true; } })); });
  const original = fs.writeFileSync;
  fs.writeFileSync = (...args) => { if (typeof args[0] === 'number') throw Object.assign(new Error('private/path'), { code: 'ENOSPC' }); return original(...args); };
  try { await assert.rejects(source.download(item, file), e => e.code === 'ENOSPC' && e.stage === 'disk'); }
  finally { fs.writeFileSync = original; }
  assert.equal(calls, 1); assert.equal(canceled, true); assert.equal(fs.existsSync(file), false);
});
test('network: HTTP status retries are bounded; authorization and long Retry-After are not replayed', async t => {
  for (const [status, attempts] of [[403, 1], [404, 1], [407, 1], [429, 3], [500, 3], [502, 3], [503, 3]]) {
    let calls = 0; const source = make(async () => { calls++; return new Response(null, { status }); });
    await assert.rejects(source.download(item, path.join(temp(t), 'out')), e => e.httpStatus === status);
    assert.equal(calls, attempts);
  }
  let count = 0; await assert.rejects(make(async () => { count++; return new Response(null, { status: 429, headers: { 'Retry-After': '60' } }); }).json(url)); assert.equal(count, 1);
});
test('network: untrusted URLs, credentials, alternate ports and redirect loops fail closed', async () => {
  for (const dest of ['http://127.0.0.1/', 'https://evil.test/', 'https://user:pw@github.com/', 'https://github.com:444/']) {
    const source = make(async () => new Response(null, { status: 302, headers: { location: dest } }));
    await assert.rejects(source.response(url), e => e.code === 'UNTRUSTED_URL');
  }
  await assert.rejects(make(async () => new Response(null, { status: 302, headers: { location: url } })).response(url), e => e.code === 'REDIRECT_LOOP');
  await assert.rejects(make(async () => new Response(null, { status: 302 })).response(url), e => e.code === 'REDIRECT_MISSING');
});
test('network: API success then CDN failure names correct stage, without signed query', async () => {
  let calls = 0;
  const source = make(async target => {
    calls++;
    if (target.includes('api.github.com')) return new Response(JSON.stringify({ tag_name: 'fixture', assets: [{ name: 'zju842-updates.json' }] }));
    if (target.includes('github.com/')) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset?sig=secret' } });
    throw Object.assign(new Error('signed URL secret'), { code: 'ENOTFOUND' });
  });
  await assert.rejects(source.check(), e => e.stage === 'asset-cdn' && e.code === 'ENOTFOUND' && !e.message.includes('secret'));
  assert.equal(calls, 3);
});
test('timeouts cover stalled headers, JSON body and asset stream (including mocks ignoring signals)', async t => {
  const start = Date.now();
  await assert.rejects(make(() => new Promise(() => {}), { checkTimeout: 40 }).json(url), e => e.code === 'UPDATE_TIMEOUT');
  const stalled = () => new Response(new ReadableStream({ start(c) { c.enqueue(Buffer.from('{')); } }));
  await assert.rejects(make(stalled, { checkTimeout: 40 }).json(url), e => e.code === 'UPDATE_TIMEOUT');
  const file = path.join(temp(t), 'out');
  await assert.rejects(make(stalled, { downloadTimeout: 40 }).download(item, file), e => e.code === 'UPDATE_TIMEOUT');
  assert.equal(fs.existsSync(file), false); assert.ok(Date.now() - start < 2000);
});
test('manifest: invalid JSON and oversized bodies fail clearly and cancel stream', async () => {
  await assert.rejects(make(async () => new Response('<html>')).json(url), e => e.code === 'MANIFEST_JSON');
  await assert.rejects(make(async () => new Response('x'.repeat(1024 ** 2 + 1))).json(url), e => e.code === 'MANIFEST_SIZE');
});
test('real local HTTPS CONNECT: proxy authentication, TLS validation, NO_PROXY and no fallback', async t => {
  const d = temp(t), key = path.join(d, 'key.pem'), cert = path.join(d, 'cert.pem');
  try { execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=api.github.com', '-addext', 'subjectAltName=DNS:api.github.com,IP:127.0.0.1'], { stdio: 'ignore' }); }
  catch { t.skip('openssl unavailable; real TLS/CONNECT fixture not run'); return; }
  const ca = fs.readFileSync(cert); let direct = 0, connects = 0, auth;
  const origin = https.createServer({ key: fs.readFileSync(key), cert: ca }, (req, res) => { direct++; res.end(zip); });
  const sockets = new Set();
  const proxy = http.createServer();
  for (const s of [origin, proxy]) s.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(r => origin.listen(0, '127.0.0.1', r));
  proxy.on('connect', (req, client, head) => {
    connects++; auth = req.headers['proxy-authorization'];
    const upstream = net.connect(origin.address().port, '127.0.0.1', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); client.pipe(upstream).pipe(client); });
    sockets.add(upstream); upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy());
  });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  t.after(async () => { for (const s of sockets) s.destroy(); await Promise.all([new Promise(r => proxy.close(r)), new Promise(r => origin.close(r))]); });
  const proxyEnv = { HTTPS_PROXY: `http://test:pass@127.0.0.1:${proxy.address().port}`, NO_PROXY: 'localhost,127.0.0.1' };
  let res = await requestHTTPS('https://api.github.com/test', { proxyEnv, ca, signal: AbortSignal.timeout(3000) });
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), zip); assert.equal(connects, 1); assert.equal(auth, 'Basic ' + Buffer.from('test:pass').toString('base64'));
  res = await requestHTTPS(`https://127.0.0.1:${origin.address().port}/test`, { proxyEnv, ca, signal: AbortSignal.timeout(3000) }); await res.arrayBuffer();
  assert.equal(connects, 1, 'localhost bypasses proxy');
  await assert.rejects(requestHTTPS('https://api.github.com/test', { proxyEnv, signal: AbortSignal.timeout(3000) }));
  const before = direct;
  await assert.rejects(requestHTTPS(`https://127.0.0.1:${origin.address().port}/test`, { proxyEnv: { HTTPS_PROXY: 'http://127.0.0.1:1', NO_PROXY: '' }, ca, signal: AbortSignal.timeout(1000) }));
  assert.equal(direct, before, 'failed explicit proxy never falls back to reachable direct origin');
});

test('real CONNECT 407 maps to sanitized proxy authentication failure without direct fallback',async t=>{
  const p=http.createServer();let calls=0;
  p.on('connect',(req,socket)=>{calls++;socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n')});
  await new Promise(r=>p.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>p.close(r)));
  const d=temp(t);fs.writeFileSync(path.join(d,'update-network.json'),JSON.stringify({mode:'proxy',proxyUrl:'http://fixture-user:fixture-secret@127.0.0.1:'+p.address().port}));
  const source=new GitHubUpdates(undefined,{dataDir:d,checkTimeout:2000});
  await assert.rejects(source.check(),e=>e.code==='PROXY_AUTH'&&e.httpStatus===407&&!e.message.includes('fixture-secret'));
  assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(source.diagnostic()),/fixture-user|fixture-secret|127\.0\.0\.1/);
});
