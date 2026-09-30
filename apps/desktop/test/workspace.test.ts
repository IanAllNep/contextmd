import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RepoEvent } from '../src/shared/api';
import { hashContent, Workspace } from '../src/main/workspace';

let root: string;
let outside: string;
let ws: Workspace;
let events: RepoEvent[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'contextmd-ws-'));
  outside = await mkdtemp(join(tmpdir(), 'contextmd-outside-'));
  await writeFile(join(root, 'AGENTS.md'), '# Root\n');
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'docs/a.md'), '# A\n');
  await writeFile(join(outside, 'secret.md'), 'secret');
  events = [];
  ws = await Workspace.open(root, (e) => events.push(e));
});

afterEach(async () => {
  await ws.close();
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('path validation', () => {
  it('rejects traversal, absolute and symlink escapes', async () => {
    await symlink(join(outside, 'secret.md'), join(root, 'link.md'));
    await symlink(outside, join(root, 'outdir'));
    await expect(ws.readFile('../x.md')).rejects.toThrow(/outside/);
    await expect(ws.readFile('docs/../../x.md')).rejects.toThrow(/outside/);
    await expect(ws.readFile('link.md')).rejects.toThrow(/outside/);
    await expect(ws.saveFile('outdir/new.md', 'x', null, false)).resolves.toMatchObject({
      ok: false,
      reason: 'error',
    });
    expect(await readFile(join(outside, 'secret.md'), 'utf8')).toBe('secret');
  });

  it('only saves Markdown files', async () => {
    const r = await ws.saveFile('script.sh', 'rm -rf /', null, false);
    expect(r).toMatchObject({ ok: false, reason: 'error' });
  });
});

describe('conflict-safe saving', () => {
  it('saves when the disk matches the base hash', async () => {
    const f = await ws.readFile('AGENTS.md');
    const r = await ws.saveFile('AGENTS.md', '# Root\nedited\n', f.hash, false);
    expect(r.ok).toBe(true);
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('# Root\nedited\n');
  });

  it('refuses to overwrite a newer file on disk unless forced', async () => {
    const f = await ws.readFile('AGENTS.md');
    await writeFile(join(root, 'AGENTS.md'), '# Changed elsewhere\n');
    const r = await ws.saveFile('AGENTS.md', '# Mine\n', f.hash, false);
    expect(r).toEqual({
      ok: false,
      reason: 'conflict',
      diskHash: hashContent('# Changed elsewhere\n'),
      diskContent: '# Changed elsewhere\n',
    });
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('# Changed elsewhere\n');
    expect((await ws.saveFile('AGENTS.md', '# Mine\n', f.hash, true)).ok).toBe(true);
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('# Mine\n');
  });

  it('treats a deleted file as a conflict and can recreate it', async () => {
    const f = await ws.readFile('docs/a.md');
    await rm(join(root, 'docs/a.md'));
    expect(await ws.saveFile('docs/a.md', '# A2', f.hash, false)).toMatchObject({
      reason: 'conflict',
      diskContent: null,
    });
    expect((await ws.saveFile('docs/a.md', '# A2', null, false)).ok).toBe(true);
  });
});

describe('watching', () => {
  it('updates the index and emits events for external changes', async () => {
    await new Promise((r) => setTimeout(r, 300)); // let the watcher become ready
    await writeFile(join(root, 'docs/new.md'), '# New');
    const deadline = Date.now() + 5000;
    while (!ws.index.has('docs/new.md') && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 50));
    await ws.settled();
    expect(ws.index.has('docs/new.md')).toBe(true);
    expect(
      events.some((e) => e.type === 'files-changed' && e.changed.includes('docs/new.md')),
    ).toBe(true);
  });
});

describe('harness specs', () => {
  it('loads repository specs and reloads them when they change on disk', async () => {
    await new Promise((r) => setTimeout(r, 300));
    await mkdir(join(root, '.contextmd/harnesses'), { recursive: true });
    await writeFile(
      join(root, '.contextmd/harnesses/mine.yaml'),
      'id: mine\nname: Mine\nfiles: [AGENTS.md]\ncommand: evil\n',
    );
    const deadline = Date.now() + 5000;
    while (!ws.registry.adapters.some((a) => a.id === 'mine') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await ws.settled();
    const mine = ws.snapshot().adapters.find((a) => a.id === 'mine');
    expect(mine).toMatchObject({ origin: 'repository', fidelity: 'declared' });
    expect(mine?.command).toBeUndefined();
    const res = await ws.resolveContext({ adapterId: 'mine', target: { cwd: '' } });
    expect(
      res.resolved.segments.filter((s) => s.status === 'included').map((s) => s.source.path),
    ).toEqual(['AGENTS.md']);
  });

  it('validates terminal directories', async () => {
    await expect(ws.resolveDir('docs')).resolves.toContain('docs');
    await expect(ws.resolveDir('')).resolves.toBe(ws.root);
    await expect(ws.resolveDir('../')).rejects.toThrow(/outside/);
    await expect(ws.resolveDir('AGENTS.md')).rejects.toThrow(/Not a directory/);
  });
});

describe('context', () => {
  it('resolves, renders and analyzes through the adapter registry', async () => {
    const res = await ws.resolveContext({ adapterId: 'generic', target: { cwd: 'docs' } });
    expect(res.resolved.segments.map((s) => s.source.path)).toEqual(['AGENTS.md']);
    expect(res.rendered.text).toContain('<!-- SOURCE: /AGENTS.md -->');
    await expect(ws.resolveContext({ adapterId: 'nope', target: { cwd: '' } })).rejects.toThrow(
      /Unknown adapter/,
    );
    await expect(
      ws.resolveContext({ adapterId: 'generic', target: { cwd: '../..' } }),
    ).rejects.toThrow(/outside/);
  });
});
