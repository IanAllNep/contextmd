import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeFileSystem } from '../src/fs/node';
import { RepositoryIndex } from '../src/index/repository-index';

export const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../examples/example-agent-project',
);

export const fs = new NodeFileSystem();

/** Creates a temp dir with the given files ({ 'a/b.md': 'content' }). */
export async function makeRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'contextmd-test-'));
  for (const [rel, content] of Object.entries(files)) await write(root, rel, content);
  return root;
}

export async function write(root: string, rel: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), content);
}

/** Copy of the example fixture plus files that must be ignored. */
export async function fixtureCopy(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'contextmd-fixture-'));
  await cp(FIXTURE, root, { recursive: true });
  await write(root, 'node_modules/some-pkg/README.md', '# dependency readme');
  await write(root, 'dist/generated.md', '# build output');
  await write(root, 'scratch/notes.md', '# gitignored scratch');
  return root;
}

export async function openIndex(root: string): Promise<RepositoryIndex> {
  return RepositoryIndex.open(root, fs);
}

export async function cleanup(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
