import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeZip} from '../server/packs.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=path.resolve(process.argv[2]||path.join(root,'releases','zju842-source-review.zip'));
const allowedDirs=['src','server','scripts','tests','docs','public','.github'];
const allowedFiles=['package.json','package-lock.json','index.html','vite.config.js','README.md','LICENSE','CONTENT-NOTICE.md','.gitignore','.gitattributes','.dockerignore','.env.example','Dockerfile','compose.yaml','render.yaml'];
const entries=[];
function add(relative){
  const file=path.join(root,relative),stat=fs.lstatSync(file);
  if(stat.isSymbolicLink())throw new Error('源码目录含符号链接：'+relative);
  if(stat.isDirectory()){for(const name of fs.readdirSync(file))add(relative+'/'+name);return;}
  if(/(^|\/)(node_modules|\.git|userdata|data|\.test-artifacts)(\/|$)|\.sqlite(?:-|$)|\.log$|\.pdf$/.test(relative)||relative.startsWith('releases/')||relative.split('/').some(p=>p.startsWith('.env')&&p!=='.env.example'))throw new Error('不应打包的文件：'+relative);
  if(/\.(?:js|json|md|toml|yaml|yml|html|css)$/.test(relative)){
    const source=fs.readFileSync(file,'utf8');
    if(/(?:ghp_|github_pat_)[A-Za-z0-9_]{24,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/.test(source))throw new Error('检测到疑似真实密钥：'+relative);
  }
  entries.push({name:'zju842-source/'+relative,file});
}
for(const directory of allowedDirs)add(directory);
for(const file of allowedFiles)if(fs.existsSync(path.join(root,file)))add(file);
fs.mkdirSync(path.dirname(target),{recursive:true});
await writeZip(target,entries);
console.log(JSON.stringify({archive:target,files:entries.length,MiB:Number((fs.statSync(target).size/1048576).toFixed(2)),personalDataIncluded:false}));
