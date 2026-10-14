// Construction rapide (Lab seul) pour itérer pendant le développement.
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
execSync('npx vite build --logLevel warn', { stdio: 'inherit', env: { ...process.env, VANTAGE_BUILD: 'lab', VANTAGE_OUT: 'dist/.lab' } });
mkdirSync('dist', { recursive: true });
copyFileSync('dist/.lab/index.html', 'dist/vantage-lab.html');
console.log('dist/vantage-lab.html');
