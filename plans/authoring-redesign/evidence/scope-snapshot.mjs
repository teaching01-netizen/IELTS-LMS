import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
const mode = process.argv[2] ?? 'baseline';
const files = [...new Set(execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {maxBuffer:64*1024*1024}).toString().split('\0').filter(Boolean))].filter(p => /^(src\/|backend\/|api\/|e2e\/|package|tsconfig|vite|eslint|playwright)/.test(p));
const manifest = {};
for (const p of files.sort()) {
 if (!existsSync(p)) continue;
 try { manifest[p] = createHash('sha256').update(readFileSync(p)).digest('hex'); } catch { continue; }
 if (mode === 'baseline' && (/^src\/features\/exam-authoring\//.test(p) || ['src/index.css','src/shared/motion.ts'].includes(p) || p.startsWith('e2e/'))) { const target = '/tmp/authoring-redesign-61a6dbeb-originals/' + p; mkdirSync(dirname(target), {recursive:true}); copyFileSync(p,target); }
}
const file = 'plans/authoring-redesign/evidence/' + mode + '-manifest.json';
writeFileSync(file, JSON.stringify(manifest,null,2)+'\n');
console.log(Object.keys(manifest).length + ' files hashed: ' + file);
if(mode !== 'baseline') {
 const base = JSON.parse(readFileSync('plans/authoring-redesign/evidence/baseline-manifest.json','utf8'));
 const changed = [...new Set([...Object.keys(base),...Object.keys(manifest)])].filter(p=>base[p]!==manifest[p]);
 writeFileSync('plans/authoring-redesign/evidence/changed-files.json', JSON.stringify(changed,null,2)+'\n');
 console.log(changed.length + ' changed files');
 console.log(changed.join('\n'));
}
