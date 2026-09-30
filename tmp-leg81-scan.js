const fs=require('fs');
function code(src){return src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/.*$/gm,'$1');}
function exps(p){const s=fs.readFileSync(p,'utf8');const out=new Set();
 for(const m of s.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g))out.add(m[1]);
 for(const m of s.matchAll(/export\s*\{([^}]*)\}/g))for(const t of m[1].split(',')){const n=t.trim().split(/\s+as\s+/).pop().trim();if(n)out.add(n);}
 for(const m of s.matchAll(/export\s+(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/g))out.add(m[1]);
 return [...out];}
const idx=code(fs.readFileSync('web/index.js','utf8'));
for(const f of ['memory-store','book-source','hot-ledger','snapshot-store','view-state','param-panel']){
 const names=exps('web/'+f+'.js');
 const leaked=names.filter(n=>new RegExp('(?:function\\s+'+n+'\\b|(?:const|let|var)\\s+'+n+'\\s*=)').test(idx));
 console.log('['+f+'] exports='+names.length+' leaked='+leaked.length+(leaked.length?' :: '+leaked.join(', '):''));
}
console.log('--- imports from new homes in index.js ---');
for(const m of idx.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.\/[a-z-]+\.js)'/g))console.log(m[2]+' <= '+m[1].trim().replace(/\s+/g,' '));
