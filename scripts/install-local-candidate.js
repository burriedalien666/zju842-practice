import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {isDeepStrictEqual} from 'node:util';
import {validateManifest} from '../server/update-source.js';
import {atomicJson} from '../server/update-files.js';

// Uses the existing supervisor and update endpoints. No in-place program overwrite or database restore.
const root=path.resolve(process.argv[2]),bundle=path.resolve(process.argv[3]),out=path.resolve(process.argv[4]),port=Number(process.argv[5]||8843);
const dataDir=path.join(root,'userdata'),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
if(pkg.name!=='zju842-practice'||pkg.version!=='0.5.7')throw Error('This migration expects the selected 0.5.7 installation');
const alive=pid=>{if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
for(const file of [path.join(dataDir,'desktop.lock'),path.join(root,'.app-lock')])if(fs.existsSync(file)){const lock=JSON.parse(fs.readFileSync(file));if(alive(lock.pid)||alive(lock.childPid))throw Error('The selected installation is still running; close it first');}
const asset=name=>({release:'local-candidate',name,size:fs.statSync(path.join(bundle,name)).size});
const manifest=validateManifest({format:1,libraryId:'zju842',program:{version:'0.5.8',protocol:1,assets:Object.fromEntries(['windows-x64','macos-x64','macos-arm64'].map(p=>[p,p==='windows-x64'?asset('zju842-0.5.8-windows-x64.zip'):{release:'local-candidate',name:'zju842-0.5.8-'+p+'.zip',size:1}]))},library:{revision:4,edition:'全题库结构化',requiresProgram:'0.5.8',asset:asset('zju842-library-r4.842pack')},answers:{revision:0,edition:'公共答案保持原版',requiresProgram:'0.5.0',requiresLibraryRevision:2,asset:{release:'local-candidate',name:'unchanged.842answers',size:1}}});
fs.mkdirSync(out,{recursive:true});atomicJson(path.join(bundle,'zju842-updates.json'),manifest);
const cachePath=path.join(dataDir,'update-cache.json'),originalCache=fs.existsSync(cachePath)?fs.readFileSync(cachePath):null;
function privateSnapshot(){
 const db=new DatabaseSync(path.join(dataDir,'site.sqlite'),{readOnly:true});
 try{return Object.fromEntries(['photos','answers','local_state'].map(name=>[name,db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));}finally{db.close();}
}
const before=privateSnapshot();let child,log='',origin,cookie;
async function launch(offline){
 log='';const env={...process.env,ZJU842_DATA_DIR:dataDir,ZJU842_NO_BROWSER:'1',ZJU842_PORT:String(port)};
 if(offline){env.NODE_OPTIONS='--import='+pathToFileURL(path.resolve('scripts/local-candidate-transport.js')).href;env.ZJU842_LOCAL_CANDIDATE=bundle;}
 else{delete env.NODE_OPTIONS;delete env.ZJU842_LOCAL_CANDIDATE;}
 const logFile=path.join(out,offline?'launcher-offline.log':'launcher-normal.log'),fd=fs.openSync(logFile,'w');let launchError;
 child=spawn(path.join(root,'runtime/node.exe'),[path.join(root,'server/desktop.js')],{cwd:root,env,windowsHide:true,detached:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);child.once('error',e=>launchError=e);
 const end=Date.now()+30000;while(!log.match(/TEST_START_URL=(\S+)/)){if(launchError||Date.now()>end||child.exitCode!==null)throw Error('Local launcher did not become ready');await new Promise(r=>setTimeout(r,100));log=fs.readFileSync(logFile,'utf8');}
 const url=log.match(/TEST_START_URL=(\S+)/)[1];origin=new URL(url).origin;if(new URL(origin).port!==String(port))throw Error('Requested local port was occupied');
 const res=await fetch(url,{redirect:'manual'});if(res.status!==302)throw Error('Local session failed');cookie=res.headers.get('set-cookie').split(';')[0];return url;
}
async function stopOwned(){
 if(!child)return;const owner=child.pid,lockPath=path.join(dataDir,'desktop.lock'),lock=fs.existsSync(lockPath)?JSON.parse(fs.readFileSync(lockPath)):null;
 if(lock&&lock.pid!==owner)throw Error('Local launcher owner changed');
 if(child.exitCode===null){const done=once(child,'close');child.kill();await done;}
 const end=Date.now()+10000;while(alive(lock?.childPid)){if(Date.now()>end)throw Error('Owned local child still running');await new Promise(r=>setTimeout(r,100));}
 for(const file of [lockPath,path.join(root,'.app-lock')])if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file)).pid===owner)fs.unlinkSync(file);
 child=null;
}
async function api(route,body,headers={}){
 const res=await fetch(origin+'/api'+route,{method:body===undefined?'GET':'POST',headers:{cookie,Origin:origin,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 if(res.status===503&&body===undefined)return null;
 if(!res.ok)throw Error('Local API failed: '+route+' '+res.status);
 return res.json();
}
const report={root,dataDir,program:false,library:false,privateDataPreserved:false};
try{
 await launch(true);console.log('Selected original launcher started; installing local program through its updater.');
 const study=await api('/local/study');await api('/local/updates/check',{});await api('/local/updates/install',{kind:'program',target:'0.5.8'},{'If-Match':study.revision});
 const end=Date.now()+120000;let active=false;
 while(Date.now()<end){
  try{if((await api('/local/info'))?.version==='0.5.8'){active=true;break;}const status=await api('/local/updates');if(status?.job?.state==='failed')throw Error('Program installation failed: '+status.job.message);}catch(e){if(!['TypeError'].includes(e.name))throw e;}
  await new Promise(r=>setTimeout(r,200));
 }
 if(!active)throw Error('Program activation timeout');report.program=true;
 if(!isDeepStrictEqual(await api('/local/study'),study))throw Error('Study changed unexpectedly during activation');
 console.log('Program activated; installing the full structured library through the normal import endpoint.');
 const form=new FormData();form.append('file',new Blob([fs.readFileSync(path.join(bundle,'zju842-library-r4.842pack'))],{type:'application/zip'}),'zju842-library-r4.842pack');
 const imported=await fetch(origin+'/api/local/import-pack',{method:'POST',headers:{cookie,Origin:origin},body:form});if(!imported.ok)throw Error('Library import failed: '+imported.status);
 const catalog=await(await fetch(origin+'/catalog.json')).json();if(catalog.libraryRevision!==4||catalog.structured?.groups.length!==250||catalog.questions.length!==469)throw Error('Unexpected library readback');report.library=true;
 if(!isDeepStrictEqual(privateSnapshot(),before))throw Error('Private records differ after migration');report.privateDataPreserved=true;
 await stopOwned();
 if(originalCache)fs.writeFileSync(cachePath,originalCache);else if(fs.existsSync(cachePath))fs.unlinkSync(cachePath);
 const url=await launch(false);if((await api('/local/info'))?.version!=='0.5.8')throw Error('Original launcher did not retain activation');
 if(!isDeepStrictEqual(privateSnapshot(),before))throw Error('Private records differ after restart');
 fs.writeFileSync(path.join(out,'launch-url.txt'),url);report.normalRestart=true;report.origin=origin;report.backups=fs.readdirSync(path.join(dataDir,'update-backups')).filter(n=>n.startsWith('before-program-'));
 fs.writeFileSync(path.join(out,'migration.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
 spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});
 child.unref();
}catch(e){await stopOwned();if(originalCache)fs.writeFileSync(cachePath,originalCache);fs.writeFileSync(path.join(out,'migration.json'),JSON.stringify({...report,error:e.message},null,2));throw e;}
