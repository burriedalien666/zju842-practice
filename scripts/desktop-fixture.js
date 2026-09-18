// Test-only fixture selection. This does not relax production ZIP validation.
import fs from 'node:fs';
import path from 'node:path';
const directories = new Set(['server','src','dist','public','runtime','node_modules']);
const rootFiles = new Set(['package.json','LICENSE','CONTENT-NOTICE.md','\u4f7f\u7528\u8bf4\u660e.md','\u542f\u52a8\u9898\u5e93.cmd','\u542f\u52a8\u9898\u5e93.command']);
const forbidden = new Set(['userdata','data','.git','.env','.app-versions','.app-current.json','.app-pending.json','.app-lock']);
export function desktopFixtureEntries(root) {
  const result=[];
  function walk(directory,prefix='') {
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      if(forbidden.has(entry.name)||entry.name.startsWith('.env.')) continue;
      const name=prefix+entry.name,file=path.join(directory,entry.name);
      if(!prefix && !(entry.isDirectory()?directories.has(entry.name):rootFiles.has(entry.name))) continue;
      if(entry.isSymbolicLink()) throw new Error('Fixture contains a symbolic link: '+name);
      if(entry.isDirectory()) walk(file,name+'/');
      else if(entry.isFile()) result.push({name,file});
      else throw new Error('Fixture contains a non-regular file: '+name);
    }
  }
  walk(root); return result;
}
export const redactFixtureOutput = text => String(text).replace(/(TEST_START_URL=)[^\s]+/g,'$1[REDACTED]').replace(/(\/__open\/)[a-zA-Z0-9_-]+/g,'$1[REDACTED]');
export async function waitForFixture(predicate, {timeout=60000,interval=150,inspect=async()=>null,processExited=()=>false,output=()=>''}={}) {
  const deadline=Date.now()+timeout; let last;
  while(Date.now()<deadline) {
    try { if(await predicate()) return; }
    catch(e) { if(e.code==='ERR_ASSERTION') throw e; }
    try { last=await inspect(); } catch { /* Expected only during service restart. */ }
    if(last?.job?.state==='failed') throw new Error('Upgrade job failed: '+redactFixtureOutput(last.job.message));
    if(processExited()) throw new Error('Supervisor exited: '+redactFixtureOutput(output()));
    await new Promise(r=>setTimeout(r,interval));
  }
  throw new Error('Upgrade timed out; job='+redactFixtureOutput(JSON.stringify(last?.job||null))+'; '+redactFixtureOutput(output()));
}
