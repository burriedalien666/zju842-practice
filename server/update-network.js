// Update-only network policy. Never modifies global agents or system settings.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const LOCAL = 'localhost,127.0.0.1,::1,[::1]';
const policyError = (code, text) => Object.assign(new Error(text), { code, stage: 'proxy-policy' });
const value = (env, key) => (env[key.toLowerCase()] ?? env[key] ?? '').trim();
export function proxyURL(text) {
  try {
    if (typeof text !== 'string' || text.length > 2048 || /[\r\n\0]/.test(text)) throw 0;
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname ||
        url.pathname !== '/' || url.search || url.hash) throw 0;
    return url.href;
  } catch {
    throw policyError('PROXY_CONFIG', '\u4ee3\u7406\u914d\u7f6e\u65e0\u6548\uff1a\u4ec5\u652f\u6301 HTTP/HTTPS \u4ee3\u7406\uff0c\u4e0d\u652f\u6301 SOCKS\u3001PAC \u6216\u5e26\u8def\u5f84\u7684\u5730\u5740');
  }
}
function bypass(text = '') {
  if (typeof text !== 'string' || text.length > 4096 || /[\r\n\0]/.test(text))
    throw policyError('PROXY_CONFIG', 'NO_PROXY \u683c\u5f0f\u65e0\u6548');
  return [LOCAL, text].filter(Boolean).join(',');
}
export function validateNetworkConfig(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      Object.keys(config).some(k => !['mode', 'proxyUrl', 'noProxy'].includes(k)))
    throw policyError('PROXY_CONFIG', '\u66f4\u65b0\u7f51\u7edc\u914d\u7f6e\u65e0\u6548');
  const mode = config.mode ?? 'auto';
  if (!['auto', 'direct', 'environment', 'system', 'proxy'].includes(mode))
    throw policyError('PROXY_CONFIG', '\u66f4\u65b0\u7f51\u7edc\u6a21\u5f0f\u65e0\u6548');
  if (mode !== 'proxy' && config.proxyUrl != null)
    throw policyError('PROXY_CONFIG', '\u4ec5 proxy \u6a21\u5f0f\u53ef\u8bbe\u7f6e proxyUrl');
  return { mode, ...(mode === 'proxy' ? { proxyUrl: proxyURL(config.proxyUrl) } : {}),
    noProxy: bypass(config.noProxy ?? '') };
}
export function parseWindowsProxy(data) {
  if (data.AutoConfigURL || data.AutoDetect)
    throw policyError('PROXY_AUTOMATIC', '\u68c0\u6d4b\u5230 Windows PAC/WPAD\uff0c\u8bf7\u4f7f\u7528\u7ba1\u7406\u5458\u5141\u8bb8\u7684\u663e\u5f0f HTTP/HTTPS \u4ee3\u7406\uff0c\u6216\u7528\u6d4f\u89c8\u5668\u624b\u52a8\u4e0b\u8f7d\u5b8c\u6574\u5305\uff1b\u672a\u81ea\u52a8\u6539\u4e3a\u76f4\u8fde');
  if (!data.ProxyEnable) return { proxy: null, noProxy: '' };
  const text = String(data.ProxyServer || '').trim();
  let server = text;
  if (text.includes('=')) {
    const map = Object.fromEntries(text.split(';').filter(Boolean).map(p => {
      const n = p.indexOf('='); return [p.slice(0, n).trim().toLowerCase(), p.slice(n + 1).trim()];
    }));
    server = map.https;
    if (!server) throw policyError('PROXY_CONFIG', '\u7cfb\u7edf\u4ee3\u7406\u672a\u914d\u7f6e HTTPS\uff0c\u672a\u81ea\u52a8\u6539\u4e3a\u76f4\u8fde');
  }
  const noProxy = String(data.ProxyOverride || '').split(';').filter(x => x && x !== '<local>').join(',');
  return { proxy: proxyURL(server.includes('://') ? server : 'http://' + server), noProxy };
}
export function parseMacProxy(text) {
  const get = key => text.match(new RegExp('^\\s*' + key + '\\s*:\\s*(.*?)\\s*$', 'm'))?.[1];
  if (get('ProxyAutoConfigEnable') === '1' || get('ProxyAutoDiscoveryEnable') === '1')
    throw policyError('PROXY_AUTOMATIC', '\u68c0\u6d4b\u5230 macOS PAC/WPAD\uff0c\u8bf7\u4f7f\u7528\u7ecf\u6388\u6743\u7684\u663e\u5f0f HTTP/HTTPS \u4ee3\u7406\u6216\u6d4f\u89c8\u5668\u624b\u52a8\u4e0b\u8f7d\uff1b\u672a\u81ea\u52a8\u76f4\u8fde');
  if (get('SOCKSEnable') === '1' && get('HTTPSEnable') !== '1')
    throw policyError('PROXY_CONFIG', '\u7cfb\u7edf\u4ec5\u914d\u7f6e SOCKS\uff0c\u8bf7\u4f7f\u7528 HTTP/HTTPS \u4ee3\u7406\u6216\u624b\u52a8\u4e0b\u8f7d');
  if (get('HTTPSEnable') !== '1') {
    if (get('HTTPEnable') === '1') throw policyError('PROXY_CONFIG', '\u7cfb\u7edf\u4ee3\u7406\u672a\u914d\u7f6e HTTPS');
    return { proxy: null, noProxy: '' };
  }
  const exceptions = text.match(/ExceptionsList\s*:\s*<array>\s*\{([\s\S]*?)\}/)?.[1] || '';
  const noProxy = [...exceptions.matchAll(/\d+\s*:\s*(\S+)/g)].map(m => m[1]).join(',');
  return { proxy: proxyURL('http://' + get('HTTPSProxy') + ':' + get('HTTPSPort')), noProxy };
}
export async function readSystemProxy(platform = process.platform, run = execute, signal) {
  const options = { encoding: 'utf8', timeout: 5000, maxBuffer: 32 * 1024, windowsHide: true, signal };
  try {
    if (platform === 'win32') {
      // Fixed script, no interpolated user input. Read current-user WinINET, not WinHTTP.
      const script = "$ErrorActionPreference='Stop';$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';$p=Get-ItemProperty -LiteralPath $k;$c=Get-ItemProperty -LiteralPath ($k+'\\Connections') -ErrorAction SilentlyContinue;$b=$c.DefaultConnectionSettings;@{ProxyEnable=$p.ProxyEnable;ProxyServer=$p.ProxyServer;ProxyOverride=$p.ProxyOverride;AutoConfigURL=$p.AutoConfigURL;AutoDetect=($b -and $b.Length -gt 8 -and (($b[8] -band 8) -ne 0))}|ConvertTo-Json -Compress";
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], options);
      return parseWindowsProxy(JSON.parse(stdout.replace(/^\uFEFF/, '')));
    }
    if (platform === 'darwin') {
      const { stdout } = await run('/usr/sbin/scutil', ['--proxy'], options);
      if (!stdout.includes('<dictionary>')) throw new Error('invalid output');
      return parseMacProxy(stdout);
    }
    return { proxy: null, noProxy: '' };
  } catch (e) {
    if (e.stage === 'proxy-policy') throw e;
    if (signal?.aborted) throw signal.reason;
    throw policyError('PROXY_DISCOVERY', '\u65e0\u6cd5\u8bfb\u53d6\u7cfb\u7edf\u4ee3\u7406\uff0c\u672a\u81ea\u52a8\u6539\u4e3a\u76f4\u8fde\uff1b\u8bf7\u660e\u786e\u9009\u62e9\u66f4\u65b0\u7f51\u7edc\u6a21\u5f0f');
  }
}
export async function resolveNetwork({ config = {}, env = process.env, platform = process.platform,
  discover = readSystemProxy, signal } = {}) {
  const c = validateNetworkConfig(config);
  let proxy = null, noProxy = '', source = c.mode;
  if (c.mode === 'proxy') proxy = c.proxyUrl;
  else if (c.mode !== 'direct') {
    const httpsProxy = value(env, 'HTTPS_PROXY'), httpProxy = value(env, 'HTTP_PROXY'), allProxy = value(env, 'ALL_PROXY');
    if (c.mode === 'environment' || (c.mode === 'auto' && (httpsProxy || httpProxy || allProxy))) {
      // Explicitly documented HTTPS -> HTTP fallback for HTTPS CONNECT; never silently DIRECT.
      proxy = proxyURL(httpsProxy || httpProxy || allProxy);
      noProxy = value(env, 'NO_PROXY'); source = 'environment';
    } else {
      const system = await discover(platform, undefined, signal);
      proxy = system.proxy; noProxy = system.noProxy; source = proxy ? 'system' : 'direct';
    }
  }
  const normalized = proxy ? proxyURL(proxy) : null;
  return {
    proxyEnv: { HTTPS_PROXY: normalized || '', HTTP_PROXY: normalized || '', NO_PROXY: bypass([c.noProxy, noProxy].filter(Boolean).join(',')) },
    summary: { mode: c.mode, source, proxyConfigured: !!normalized,
      authenticationConfigured: !!(normalized && (new URL(normalized).username || new URL(normalized).password)),
      localBypass: true, noProxyConfigured: !!(config.noProxy || noProxy) },
  };
}
export function readNetworkConfig(dataDir) {
  if (!dataDir) return {};
  try {
    const file = path.join(dataDir, 'update-network.json');
    if (!fs.existsSync(file)) return {};
    if (!fs.lstatSync(file).isFile() || fs.statSync(file).size > 8192) throw new Error();
    const c = JSON.parse(fs.readFileSync(file, 'utf8')); validateNetworkConfig(c); return c;
  } catch (e) {
    if (e.stage === 'proxy-policy') throw e;
    throw policyError('PROXY_CONFIG', '\u66f4\u65b0\u7f51\u7edc\u914d\u7f6e\u6587\u4ef6\u65e0\u6548\uff0c\u672a\u4f7f\u7528\u9ed8\u8ba4\u76f4\u8fde');
  }
}
// Native node:https with a private per-request Agent. No third-party proxy library,
// no TLS bypass, no ambient global fetch/agent changes, including localhost calls.
export function requestHTTPS(url, { headers, signal, proxyEnv, idleTimeout = 30000, ca } = {}) {
  return new Promise((resolve, reject) => {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 24 || (major === 24 && minor < 5)) {
      reject(policyError('RUNTIME_UNSUPPORTED', '\u66f4\u65b0\u4f20\u8f93\u9700\u8981\u652f\u6301 proxyEnv \u7684 Node \u8fd0\u884c\u65f6\uff0c\u8bf7\u4f7f\u7528\u5b8c\u6574\u53d1\u5e03\u5305'));
      return;
    }
    const agent = new https.Agent({ keepAlive: false, proxyEnv, ...(ca ? { ca } : {}) });
    let req;
    try {
      req = https.request(url, { method: 'GET', headers, signal, agent }, incoming => {
        try {
        const h = new Headers();
        for (let i = 0; i < incoming.rawHeaders.length; i += 2)
          h.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
        incoming.once('close', () => agent.destroy());
        const empty = [204, 205, 304].includes(incoming.statusCode);
        if (empty) incoming.resume();
        resolve(new Response(empty ? null : Readable.toWeb(incoming), { status: incoming.statusCode, headers: h }));
        } catch (e) { incoming.destroy(); agent.destroy(); reject(e); }
      });
      req.setTimeout(idleTimeout, () => req.destroy(Object.assign(new Error('idle timeout'), { code: 'ETIMEDOUT' })));
      req.once('error', e => { agent.destroy(); reject(e); });
      req.end();
    } catch (e) { agent.destroy(); reject(e); }
  });
}
