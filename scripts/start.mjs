import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import electron from 'electron';
if (!existsSync(new URL('../dist/index.html', import.meta.url))) { console.error('Önce npm run build komutunu çalıştır.'); process.exit(1); }
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { cwd: new URL('..', import.meta.url), env, stdio: 'inherit', windowsHide: true });
child.on('error', e => { console.error(e); process.exit(1); });
child.on('exit', code => process.exit(code ?? 0));
