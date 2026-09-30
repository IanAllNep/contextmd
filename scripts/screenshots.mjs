// Captures the README screenshots and demo GIF from the built app (run `npm run build` first).
// Output: docs/screenshots/*.png and docs/screenshots/demo.gif (GIF needs ffmpeg on PATH).
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, '..');
const out = join(rootDir, 'docs/screenshots');
const frames = await mkdtemp(join(tmpdir(), 'contextmd-frames-'));
await mkdir(out, { recursive: true });

// A stable, readable path for the top bar.
const repo = existsSync('/tmp') ? '/tmp/acme-shop' : join(tmpdir(), 'acme-shop');
await rm(repo, { recursive: true, force: true });
await cp(join(rootDir, 'examples/example-agent-project'), repo, { recursive: true });
const userData = await mkdtemp(join(tmpdir(), 'contextmd-profile-'));

const app = await electron.launch({
  args: [join(rootDir, 'apps/desktop/out/main/index.js'), repo],
  env: { ...process.env, CONTEXTMD_USER_DATA: userData },
  colorScheme: 'dark',
});
const page = await app.firstWindow();
await page.setViewportSize({ width: 1440, height: 900 });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let frame = 0;
const snap = async (name) => {
  await pause(250);
  if (name) await page.screenshot({ path: join(out, `${name}.png`) });
  await page.screenshot({ path: join(frames, `f${String(frame++).padStart(3, '0')}.png`) });
};
const hold = async (n) => {
  for (let i = 0; i < n; i++) await snap();
};

await page.locator('.tree-row.file[title^="/AGENTS.md"]').waitFor({ timeout: 15000 });
await hold(2);

// 1. Generic context for /backend: sources, tokens and the planted conflict.
await page.locator('.tree-row.dir', { hasText: 'prompts' }).click();
await page.locator('.tree-row.file[title^="/backend/prompts/database.md"]').click();
await page.locator('.segment-path', { hasText: '/backend/prompts/database.md' }).waitFor();
await hold(2);
await page.locator('.diagnostic', { hasText: 'Potential conflict' }).scrollIntoViewIfNeeded();
await snap('generic-context-conflict');
await hold(2);

// 2. Claude Code: the same repo, different answer. backend/AGENTS.md is never loaded.
await page.locator('.tree-row.file[title^="/CLAUDE.md"]').click();
await page.locator('.ctx-controls select').first().selectOption('claude-code');
await page.locator('.fidelity-documented').waitFor();
const backend = page.locator('.tree-row.dir', { hasText: 'backend' }).first();
await backend.hover();
await backend.locator('.row-action').click();
await page.locator('.status-skipped .segment-path', { hasText: '/backend/AGENTS.md' }).waitFor();
await page.locator('.inspector-body').evaluate((el) => (el.scrollTop = 0));
await snap('claude-code-context');
await hold(2);

// 3. Full view: every line traced back to its source.
await page.getByRole('button', { name: /Full view/ }).click();
await page.locator('.ctx-line.clickable').first().waitFor();
await snap('effective-context-provenance');
await hold(2);
const line = page
  .locator('.ctx-line.clickable', { hasText: 'Validate every request body' })
  .first();
if (await line.count()) await line.hover();
await hold(1);

// 4. Search.
await page.keyboard.press('Meta+Shift+F');
await page.getByPlaceholder('Search Markdown…').fill('migration');
await page.locator('.result-line').first().waitFor();
await page.locator('.result-line', { hasText: 'Create a migration' }).click();
await snap('search');
await hold(2);

// 5. Terminal: start Claude Code in the launch directory (typed, not run).
await page.keyboard.press('Escape');
await page.locator('.ctx-controls select').first().selectOption('claude-code');
await page.getByRole('button', { name: 'Start Claude Code' }).click();
await page.locator('.terminal-hint').waitFor();
await pause(800);
await snap('terminal-start-agent');
await hold(2);

// 6. Command palette.
await page.keyboard.press('Meta+K');
await snap('command-palette');
await hold(1);
await page.keyboard.press('Escape');

await app.close();
await rm(userData, { recursive: true, force: true });

const ff = spawnSync('ffmpeg', ['-version']);
if (ff.status === 0) {
  const gif = join(out, 'demo.gif');
  const filter =
    'fps=1.25,scale=1100:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4';
  const r = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      '1.25',
      '-i',
      join(frames, 'f%03d.png'),
      '-vf',
      filter,
      '-loop',
      '0',
      gif,
    ],
    { stdio: 'inherit' },
  );
  console.log(r.status === 0 ? `GIF: ${gif}` : 'GIF generation failed');
} else {
  console.log('ffmpeg not found; skipped demo.gif');
}
await rm(frames, { recursive: true, force: true });
await rm(repo, { recursive: true, force: true });
console.log(`Screenshots in ${out}`);
