import type { FileSystem } from '../fs/types';
import type { RepositoryIndex } from '../index/repository-index';
import { toAbs } from '../paths';
import { classify, RECOGNIZED_PATTERNS, type RecognizedPattern } from '../scan/classify';
import { BUILTIN_SPECS } from './builtin-specs';
import { claudeCodeAdapter } from './claude-code';
import { codexAdapter } from './codex';
import { createSpecAdapter } from './declarative';
import { genericAdapter } from './generic';
import { parseSpecText, type HarnessSpec, type SpecProblem } from './spec';
import type { AdapterOrigin, HarnessAdapter } from './types';

/**
 * Built-in adapters. Complex harnesses are TypeScript; simpler ones are declarative specs.
 * An adapter should be 'documented' only if its semantics follow published documentation.
 */
export const BUILTIN_ADAPTERS: readonly HarnessAdapter[] = [
  genericAdapter,
  claudeCodeAdapter,
  codexAdapter,
  ...BUILTIN_SPECS.map((s) => createSpecAdapter(s, 'builtin')),
];

export function getAdapter(id: string): HarnessAdapter | undefined {
  return BUILTIN_ADAPTERS.find((a) => a.id === id);
}

/** Where repositories keep their own harness specs. */
export const REPO_SPEC_DIR = '.contextmd/harnesses';
const SPEC_EXT = /\.(ya?ml|json)$/i;
const MAX_SPEC_BYTES = 64 * 1024;

export interface LoadedSpecs {
  specs: { spec: HarnessSpec; origin: AdapterOrigin; file: string }[];
  problems: SpecProblem[];
}

/** Reads and validates every spec file in a directory. Missing directory = no specs. */
export async function loadSpecsFromDir(
  fs: FileSystem,
  absDir: string,
  origin: AdapterOrigin,
  displayDir: string,
): Promise<LoadedSpecs> {
  const out: LoadedSpecs = { specs: [], problems: [] };
  let entries;
  try {
    entries = await fs.readDir(absDir);
  } catch {
    return out;
  }
  for (const e of entries
    .filter((x) => x.isFile && SPEC_EXT.test(x.name))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const file = `${displayDir}/${e.name}`;
    try {
      const abs = `${absDir.replace(/\/+$/, '')}/${e.name}`;
      if ((await fs.stat(abs)).size > MAX_SPEC_BYTES) {
        out.problems.push({ source: file, errors: ['Spec file is larger than 64 KB.'] });
        continue;
      }
      const { spec, errors } = parseSpecText(await fs.readFile(abs));
      if (spec) out.specs.push({ spec, origin, file });
      else out.problems.push({ source: file, errors });
    } catch (err) {
      out.problems.push({
        source: file,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }
  return out;
}

export async function loadRepoSpecs(index: RepositoryIndex): Promise<LoadedSpecs> {
  return loadSpecsFromDir(
    index.fs,
    toAbs(index.root, REPO_SPEC_DIR),
    'repository',
    `/${REPO_SPEC_DIR}`,
  );
}

export interface HarnessRegistry {
  adapters: HarnessAdapter[];
  problems: SpecProblem[];
  /** Extra filename patterns so files named by specs are recognized as instructions. */
  patterns: RecognizedPattern[];
}

/**
 * Combines built-ins with user and repository specs. Built-in ids are reserved; a user spec
 * overrides a repository spec with the same id.
 */
export function buildRegistry(...sources: LoadedSpecs[]): HarnessRegistry {
  const adapters: HarnessAdapter[] = [...BUILTIN_ADAPTERS];
  const problems: SpecProblem[] = sources.flatMap((s) => s.problems);
  const reserved = new Set(adapters.map((a) => a.id));
  const rank: Record<AdapterOrigin, number> = { builtin: 0, user: 1, repository: 2 };
  const all = sources.flatMap((s) => s.specs).sort((a, b) => rank[a.origin] - rank[b.origin]);
  const taken = new Map<string, string>();
  const specs: HarnessSpec[] = [];
  for (const { spec, origin, file } of all) {
    if (reserved.has(spec.id)) {
      problems.push({
        source: file,
        errors: [`"${spec.id}" is a built-in harness id; choose another id.`],
      });
      continue;
    }
    const prev = taken.get(spec.id);
    if (prev) {
      problems.push({
        source: file,
        errors: [`Ignored: id "${spec.id}" is already defined in ${prev}.`],
      });
      continue;
    }
    taken.set(spec.id, file);
    adapters.push(createSpecAdapter(spec, origin, file));
    specs.push(spec);
  }
  return { adapters, problems, patterns: specPatterns([...BUILTIN_SPECS, ...specs]) };
}

/** Recognize file names from specs that the built-in classification doesn't already know. */
export function specPatterns(specs: readonly HarnessSpec[]): RecognizedPattern[] {
  const extra: RecognizedPattern[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    for (const f of [...spec.files, ...(spec.rootFiles ?? [])]) {
      const base = f.split('/').pop()!;
      if (seen.has(base) || classify(f).kind !== 'doc') continue;
      seen.add(base);
      extra.push({
        id: `spec:${base}`,
        label: base,
        kind: 'instructions',
        harnesses: [spec.id],
        test: (_p, b) => b === base,
      });
    }
  }
  return [...RECOGNIZED_PATTERNS, ...extra];
}
