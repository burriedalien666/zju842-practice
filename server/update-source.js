import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { resolveNetwork, readNetworkConfig, requestHTTPS } from "./update-network.js";
import { validVersion } from "./update-files.js";

export const REPOSITORY = "burriedalien666/zju842-practice";
export const RELEASES = `https://github.com/${REPOSITORY}/releases`;
// Full Windows packages can still be making progress after ten minutes on slow
// connections. Keep the independent idle timeout and retry count bounded.
export const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
export const platformKey = () =>
  `${process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform}-${process.arch}`;
const assetUrl = (asset) =>
  `${RELEASES}/download/${asset.release}/${asset.name}`;
function asset(value) {
  if (
    !value ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value.release) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,149}$/.test(value.name) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > 1024 ** 3
  )
    throw new Error("发布文件信息不合法");
}
export function validateManifest(m) {
  if (
    !m ||
    m.format !== 1 ||
    m.libraryId !== "zju842" ||
    !validVersion(m.program?.version) ||
    m.program.protocol !== 1 ||
    typeof m.program.assets !== "object"
  )
    throw new Error("更新清单不受支持");
  for (const kind of ["program", "library", "answers"])
    if (
      m[kind]?.notes != null &&
      (typeof m[kind].notes !== "string" || m[kind].notes.length > 12000)
    )
      throw new Error("更新说明格式不正确");
  for (const p of ["windows-x64", "macos-x64", "macos-arm64"]) {
    const a = m.program.assets[p];
    asset(a);
    if (a.name !== `zju842-${m.program.version}-${p}.zip`)
      throw new Error("程序包与平台版本不匹配");
  }
  for (const kind of ["library", "answers"]) {
    const item = m[kind];
    if (
      !item ||
      !Number.isSafeInteger(item.revision) ||
      item.revision < 0 ||
      typeof item.edition !== "string" ||
      item.edition.length > 100 ||
      !validVersion(item.requiresProgram)
    )
      throw new Error("资料更新版本不合法");
    asset(item.asset);
    if (
      !item.asset.name.endsWith(kind === "library" ? ".842pack" : ".842answers")
    )
      throw new Error("资料包类型不匹配");
  }
  if (
    !Number.isSafeInteger(m.answers.requiresLibraryRevision) ||
    m.answers.requiresLibraryRevision < 0
  )
    throw new Error("答案依赖版本不合法");
  return m;
}
const HOSTS = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const transient = new Set(['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'INCOMPLETE']);
const knownCodes = new Set([...transient, 'ENOTFOUND', 'ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EEXIST', 'EIO', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID']);
const labels = {
  'github-api': 'GitHub \u53d1\u5e03\u63a5\u53e3', manifest: 'GitHub \u66f4\u65b0\u6e05\u5355',
  asset: 'GitHub \u53d1\u5e03\u6587\u4ef6', 'asset-cdn': 'GitHub CDN \u4e0b\u8f7d',
  stream: '\u66f4\u65b0\u6587\u4ef6\u4f20\u8f93', disk: '\u672c\u5730\u6587\u4ef6\u5199\u5165',
  'proxy-tunnel': '\u66f4\u65b0\u4ee3\u7406\u96a7\u9053',
  'proxy-policy': '\u66f4\u65b0\u4ee3\u7406\u914d\u7f6e',
};
export class UpdateNetworkError extends Error {
  constructor(code, stage, text, { httpStatus, retryable = false, retryAfter = 0 } = {}) {
    super(`${labels[stage] || 'GitHub'}\uff1a${text} [${code}${httpStatus ? '/' + httpStatus : ''}]`);
    Object.assign(this, { code, stage, httpStatus, retryable, retryAfter });
  }
}
function normalized(error, stage, signal) {
  if (error instanceof UpdateNetworkError) return error;
  if (error?.stage === 'proxy-policy') return new UpdateNetworkError(error.code, error.stage, error.message);
  if (error?.code === 'ERR_PROXY_TUNNEL') {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : undefined;
    return new UpdateNetworkError(status === 407 ? 'PROXY_AUTH' : 'PROXY_TUNNEL', 'proxy-tunnel',
      status === 407 ? '\u4ee3\u7406\u8ba4\u8bc1\u5931\u8d25\uff0c\u4e0d\u652f\u6301 NTLM/Kerberos \u81ea\u52a8\u767b\u5f55' : '\u4ee3\u7406\u65e0\u6cd5\u5efa\u7acb\u5b89\u5168\u8fde\u63a5\uff0c\u672a\u6539\u4e3a\u76f4\u8fde',
      { httpStatus: status, retryable: [429, 500, 502, 503, 504].includes(status) });
  }
  let code = error?.code || error?.cause?.code;
  if (signal?.aborted || ['AbortError', 'TimeoutError'].includes(error?.name)) code = 'UPDATE_TIMEOUT';
  else if (!knownCodes.has(code)) code = 'NETWORK_FAILURE';
  const text = code === 'ENOSPC' ? '\u78c1\u76d8\u7a7a\u95f4\u4e0d\u8db3' :
    code === 'UPDATE_TIMEOUT' ? '\u8bf7\u6c42\u8d85\u65f6\uff0c\u53ef\u91cd\u8bd5' :
    code.includes('CERT') || code.includes('VERIFY') ? '\u8bc1\u4e66\u9a8c\u8bc1\u5931\u8d25\uff0c\u672a\u5173\u95ed TLS \u6821\u9a8c' :
    '\u8fde\u63a5\u6216\u4f20\u8f93\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u66f4\u65b0\u7f51\u7edc\u8bbe\u7f6e\uff1b\u672c\u673a\u670d\u52a1\u4ecd\u53ef\u4f7f\u7528\u5df2\u6709\u9898\u76ee';
  return new UpdateNetworkError(code, stage, text, { retryable: transient.has(code) });
}
async function bounded(promise, signal) {
  signal.throwIfAborted();
  let abort;
  const interrupted = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([promise, interrupted]); }
  finally { signal.removeEventListener('abort', abort); }
}
async function consume(response, context, callback) {
  if (!response.body) throw new UpdateNetworkError('INCOMPLETE', context.stage, '\u4e0b\u8f7d\u4e0d\u5b8c\u6574', { retryable: true });
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await bounded(reader.read(), context.signal);
      if (done) break;
      await callback(value);
    }
  } finally {
    // A broken stream must not block cleanup or the next attempt.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
// Never accept a URL supplied by a browser or update manifest. The injected fetch
// seam is for controlled tests; production uses only the private HTTPS transport.
export class GitHubUpdates {
  constructor(fetchImpl, options = {}) {
    this.fetch = fetchImpl;
    this.options = options;
    this.events = [];
    this.network = null;
  }
  diagnostic() {
    return { format: 1, runtime: process.version, platform: platformKey(),
      network: this.network, events: this.events.map(e => ({ ...e })) };
  }
  record(event) {
    // No arbitrary strings, URL, proxy endpoint, headers, cookie, token, or paths.
    const safe = { at: Date.now() };
    for (const key of ['stage', 'attempt', 'code', 'httpStatus', 'received', 'total'])
      if (event[key] !== undefined) safe[key] = event[key];
    this.events.push(safe); this.events = this.events.slice(-50);
  }
  async operation(stage, timeout, fn, progress) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Update deadline', 'TimeoutError')), timeout);
    const context = { stage, signal: controller.signal, attempt: 0 };
    try {
      if (!this.fetch) {
        const route = await bounded(resolveNetwork({
          ...this.options.networkOptions,
          config: readNetworkConfig(this.options.dataDir), signal: context.signal,
        }), context.signal);
        context.proxyEnv = route.proxyEnv; this.network = route.summary;
      } else this.network = { source: 'injected-test-transport' };
      for (let attempt = 1; attempt <= (this.options.attempts ?? 3); attempt++) {
        context.attempt = attempt; context.stage = stage;
        try { return await fn(context); }
        catch (cause) {
          const e = normalized(cause, context.stage, context.signal);
          this.record({ stage: e.stage, code: e.code, httpStatus: e.httpStatus, attempt });
          if (!e.retryable || context.signal.aborted || attempt >= (this.options.attempts ?? 3)) throw e;
          const wait = Math.max(e.retryAfter, (this.options.retryDelay ?? 250) * 2 ** (attempt - 1));
          // Do not retry earlier than the server's Retry-After, or wait indefinitely.
          if (wait > 5000) throw e;
          progress?.(0, 0, { attempt: attempt + 1, retrying: true, code: e.code });
          await delay(wait, undefined, { signal: context.signal });
        }
      }
    } catch (e) { throw normalized(e, context.stage, context.signal); }
    finally { clearTimeout(timer); }
  }
  async response(url, timeout = 20000, context) {
    if (!context) {
      const signal = AbortSignal.timeout(timeout);
      const route = this.fetch ? {} : await resolveNetwork({
        ...this.options.networkOptions, config: readNetworkConfig(this.options.dataDir), signal,
      });
      context = { stage: 'asset', signal, proxyEnv: route.proxyEnv, attempt: 1 };
      if (route.summary) this.network = route.summary;
    }
    let target;
    try { target = new URL(url); } catch { throw new UpdateNetworkError('UNTRUSTED_URL', context.stage, '\u4e0b\u8f7d\u5730\u5740\u4e0d\u53ef\u4fe1'); }
    const visited = new Set();
    for (let i = 0; i < 5; i++) {
      if (target.protocol !== 'https:' || target.username || target.password || target.port || !HOSTS.has(target.hostname))
        throw new UpdateNetworkError('UNTRUSTED_URL', context.stage, '\u66f4\u65b0\u4e0b\u8f7d\u5730\u5740\u4e0d\u5728\u53ef\u4fe1\u53d1\u5e03\u670d\u52a1\u4e2d');
      if (visited.has(target.href)) throw new UpdateNetworkError('REDIRECT_LOOP', context.stage, '\u4e0b\u8f7d\u8df3\u8f6c\u5faa\u73af');
      visited.add(target.href);
      if (target.hostname.endsWith('githubusercontent.com')) context.stage = 'asset-cdn';
      const headers = { 'User-Agent': 'zju842-updater', 'Accept-Encoding': 'identity',
        Accept: target.hostname === 'api.github.com' ? 'application/vnd.github+json' : 'application/octet-stream' };
      let response;
      try {
        response = await bounded(this.fetch ? this.fetch(target.href, { redirect: 'manual', signal: context.signal, headers }) :
          requestHTTPS(target, { signal: context.signal, headers, proxyEnv: context.proxyEnv,
            idleTimeout: this.options.idleTimeout ?? 30000 }), context.signal);
      } catch (cause) { throw normalized(cause, context.stage, context.signal); }
      this.record({ stage: context.stage, attempt: context.attempt, httpStatus: response.status });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        void response.body?.cancel().catch(() => {});
        if (!location) throw new UpdateNetworkError('REDIRECT_MISSING', context.stage, '\u4e0b\u8f7d\u8df3\u8f6c\u7f3a\u5c11\u5730\u5740');
        try { target = new URL(location, target); }
        catch { throw new UpdateNetworkError('UNTRUSTED_URL', context.stage, '\u8df3\u8f6c\u5730\u5740\u65e0\u6548'); }
        continue;
      }
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        const retry = response.headers.get('retry-after');
        const retryAfter = retry == null ? 0 : /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0;
        throw new UpdateNetworkError('HTTP_STATUS', context.stage,
          response.status === 407 ? '\u4ee3\u7406\u8ba4\u8bc1\u5931\u8d25\uff0c\u4e0d\u652f\u6301 NTLM/Kerberos \u81ea\u52a8\u767b\u5f55' : '\u53d1\u5e03\u670d\u52a1\u62d2\u7edd\u6216\u6682\u65f6\u65e0\u6cd5\u54cd\u5e94',
          { httpStatus: response.status, retryAfter, retryable: [408, 429, 500, 502, 503, 504].includes(response.status) });
      }
      if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') {
        void response.body?.cancel().catch(() => {});
        throw new UpdateNetworkError('CONTENT_ENCODING', context.stage, '\u4e0b\u8f7d\u54cd\u5e94\u4f7f\u7528\u4e86\u975e\u9884\u671f\u7f16\u7801');
      }
      return response;
    }
    throw new UpdateNetworkError('REDIRECT_LIMIT', context.stage, '\u66f4\u65b0\u4e0b\u8f7d\u8df3\u8f6c\u8fc7\u591a');
  }
  async readJSON(url, context) {
    const response = await this.response(url, undefined, context);
    const chunks = []; let size = 0;
    await consume(response, context, chunk => {
      size += chunk.length;
      if (size > 1024 ** 2) throw new UpdateNetworkError('MANIFEST_SIZE', context.stage, '\u66f4\u65b0\u6e05\u5355\u8fc7\u5927');
      chunks.push(chunk);
    });
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new UpdateNetworkError('MANIFEST_JSON', context.stage, '\u66f4\u65b0\u6e05\u5355\u4e0d\u662f\u6709\u6548 JSON\uff0c\u53ef\u80fd\u662f\u7f51\u7edc\u8ba4\u8bc1\u9875'); }
  }
  async json(url) { return this.operation('manifest', this.options.checkTimeout ?? 20000, context => this.readJSON(url, context)); }
  async check() {
    return this.operation('github-api', this.options.checkTimeout ?? 20000, async context => {
      const r = await this.readJSON(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, context);
      if (r.draft || r.prerelease || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(r.tag_name))
        throw new UpdateNetworkError('RELEASE_INVALID', context.stage, '\u53d1\u5e03\u7248\u672c\u4e0d\u5408\u6cd5');
      const entry = Array.isArray(r.assets) && r.assets.find(a => a.name === 'zju842-updates.json');
      if (!entry) throw new UpdateNetworkError('MANIFEST_MISSING', context.stage, '\u5f53\u524d\u53d1\u5e03\u5c1a\u672a\u63d0\u4f9b\u5185\u7f6e\u66f4\u65b0\u6e05\u5355');
      context.stage = 'manifest';
      const data = await this.readJSON(assetUrl({ release: r.tag_name, name: entry.name }), context);
      try { return validateManifest(data); }
      catch { throw new UpdateNetworkError('MANIFEST_INVALID', context.stage, '\u66f4\u65b0\u6e05\u5355\u683c\u5f0f\u4e0d\u53d7\u652f\u6301'); }
    });
  }
  async download(item, file, progress = () => {}) {
    asset(item);
    return this.operation('asset', this.options.downloadTimeout ?? DOWNLOAD_TIMEOUT_MS, async context => {
      let output, owned = false, success = false, response, received = 0, first = Buffer.alloc(0);
      try {
        response = await this.response(assetUrl(item), undefined, context);
        const declared = response.headers.get('content-length');
        if (declared != null && (!/^\d+$/.test(declared) || Number(declared) !== item.size))
          throw new UpdateNetworkError('LENGTH_MISMATCH', context.stage, '\u4e0b\u8f7d\u6587\u4ef6\u5927\u5c0f\u4e0e\u53d1\u5e03\u4fe1\u606f\u4e0d\u7b26');
        if (/text\/html/i.test(response.headers.get('content-type') || ''))
          throw new UpdateNetworkError('HTML_RESPONSE', context.stage, '\u4e0b\u8f7d\u5230 HTML \u9875\u9762\uff0c\u4e0d\u662f\u66f4\u65b0\u5305');
        context.stage = 'disk'; output = fs.openSync(file, 'wx', 0o600); owned = true;
        context.stage = 'stream';
        progress(0, item.size, { attempt: context.attempt, retrying: false });
        await consume(response, context, chunk => {
          received += chunk.length;
          if (received > item.size) throw new UpdateNetworkError('LENGTH_MISMATCH', 'stream', '\u4e0b\u8f7d\u6587\u4ef6\u5927\u5c0f\u4e0e\u53d1\u5e03\u4fe1\u606f\u4e0d\u7b26');
          if (first.length < 4) first = Buffer.concat([first, Buffer.from(chunk).subarray(0, 4 - first.length)]);
          try { fs.writeFileSync(output, chunk); }
          catch (e) { throw normalized(e, 'disk', context.signal); }
          progress(received, item.size, { attempt: context.attempt });
        });
        if (received !== item.size) throw new UpdateNetworkError('INCOMPLETE', 'stream', '\u4e0b\u8f7d\u4e0d\u5b8c\u6574\uff0c\u8bf7\u91cd\u8bd5', { retryable: true });
        if (!['504b0304', '504b0506'].includes(first.toString('hex')))
          throw new UpdateNetworkError('NOT_ZIP', 'stream', '\u4e0b\u8f7d\u5185\u5bb9\u4e0d\u662f ZIP \u66f4\u65b0\u5305');
        context.stage = 'disk'; fs.fsyncSync(output); fs.closeSync(output); output = undefined;
        success = true; this.record({ stage: 'stream', code: 'DOWNLOAD_OK', received, total: item.size, attempt: context.attempt });
      } finally {
        if (output !== undefined) fs.closeSync(output);
        if (!success) {
          if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
          if (owned) fs.rmSync(file, { force: true });
        }
      }
    }, progress);
  }
}
