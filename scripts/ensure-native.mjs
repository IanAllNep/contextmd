// Some npm configurations skip dependency install scripts. That leaves Electron without its
// binary and node-pty's macOS spawn-helper without its execute bit. This repairs both and is
// safe to run repeatedly.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = (name) => {
  try {
    return dirname(
      require.resolve(`${name}/package.json`, {
        paths: [process.cwd(), join(process.cwd(), 'apps/desktop')],
      }),
    );
  } catch {
    return null;
  }
};

const electron = pkgDir('electron');
if (electron && !existsSync(join(electron, 'path.txt'))) {
  console.log('[contextmd] Downloading Electron binary…');
  const r = spawnSync(process.execPath, [join(electron, 'install.js')], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const pty = pkgDir('node-pty');
if (pty && process.platform !== 'win32') {
  for (const base of [join(pty, 'prebuilds'), join(pty, 'build', 'Release')]) {
    if (!existsSync(base)) continue;
    const dirs = base.endsWith('prebuilds') ? readdirSync(base).map((d) => join(base, d)) : [base];
    for (const d of dirs) {
      const helper = join(d, 'spawn-helper');
      if (existsSync(helper) && (statSync(helper).mode & 0o111) === 0) {
        chmodSync(helper, 0o755);
        console.log(`[contextmd] Made ${helper} executable`);
      }
    }
  }
}
