// Some npm configurations skip dependency install scripts, which leaves Electron without
// its binary. This downloads it if missing. Safe to run repeatedly.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let pkgDir;
try {
  pkgDir = dirname(require.resolve('electron/package.json'));
} catch {
  process.exit(0); // electron not installed (e.g. core-only install)
}
if (!existsSync(join(pkgDir, 'path.txt'))) {
  console.log('[contextmd] Downloading Electron binary…');
  const r = spawnSync(process.execPath, [join(pkgDir, 'install.js')], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
