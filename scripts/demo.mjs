// Copie les versions publique et présentation dans docs/demo/ pour GitHub Pages (servi depuis /docs).
// Le Lab n'est jamais publié. Lancer via `npm run demo` (construit d'abord, avec la CSP et le contrôle de séparation).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

mkdirSync('docs/demo', { recursive: true });
if (!existsSync('docs/.nojekyll')) writeFileSync('docs/.nojekyll', '');
const pairs = [['dist/vantage.html', 'docs/demo/index.html'], ['dist/vantage-presentation.html', 'docs/demo/presentation.html']];
for (const [from, to] of pairs) {
  const html = readFileSync(from, 'utf8');
  if (!html.includes('http-equiv="Content-Security-Policy"')) throw new Error(`${from} sans CSP : reconstruire avec npm run build`);
  if (/Experience Lab|id="lab"/.test(html)) throw new Error(`${from} contient le Lab`);
  copyFileSync(from, to);
  console.log(`${to} ← ${from}`);
}
