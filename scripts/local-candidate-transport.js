// One-process transport for an explicitly requested offline local migration.
// The desktop installer, backup, validation and activation paths remain unchanged.
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {registerHooks} from 'node:module';
const directory=process.env.ZJU842_LOCAL_CANDIDATE;
if(!directory||!path.isAbsolute(directory))throw Error('An explicit candidate directory is required');
const shim='data:text/javascript,'+encodeURIComponent("export function readNetworkConfig(){return {}};export async function resolveNetwork(){return {proxyEnv:{},summary:{source:'local-candidate'}}};export const requestHTTPS=(url,options)=>globalThis.fetch(url,options);");
registerHooks({resolve(specifier,context,next){if(specifier==='./update-network.js'&&context.parentURL?.endsWith('/server/update-source.js'))return {url:shim,shortCircuit:true};return next(specifier,context);}});
globalThis.fetch=async value=>{
 const url=new URL(value);
 if(url.hostname==='api.github.com'&&url.pathname.endsWith('/releases/latest'))return new Response(JSON.stringify({tag_name:'local-candidate',assets:[{name:'zju842-updates.json'}]}));
 if(url.hostname!=='github.com')throw Error('Offline migration does not access external services');
 const name=decodeURIComponent(url.pathname.split('/').pop());
 if(name==='zju842-updates.json')return new Response(fs.readFileSync(path.join(directory,name)));
 if(!/^zju842-0\.5\.8-windows-x64\.zip$/.test(name))throw Error('Unexpected local candidate asset');
 return new Response(Readable.toWeb(fs.createReadStream(path.join(directory,name))));
};
