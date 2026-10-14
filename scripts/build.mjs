// Construit les trois saveurs, ajoute les mentions de licence et vérifie la séparation public / présentation / lab.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const LICENSE = `<!--
  Vantage — démonstrateur. Stades, clubs, prix et disponibilités fictifs.
  Composants tiers embarqués dans ce fichier :
  • three.js — MIT License — Copyright © 2010-2024 three.js authors.
    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
    documentation files (the "Software"), to deal in the Software without restriction, including without limitation
    the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
    permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright
    notice and this permission notice shall be included in all copies or substantial portions of the Software.
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
  • Inter — SIL Open Font License 1.1 — Copyright © 2016 The Inter Project Authors (https://github.com/rsms/inter).
    Texte complet : https://openfontlicense.org — la police est embarquée sans modification, non vendue séparément.
-->
`;

/** Content-Security-Policy of the built files: inline code and data: / blob: resources only, no network. */
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src data: blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

const flavors = [['public', 'vantage.html'], ['presentation', 'vantage-presentation.html'], ['lab', 'vantage-lab.html']];
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
const sizes = [];
for (const [flavor, name] of flavors) {
  execSync('npx vite build --logLevel warn', { stdio: 'inherit', env: { ...process.env, VANTAGE_BUILD: flavor, VANTAGE_OUT: `dist/.${flavor}` } });
  let html = readFileSync(`dist/.${flavor}/index.html`, 'utf8');
  html = html.replace('<!doctype html>', `<!doctype html>\n${LICENSE}`);
  // Each build is one self-contained file: nothing may be fetched from the network.
  html = html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n  <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n  <meta name="referrer" content="no-referrer" />`);
  if (!html.includes('Content-Security-Policy')) throw new Error(`CSP non injectée dans ${name}`);
  writeFileSync(`dist/${name}`, html);
  rmSync(`dist/.${flavor}`, { recursive: true, force: true });
  sizes.push([name, statSync(`dist/${name}`).size, gzipSync(html).length]);
}

// Contrôle de séparation : aucune commande de Lab ni de présentateur dans la version publique,
// aucune commande de Lab dans la version de présentation.
const forbidden = {
  'vantage.html': ['Experience Lab', '__lab', 'memoryTest', 'runShowcase', 'recordSequence', 'id="presenter"', 'id="lab"'],
  'vantage-presentation.html': ['Experience Lab', '__lab', 'memoryTest', 'id="lab"'],
};
let ok = true;
for (const [file, words] of Object.entries(forbidden)) {
  const html = readFileSync(`dist/${file}`, 'utf8');
  for (const w of words) if (html.includes(w)) { console.error(`✗ ${file} contient « ${w} »`); ok = false; }
}
for (const [n, s, g] of sizes) console.log(`${n.padEnd(28)} ${(s / 1024).toFixed(0).padStart(5)} Ko  (${(g / 1024).toFixed(0)} Ko gzip)`);
if (!ok) process.exit(1);
console.log('✓ séparation public / présentation / lab vérifiée');
