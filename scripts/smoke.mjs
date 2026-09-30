// End-to-end smoke test of the built desktop app (run `npm run build` first).
// Drives Electron with Playwright against a temp copy of the example project and saves
// screenshots to scripts/.smoke/. Exits non-zero on the first failed check.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, '..');
const shots = join(here, '.smoke');
await mkdir(shots, { recursive: true });

const repo = await mkdtemp(join(tmpdir(), 'contextmd-smoke-'));
await cp(join(rootDir, 'examples/example-agent-project'), repo, { recursive: true });
const userData = await mkdtemp(join(tmpdir(), 'contextmd-profile-'));

const theme = process.env.SMOKE_THEME ?? 'dark';
const app = await electron.launch({
  args: [join(rootDir, 'apps/desktop/out/main/index.js'), repo],
  env: { ...process.env, CONTEXTMD_USER_DATA: userData },
  colorScheme: theme,
});
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.setViewportSize({ width: 1440, height: 900 });

let step = 0;
const check = async (name, fn) => {
  step++;
  try {
    await fn();
    console.log(`✓ ${step}. ${name}`);
  } catch (e) {
    console.error(`✗ ${step}. ${name}\n  ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: join(shots, `failed-${step}.png`) });
    await app.close();
    process.exit(1);
  }
};
const shot = (name) => page.screenshot({ path: join(shots, `${theme}-${name}.png`) });
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await check('repository opens and Markdown files are listed', async () => {
  await page
    .getByRole('treeitem', { name: /AGENTS\.md/ })
    .first()
    .waitFor({ timeout: 15000 });
  // Folders without instruction files start collapsed; the root row shows the indexed count.
  const count = await page.locator('.tree-row.root .row-meta').textContent();
  if (count !== '13') throw new Error(`expected 13 indexed files, got ${count}`);
  const ignored = await page.locator('.tree-row', { hasText: /node_modules|scratch/ }).count();
  if (ignored !== 0) throw new Error('ignored directories are visible');
});

await check('AGENTS.md opens with outline and token metadata', async () => {
  await page.locator('.tree-row.file[title^="/AGENTS.md"]').click();
  await page.locator('.cm-content').waitFor();
  await page.getByRole('button', { name: /Document/ }).click();
  await page.locator('.outline li', { hasText: 'Workflow' }).waitFor();
  await page.locator('.meta', { hasText: 'Tokens' }).waitFor();
});
await shot('01-document');

await check('backlinks are listed for backend/architecture.md', async () => {
  await page.locator('.tree-row.file', { hasText: 'architecture.md' }).click();
  await page
    .locator('.section', { hasText: 'Backlinks' })
    .locator('.link-list li')
    .nth(2)
    .waitFor();
});

await check('selecting a directory resolves its generic effective context', async () => {
  await page
    .getByRole('button', { name: /Context/ })
    .first()
    .click();
  const backend = page.locator('.tree-row.dir', { hasText: 'backend' }).first();
  await backend.hover();
  await backend.locator('.row-action').click();
  await page.locator('.segment-path', { hasText: '/backend/AGENTS.md' }).first().waitFor();
  // The context refreshes asynchronously after retargeting; poll until it settles.
  const expected = '/AGENTS.md,/CLAUDE.md,/backend/AGENTS.md';
  let paths = '';
  for (const deadline = Date.now() + 5000; Date.now() < deadline; await wait(100)) {
    paths = (
      await page
        .locator('.section', { hasText: 'Loaded at launch' })
        .locator('.segment-path')
        .allTextContents()
    ).join(',');
    if (paths === expected) break;
  }
  if (paths !== expected) throw new Error(`unexpected order: ${paths}`);
  await page.locator('.diagnostic', { hasText: 'Potential conflict' }).waitFor();
});
await shot('02-generic-context');

await check('Claude Code adapter shows backend/AGENTS.md as not loaded', async () => {
  await page.locator('.ctx-controls select').first().selectOption('claude-code');
  await page.locator('.fidelity-documented').waitFor();
  await page.locator('.status-skipped .segment-path', { hasText: '/backend/AGENTS.md' }).waitFor();
});
await shot('03-claude-context');

await check('full effective context view traces a line back to its source', async () => {
  await page.getByRole('button', { name: /Full view/ }).click();
  const line = page.locator('.ctx-line.clickable', { hasText: 'Type-annotate' });
  // Claude Code skips backend/AGENTS.md; switch back to generic for the provenance check.
  await page.locator('.ctx-controls select').first().selectOption('generic');
  await line.waitFor();
  await line.click();
  await page.locator('.tab.active', { hasText: 'AGENTS.md' }).waitFor();
  const cursor = await page.locator('.statusbar').textContent();
  if (!/Ln 13,/.test(cursor ?? '')) throw new Error(`cursor not on source line: ${cursor}`);
});
await shot('04-provenance');

await check('copy effective context puts source boundaries on the clipboard', async () => {
  await page
    .getByRole('button', { name: /^Copy$/ })
    .first()
    .click();
  await wait(200);
  const text = await app.evaluate(({ clipboard }) => clipboard.readText());
  if (!text.includes('<!-- SOURCE: /AGENTS.md -->'))
    throw new Error('clipboard lacks source markers');
});

await check('repository-wide search finds sections and lines', async () => {
  await page.keyboard.press(`${mod}+Shift+F`);
  await page.getByPlaceholder('Search Markdown…').fill('migration');
  await page.locator('.result-line').first().waitFor();
  const n = await page.locator('.result-line').count();
  if (n < 3) throw new Error(`expected ≥3 results, got ${n}`);
  await page.locator('.result-line', { hasText: 'Create a migration' }).click();
  await page.locator('.tab.active', { hasText: 'AGENTS.md' }).waitFor();
});
await shot('05-search');

await check('command palette opens files', async () => {
  await page.keyboard.press(`${mod}+P`);
  await page.getByPlaceholder('Go to file…').fill('database');
  await page.keyboard.press('Enter');
  await page.locator('.tab.active', { hasText: 'database.md' }).waitFor();
});

await check('edit + save writes to disk', async () => {
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.type('\n- Added by smoke test.\n');
  await page.locator('.save-state', { hasText: 'Modified' }).waitFor();
  await page.keyboard.press(`${mod}+S`);
  await page.locator('.save-state', { hasText: 'Saved' }).waitFor();
  const disk = await readFile(join(repo, 'backend/prompts/database.md'), 'utf8');
  if (!disk.includes('Added by smoke test.')) throw new Error('content not on disk');
});

await check('external change to a clean buffer reloads the editor', async () => {
  const p = join(repo, 'backend/prompts/database.md');
  await writeFile(p, (await readFile(p, 'utf8')) + '\n- Written by another program.\n');
  await page
    .locator('.cm-content', { hasText: 'Written by another program.' })
    .waitFor({ timeout: 5000 });
});

await check('external change to a dirty buffer shows a banner and never overwrites', async () => {
  const p = join(repo, 'backend/prompts/database.md');
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.type('- Unsaved local edit.');
  await writeFile(p, (await readFile(p, 'utf8')) + '\n- Conflicting external edit.\n');
  await page.locator('.banner', { hasText: 'changed on disk' }).waitFor({ timeout: 5000 });
  await page.keyboard.press(`${mod}+S`);
  await page.locator('.dialog', { hasText: 'The file changed on disk' }).waitFor();
  const disk = await readFile(p, 'utf8');
  if (disk.includes('Unsaved local edit.'))
    throw new Error('local edit was written despite conflict');
});
await shot('06-conflict');

await check('conflict resolution: overwrite writes my version', async () => {
  await page.getByRole('button', { name: /Overwrite disk/ }).click();
  await page.locator('.save-state', { hasText: 'Saved' }).waitFor();
  const disk = await readFile(join(repo, 'backend/prompts/database.md'), 'utf8');
  if (!disk.includes('Unsaved local edit.')) throw new Error('overwrite did not write');
});

await check('externally added and removed files update the tree', async () => {
  await writeFile(join(repo, 'frontend/NEW.md'), '# New file\n');
  await page.getByRole('button', { name: /Files/ }).click();
  await page.locator('.tree-row.file', { hasText: 'NEW.md' }).waitFor({ timeout: 5000 });
  await rm(join(repo, 'frontend/NEW.md'));
  await page
    .locator('.tree-row.file', { hasText: 'NEW.md' })
    .waitFor({ state: 'detached', timeout: 5000 });
});

await check('deleting an open file keeps the buffer and warns', async () => {
  await page.locator('.tree-row.file', { hasText: 'styling.md' }).click();
  await page.locator('.cm-content', { hasText: 'Styling guide' }).waitFor();
  await rm(join(repo, 'frontend/styling.md'));
  await page.locator('.banner', { hasText: 'deleted on disk' }).waitFor({ timeout: 5000 });
});

await check('split view renders a sanitized preview', async () => {
  await page.locator('.tree-row.file[title^="/AGENTS.md"]').click();
  await page.getByRole('button', { name: 'Split' }).click();
  await page.locator('.markdown-body h1', { hasText: 'Acme Shop' }).waitFor();
});
await shot('07-split');

await page.keyboard.press(`${mod}+K`);
await page.getByPlaceholder('Type a command…').fill('');
await shot('08-palette');
await page.keyboard.press('Escape');

await check('terminal agents are listed as built-in harnesses', async () => {
  await page
    .getByRole('button', { name: /Context/ })
    .first()
    .click();
  const names = await page
    .locator('.ctx-controls select')
    .first()
    .locator('option')
    .allTextContents();
  for (const n of ['Gemini CLI', 'Amp', 'GitHub Copilot CLI', 'OpenCode', 'Cursor CLI', 'Aider']) {
    if (!names.some((x) => x.startsWith(n))) throw new Error(`missing harness ${n}: ${names}`);
  }
});

await check('a repository spec appears live and cannot start commands', async () => {
  await mkdir(join(repo, '.contextmd/harnesses'), { recursive: true });
  await writeFile(join(repo, 'MYAGENT.md'), '# My agent rules\n');
  await writeFile(
    join(repo, '.contextmd/harnesses/my-agent.yaml'),
    'id: my-agent\nname: My Agent\nfiles: [MYAGENT.md]\ncommand: echo should-not-be-offered\n',
  );
  const select = page.locator('.ctx-controls select').first();
  await select
    .locator('option', { hasText: 'My Agent' })
    .waitFor({ state: 'attached', timeout: 8000 });
  await select.selectOption('my-agent');
  await page.locator('.fidelity-declared').waitFor();
  await page.locator('.segment-path', { hasText: '/MYAGENT.md' }).waitFor();
  if (await page.getByRole('button', { name: 'Start My Agent' }).count()) {
    throw new Error('repository spec offered a command');
  }
});
await shot('09-repo-spec');

await check('embedded terminal runs a shell in the launch directory', async () => {
  await page.getByRole('button', { name: /Open here/ }).click();
  await page.locator('.terminal-panel .xterm').waitFor();
  await page.locator('.terminal-panel .xterm-helper-textarea').focus();
  await page.keyboard.type('echo contextmd-$((6*7))');
  await page.keyboard.press('Enter');
  await page
    .locator('.terminal-panel .xterm-rows', { hasText: 'contextmd-42' })
    .waitFor({ timeout: 10000 });
});

await check('"Start Claude Code" types the command without running it', async () => {
  await page.locator('.ctx-controls select').first().selectOption('claude-code');
  await page.getByRole('button', { name: 'Start Claude Code' }).click();
  await page.locator('.terminal-tab.active', { hasText: 'claude' }).waitFor();
  await page.locator('.terminal-hint', { hasText: 'Press Enter' }).waitFor();
  await page
    .locator('.terminal-panel .xterm-rows', { hasText: 'claude' })
    .waitFor({ timeout: 10000 });
});
await shot('10-terminal');

await check('no renderer errors', async () => {
  const real = errors.filter((e) => !/Autofill|DevTools/.test(e));
  if (real.length) throw new Error(real.join(' | '));
});

await app.close();
await rm(repo, { recursive: true, force: true });
await rm(userData, { recursive: true, force: true });
console.log(`\nAll ${step} checks passed. Screenshots in scripts/.smoke/`);
