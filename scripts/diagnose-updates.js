// Read-only diagnosis: no settings changes, no package download or installation.
import fs from 'node:fs';
import path from 'node:path';
import { GitHubUpdates } from '../server/update-source.js';
import { readNetworkConfig, resolveNetwork } from '../server/update-network.js';
const args=process.argv.slice(2);
if(args.includes('--help')) {
  console.log('node scripts/diagnose-updates.js --data-dir <current userdata directory> [--check] [--output <new JSON file>]');
  console.log('Default: local policy only. --check: GitHub API/manifest only, no asset install. Never paste credentials in command arguments.');
  process.exit(0);
}
function option(name){const n=args.indexOf(name);if(n<0)return null;if(!args[n+1]||args[n+1].startsWith('--'))throw new Error('Missing '+name);return args[n+1];}
let output;
let report={format:1,at:new Date().toISOString(),runtime:process.version,platform:process.platform+'-'+process.arch,readOnly:true};
try {
  const known=new Set(['--data-dir','--output','--check']);
  for(let i=0;i<args.length;i++){if(!known.has(args[i]))throw new Error('Unknown argument');if(args[i]!=='--check')i++;}
  output=option('--output');
  const dir=option('--data-dir'); if(!dir)throw new Error('Specify --data-dir for the instance being diagnosed');
  const dataDir=path.resolve(dir); if(!fs.statSync(dataDir).isDirectory())throw new Error('Data directory unavailable');
  report.network=(await resolveNetwork({config:readNetworkConfig(dataDir)})).summary;
  report.systemCAFlag=process.execArgv.includes('--use-system-ca') || /(?:^|\s)--use-system-ca(?:\s|$)/.test(process.env.NODE_OPTIONS||'');
  report.extraCAConfigured=!!process.env.NODE_EXTRA_CA_CERTS;
  if(args.includes('--check')){
    const source=new GitHubUpdates(undefined,{dataDir});
    try{const m=await source.check();report.check={ok:true,program:m.program.version,library:m.library.revision,answers:m.answers.revision};}
    catch(e){report.check={ok:false,code:e.code||'CHECK_FAILED',stage:e.stage||'unknown'};process.exitCode=2;}
    report.events=source.diagnostic().events;
  }
  report.ok=process.exitCode!==2;
}catch(e){report.ok=false;report.error={code:/^[A-Z][A-Z0-9_]{0,60}$/.test(e.code||'')?e.code:'DIAGNOSTIC_INPUT',stage:e.stage||'local-configuration'};process.exitCode=2;}
const text=JSON.stringify(report,null,2)+'\n';
if(output){try{fs.writeFileSync(path.resolve(output),text,{flag:'wx',mode:0o600});}catch{console.error('Cannot create diagnostic output; existing files are never overwritten');process.exitCode=2;}}
console.log(text);
