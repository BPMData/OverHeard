import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root=path.dirname(new URL(import.meta.url).pathname);
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.bin':'application/octet-stream','.onnx':'application/octet-stream'};
http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
  const f=path.join(root,p); if(!f.startsWith(root)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream','content-length':fs.statSync(f).size,
    'cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp','cache-control':'no-store'});
  fs.createReadStream(f).pipe(res);
}).listen(8765,()=>console.log('http://localhost:8765'));
