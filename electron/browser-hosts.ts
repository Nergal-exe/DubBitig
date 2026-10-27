import { join } from 'node:path';

// Firefox-based browsers (Firefox, Zen, LibreWolf, Floorp, Waterfox) share Gecko's user native-manifest directory:
// ~/.mozilla/native-messaging-hosts for legacy profiles, $XDG_CONFIG_HOME/mozilla/native-messaging-hosts for XDG
// installs (Firefox 147+, Zen). Some forks also read their own root, so a copy goes there as well.
const geckoRoots = [
  ['.mozilla', 'mozilla'], ['.zen', 'zen'], ['.librewolf', 'librewolf'], ['.floorp', 'floorp'], ['.waterfox', 'waterfox'],
] as const;

export function geckoManifestDirs(home: string, config: string, exists: (path: string) => boolean): string[] {
  const roots = geckoRoots.flatMap(([legacy, xdg]) => [join(home, legacy), join(config, xdg)]).filter(exists);
  if (!roots.length) return [];
  // The shared XDG directory is needed even when only a fork (e.g. Zen without Firefox) is installed.
  return [...new Set([...roots, join(config, 'mozilla')])].map(root => join(root, 'native-messaging-hosts'));
}
