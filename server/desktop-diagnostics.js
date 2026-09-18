// Bounded, redacted lifecycle breadcrumbs. No data, stack, paths, URLs, or tokens.
import fs from 'node:fs';
import path from 'node:path';
import { atomicJson } from './update-files.js';
export function recordDesktopEvent(dataDir,event,detail={}) {
  if(!['starting','ready','disconnect','signal','uncaught','exit'].includes(event)) return;
  const file=path.join(dataDir,'desktop-diagnostics.json');
  try {
    let events=[];
    if(fs.existsSync(file)&&fs.lstatSync(file).isFile()&&fs.statSync(file).size<65536){try{events=JSON.parse(fs.readFileSync(file,'utf8')).events;if(!Array.isArray(events))events=[];}catch{events=[];}}
    // Do not copy arbitrary fields from a pre-existing local file into diagnostics.
    const clean=e=>({at:Number.isFinite(e.at)?e.at:0,event:['starting','ready','disconnect','signal','uncaught','exit'].includes(e.event)?e.event:'exit',...(typeof e.code==='number'||/^[A-Z][A-Z0-9_]{0,50}$/.test(e.code||'')?{code:e.code}:{})});
    atomicJson(file,{format:1,events:[...events.slice(-19).map(clean),clean({at:Date.now(),event,code:detail.code})]});
  }catch{/* Diagnostics must not interrupt startup, shutdown or crash handling. */}
}
