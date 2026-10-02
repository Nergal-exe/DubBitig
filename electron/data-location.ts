import { existsSync, mkdirSync, readdirSync, renameSync, cpSync, rmSync, readFileSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';

// A staged move also handles Chrome creating the new capture inbox before first launch.
// On interruption, the original directory remains inside the destination for recovery.
export function migrateDataLocation(appData: string): string {
  const target = join(appData, 'DubBitig');
  const legacy = join(appData, 'sakli');
  const stage = join(target, 'migration-source');
  if (!existsSync(stage)) {
    if (existsSync(join(target, 'sakli.sqlite')) || !existsSync(join(legacy, 'sakli.sqlite'))) return target;
    if (!existsSync(target)) { renameSync(legacy, target); return target; }
    mkdirSync(target, { recursive: true });
    renameSync(legacy, stage);
  }
  const merge = (source: string, destination: string) => {
    if (lstatSync(source).isSymbolicLink()) throw new Error('Veri taşınırken beklenmeyen bağlantı bulundu: ' + source);
    if (lstatSync(source).isDirectory()) {
      mkdirSync(destination, { recursive: true });
      for (const name of readdirSync(source)) merge(join(source, name), join(destination, name));
    } else if (existsSync(destination)) {
      if (!readFileSync(source).equals(readFileSync(destination))) throw new Error('İki veri klasöründe farklı dosyalar var. Güvenli taşıma durduruldu: ' + destination);
    } else cpSync(source, destination, { errorOnExist: true, force: false });
  };
  // Database last: all assets must exist before the new archive can be opened.
  for (const name of ['photos', 'backups', 'capture-inbox', 'sakli.sqlite']) {
    if (existsSync(join(stage, name))) merge(join(stage, name), join(target, name));
  }
  if (resolve(stage) !== resolve(target, 'migration-source')) throw new Error('Geçersiz taşıma klasörü.');
  rmSync(stage, { recursive: true });
  return target;
}
