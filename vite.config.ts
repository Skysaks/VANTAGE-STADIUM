import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execSync } from 'node:child_process';
import pkg from './package.json';

// Trois constructions, un seul fichier HTML autonome chacune (aucun CDN, fonctionne hors ligne) :
//   VANTAGE_BUILD=public | presentation | lab   (voir scripts/build.mjs)
const flavor = (process.env.VANTAGE_BUILD ?? 'lab') as 'public' | 'presentation' | 'lab';
let commit = 'local';
try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* pas de dépôt */ }

/** Retire du HTML les éléments réservés à une autre construction (data-only="presentation lab"). */
const stripForeign = {
  name: 'vantage-strip-foreign',
  transformIndexHtml(html: string) {
    return html.replace(/^\s*<(\w+)[^>]*data-only="([^"]*)"[^>]*>.*?<\/\1>\s*$/gm, (m, _t, only: string) => (only.split(' ').includes(flavor) ? m.replace(/ data-only="[^"]*"/, '') : ''));
  },
};

export default defineConfig({
  base: './',
  plugins: [stripForeign, viteSingleFile()],
  define: {
    __BUILD__: JSON.stringify(flavor),
    __VERSION__: JSON.stringify(pkg.version),
    __COMMIT__: JSON.stringify(commit),
    __DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  build: { target: 'es2020', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 2000, outDir: process.env.VANTAGE_OUT ?? 'dist/.tmp', emptyOutDir: true, reportCompressedSize: false },
  esbuild: { drop: flavor === 'lab' ? [] : ['debugger'], pure: flavor === 'lab' ? [] : ['console.log', 'console.debug', 'console.info'] },
  // Local machine only by default; to test on a phone on the same network: `npm run dev -- --host`.
  server: { port: 5173 },
});
