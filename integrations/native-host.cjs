'use strict';
// Linux native-messaging bridge, run by Electron in Node mode. Same protocol as NativeHost.cs:
// verify the caller, queue the request in capture-inbox, start DubBitig and wait for its receipt.
// No network listener, shell evaluation or browser profile edits.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const home = __dirname;
const reply = value => {
  const data = Buffer.from(JSON.stringify(value), 'utf8'); const header = Buffer.alloc(4); header.writeUInt32LE(data.length, 0);
  // One request per run: exit once the reply is flushed instead of waiting on the browser's open stdin.
  process.stdout.write(Buffer.concat([header, data]), () => process.exit(value.ok === false ? 1 : 0));
};
const readJson = file => JSON.parse(fs.readFileSync(path.join(home, file), 'utf8'));
function allowed(args) {
  // Chrome passes the caller origin first; Firefox passes its manifest path and then the add-on ID.
  if (readJson('com.dubbitig.capture.json').allowed_origins.includes(args[0])) return true;
  try { return args.length > 1 && readJson('com.dubbitig.capture.firefox.json').allowed_extensions.includes(args[1]); } catch { return false; }
}
function readMessage() {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    process.stdin.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const length = buffer.readUInt32LE(0);
      if (length < 2 || length > 1048576) { reject(new Error('Mesaj en fazla 1 MB olabilir.')); return; }
      if (buffer.length >= 4 + length) resolve(buffer.subarray(4, 4 + length).toString('utf8'));
    });
    process.stdin.on('end', () => reject(new Error('Eksik mesaj.')));
  });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  try {
    if (!allowed(process.argv.slice(2))) throw new Error('Bu eklentinin erişim izni yok.');
    const raw = await readMessage(); const request = JSON.parse(raw);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(request.id))) throw new Error('Geçersiz istek kimliği.');
    if (request.type !== 'save') throw new Error('Geçersiz işlem.');
    const data = process.env.DUBBITIG_DATA_DIR ?? path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'DubBitig');
    const folder = path.join(data, 'capture-inbox'); fs.mkdirSync(folder, { recursive: true });
    const id = String(request.id).toLowerCase(); const file = path.join(folder, id + '.json'); const receipt = path.join(folder, id + '.result');
    const exe = process.env.DUBBITIG_CAPTURE_EXE;
    if (!exe || !fs.existsSync(exe)) throw new Error('DubBitig bulunamadı. Uygulamayı bir kez açarak bağlantıyı yenile.');
    if (!fs.existsSync(receipt) && !fs.existsSync(file)) {
      const temp = `${file}.${process.pid}.tmp`;
      try { fs.writeFileSync(temp, raw, 'utf8'); if (!fs.existsSync(file)) fs.renameSync(temp, file); } finally { fs.rmSync(temp, { force: true }); }
    }
    // The desktop app must not inherit the browser's stdio pipes or Node mode.
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.DUBBITIG_CAPTURE_EXE;
    const child = spawn(exe, ['--capture-inbox'], { detached: true, stdio: 'ignore', env }); child.unref();
    for (let i = 0; i < 450; i++) {
      if (fs.existsSync(receipt)) { const response = JSON.parse(fs.readFileSync(receipt, 'utf8')); response.startedProcessId = child.pid; reply(response); fs.rmSync(receipt, { force: true }); return; }
      await sleep(100);
    }
    reply({ ok: true, queued: true, id, title: 'Kayıt sıraya alındı. DubBitig açıldığında tamamlanacak.' });
  } catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
})();
