import { join } from 'node:path';

// Gecko reads per-user native manifests from ~/.mozilla/native-messaging-hosts (XREUserNativeManifests), even when the
// profile itself lives in an XDG folder: verified with Firefox 158 (~/.config/mozilla/firefox) and Zen 1.23
// (~/.config/zen). Forks that rename the user directory (e.g. LibreWolf's ~/.librewolf) get a copy in their own root.
const geckoRoots = [
  ['.mozilla', 'mozilla'], ['.zen', 'zen'], ['.librewolf', 'librewolf'], ['.floorp', 'floorp'], ['.waterfox', 'waterfox'],
] as const;

export function geckoManifestDirs(home: string, config: string, exists: (path: string) => boolean): string[] {
  const installed = geckoRoots.some(([legacy, xdg]) => exists(join(home, legacy)) || exists(join(config, xdg)));
  if (!installed) return [];
  const forks = geckoRoots.slice(1).map(([legacy]) => join(home, legacy)).filter(exists);
  // ~/.mozilla is created when missing: an XDG-only Firefox or Zen still looks there.
  return [join(home, '.mozilla'), ...forks].map(root => join(root, 'native-messaging-hosts'));
}
