import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TerminalManager, type TerminalEvent } from '../src/main/terminals';

// Use a plain shell so tests don't depend on the developer's shell profile and plugins.
const originalShell = process.env['SHELL'];
beforeAll(() => {
  process.env['SHELL'] = '/bin/sh';
});
afterAll(() => {
  process.env['SHELL'] = originalShell;
});
// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][0-9A-Z]|\r/g, '');

const dirs: string[] = [];
let manager: TerminalManager | null = null;
afterEach(async () => {
  manager?.killAll();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function until(fn: () => boolean, ms = 8000, debug?: () => string): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end)
      throw new Error(`timed out${debug ? `: ${JSON.stringify(debug())}` : ''}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe.skipIf(process.platform === 'win32')('TerminalManager', { timeout: 20000 }, () => {
  it('runs an interactive shell in the requested directory', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'contextmd-term-')));
    dirs.push(dir);
    let out = '';
    manager = new TerminalManager((e: TerminalEvent) => {
      if (e.type === 'terminal-data') out += plain(e.data);
    });
    const t = manager.create(dir, 'sub', { cols: 80, rows: 24 });
    expect(t.cwd).toBe('sub');
    manager.write(t.id, 'pwd; echo marker-$((6*7))\r');
    await until(() => out.includes('marker-42'));
    expect(out).toContain(dir);
  });

  it('types a prefilled command without running it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'contextmd-term-'));
    dirs.push(dir);
    let out = '';
    manager = new TerminalManager((e) => {
      if (e.type === 'terminal-data') out += plain(e.data);
    });
    const t = manager.create(dir, '', { cols: 250, rows: 24, prefill: 'echo prefilled-$((2+3))' });
    expect(t.title).toBe('echo');
    await until(
      () => out.includes('echo prefilled-$((2+3))'),
      8000,
      () => out,
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(out).not.toContain('prefilled-5'); // echoed as typed text, never executed
    manager.write(t.id, '\r');
    await until(() => out.includes('prefilled-5'));
  });

  it('reports exit and forgets killed terminals', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'contextmd-term-'));
    dirs.push(dir);
    const exits: number[] = [];
    manager = new TerminalManager((e) => {
      if (e.type === 'terminal-exit') exits.push(e.id);
    });
    const t = manager.create(dir, '', { cols: 80, rows: 24 });
    manager.write(t.id, 'exit\r');
    await until(() => exits.includes(t.id));
    expect(manager.count).toBe(0);
  });
});
