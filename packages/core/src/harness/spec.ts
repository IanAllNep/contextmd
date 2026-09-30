import YAML from 'yaml';

/**
 * Declarative harness specification. Describes where an agent looks for instruction files,
 * without code. Loaded from built-ins, `.contextmd/harnesses/*.{yaml,yml,json}` in a repository,
 * or the user's harness folder. Specs are data: nothing in them is executed.
 */
export interface HarnessSpec {
  /** Lowercase id, e.g. `my-agent`. */
  id: string;
  name: string;
  description?: string;
  /** Built-in specs may be 'documented'. User and repository specs are always 'declared'. */
  fidelity?: 'documented' | 'declared';
  references?: { title: string; url: string }[];
  verifiedOn?: string;
  /** Caveats shown with every resolution. */
  notes?: string[];
  /** CLI command that starts the agent (honoured for built-in and user specs only). */
  command?: string;
  /** Files outside the repository the agent also reads (shown, never read). */
  global?: string[];
  /**
   * Project root detection. `markers`: files/dirs that mark a root (nearest ancestor of the
   * launch directory wins). `fallback`: what to use when none is found. Default: the opened folder.
   */
  root?: { markers: string[]; fallback?: 'cwd' | 'repo-root' };
  /**
   * Which directories are checked:
   * - root-to-cwd: every directory from the project root down to the launch directory
   * - cwd-only:    only the launch directory
   * - root-only:   only the project root
   * - nearest:     walk up from the launch directory; the first directory with a match wins
   */
  traversal?: 'root-to-cwd' | 'cwd-only' | 'root-only' | 'nearest';
  /** Candidate files per directory, in priority order (may be empty). May include subpaths (`.claude/CLAUDE.md`). */
  files: string[];
  /** Extra candidates checked only in the project root (e.g. `.github/copilot-instructions.md`). */
  rootFiles?: string[];
  /** 'first': at most one file per directory. 'all': every match. Default 'all'. */
  perDirectory?: 'first' | 'all';
  /** Skip files that are empty or whitespace-only. */
  skipEmpty?: boolean;
  /** Directories between the launch directory and the working file load on demand. */
  onDemand?: boolean;
  /** `@path` imports. `in`: only expand imports in these file names (default: all). */
  imports?: { syntax: 'at'; maxDepth: number; in?: string[] };
  /** Remove block-level HTML comments before injection. */
  stripHtmlComments?: boolean;
  /** Combined byte budget for all loaded files; `overflow` decides what happens at the limit. */
  maxBytes?: number;
  overflow?: 'truncate' | 'skip';
  /** Files larger than this are skipped. */
  maxFileBytes?: number;
  /**
   * Conditional rule files. `glob` is matched against paths relative to the project root.
   * A rule loads at launch when `alwaysField` is true (or it has no globs and default is
   * 'always'); it loads on demand when the working file matches the globs in `globsField`.
   */
  rules?: {
    glob: string;
    globsField?: string;
    alwaysField?: string;
    default?: 'always' | 'skip';
    stripFrontmatter?: boolean;
  }[];
  /** Config files (YAML/JSON) at the project root or launch directory that list extra files to read. */
  configReads?: { file: string; key: string }[];
}

export interface SpecProblem {
  /** Spec file (or built-in id). */
  source: string;
  errors: string[];
}

const TRAVERSALS = ['root-to-cwd', 'cwd-only', 'root-only', 'nearest'];
const KNOWN_KEYS = new Set([
  'id',
  'name',
  'description',
  'fidelity',
  'references',
  'verifiedOn',
  'notes',
  'command',
  'global',
  'root',
  'traversal',
  'files',
  'rootFiles',
  'perDirectory',
  'skipEmpty',
  'onDemand',
  'imports',
  'stripHtmlComments',
  'maxBytes',
  'overflow',
  'maxFileBytes',
  'rules',
  'configReads',
]);

const isStrArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string' && x !== '');
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Relative, inside the repository, no traversal. */
function badPath(p: string): boolean {
  return (
    p.startsWith('/') || p.startsWith('~') || /^[a-z]:/i.test(p) || p.split('/').includes('..')
  );
}

/** Validates untrusted spec data. Returns the spec only if there are no errors. */
export function validateSpec(raw: unknown): { spec: HarnessSpec | null; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw)) return { spec: null, errors: ['Spec must be an object.'] };
  const r = raw;
  for (const k of Object.keys(r)) if (!KNOWN_KEYS.has(k)) errors.push(`Unknown field "${k}".`);
  if (typeof r['id'] !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(r['id'])) {
    errors.push(
      '"id" must be lowercase letters, digits and dashes (max 40), starting with a letter.',
    );
  }
  if (typeof r['name'] !== 'string' || r['name'].trim() === '') errors.push('"name" is required.');
  if (!Array.isArray(r['files']) || !r['files'].every((f) => typeof f === 'string' && f !== '')) {
    errors.push('"files" must be a list of file names.');
  } else if (
    r['files'].length === 0 &&
    !Array.isArray(r['rules']) &&
    !Array.isArray(r['configReads']) &&
    !isStrArray(r['rootFiles'])
  ) {
    errors.push('A spec needs at least one of "files", "rootFiles", "rules" or "configReads".');
  }
  for (const key of ['files', 'rootFiles'] as const) {
    if (isStrArray(r[key]))
      for (const f of r[key])
        if (badPath(f))
          errors.push(`"${key}" entry "${f}" must be a relative path inside the repository.`);
  }
  if (r['rootFiles'] !== undefined && !isStrArray(r['rootFiles']))
    errors.push('"rootFiles" must be a list of paths.');
  if (r['global'] !== undefined && !isStrArray(r['global']))
    errors.push('"global" must be a list of paths.');
  if (r['notes'] !== undefined && !isStrArray(r['notes']))
    errors.push('"notes" must be a list of strings.');
  if (r['traversal'] !== undefined && !TRAVERSALS.includes(r['traversal'] as string)) {
    errors.push(`"traversal" must be one of ${TRAVERSALS.join(', ')}.`);
  }
  if (
    r['perDirectory'] !== undefined &&
    r['perDirectory'] !== 'first' &&
    r['perDirectory'] !== 'all'
  ) {
    errors.push('"perDirectory" must be "first" or "all".');
  }
  if (
    r['fidelity'] !== undefined &&
    r['fidelity'] !== 'documented' &&
    r['fidelity'] !== 'declared'
  ) {
    errors.push('"fidelity" must be "documented" or "declared".');
  }
  if (r['overflow'] !== undefined && r['overflow'] !== 'truncate' && r['overflow'] !== 'skip') {
    errors.push('"overflow" must be "truncate" or "skip".');
  }
  for (const k of ['maxBytes', 'maxFileBytes']) {
    if (
      r[k] !== undefined &&
      !(typeof r[k] === 'number' && Number.isInteger(r[k]) && (r[k] as number) > 0)
    ) {
      errors.push(`"${k}" must be a positive integer.`);
    }
  }
  for (const k of ['skipEmpty', 'onDemand', 'stripHtmlComments']) {
    if (r[k] !== undefined && typeof r[k] !== 'boolean')
      errors.push(`"${k}" must be true or false.`);
  }
  if (
    r['command'] !== undefined &&
    (typeof r['command'] !== 'string' || /[\n\r]/.test(r['command']))
  ) {
    errors.push('"command" must be a single-line string.');
  }
  if (r['root'] !== undefined) {
    const root = r['root'];
    if (!isObj(root) || !isStrArray(root['markers']))
      errors.push('"root.markers" must be a list of names.');
    else if (
      root['fallback'] !== undefined &&
      root['fallback'] !== 'cwd' &&
      root['fallback'] !== 'repo-root'
    ) {
      errors.push('"root.fallback" must be "cwd" or "repo-root".');
    }
  }
  if (r['imports'] !== undefined) {
    const im = r['imports'];
    if (!isObj(im) || im['syntax'] !== 'at') errors.push('"imports.syntax" must be "at".');
    else if (!(
      typeof im['maxDepth'] === 'number' &&
      Number.isInteger(im['maxDepth']) &&
      im['maxDepth'] >= 1 &&
      im['maxDepth'] <= 20
    )) {
      errors.push('"imports.maxDepth" must be an integer between 1 and 20.');
    } else if (im['in'] !== undefined && !isStrArray(im['in']))
      errors.push('"imports.in" must be a list of file names.');
  }
  if (r['references'] !== undefined) {
    if (
      !Array.isArray(r['references']) ||
      !r['references'].every(
        (x) => isObj(x) && typeof x['title'] === 'string' && typeof x['url'] === 'string',
      )
    ) {
      errors.push('"references" must be a list of { title, url }.');
    }
  }
  if (r['rules'] !== undefined) {
    if (!Array.isArray(r['rules'])) errors.push('"rules" must be a list.');
    else
      r['rules'].forEach((rule, i) => {
        if (!isObj(rule) || typeof rule['glob'] !== 'string' || badPath(rule['glob']))
          errors.push(`"rules[${i}].glob" must be a relative glob.`);
        else if (
          rule['default'] !== undefined &&
          rule['default'] !== 'always' &&
          rule['default'] !== 'skip'
        )
          errors.push(`"rules[${i}].default" must be "always" or "skip".`);
      });
  }
  if (r['configReads'] !== undefined) {
    if (
      !Array.isArray(r['configReads']) ||
      !r['configReads'].every(
        (c) =>
          isObj(c) &&
          typeof c['file'] === 'string' &&
          !badPath(c['file']) &&
          typeof c['key'] === 'string',
      )
    ) {
      errors.push('"configReads" must be a list of { file, key } with relative file paths.');
    }
  }
  return { spec: errors.length === 0 ? (r as unknown as HarnessSpec) : null, errors };
}

/** Parses a YAML or JSON spec file. */
export function parseSpecText(text: string): { spec: HarnessSpec | null; errors: string[] } {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (e) {
    return {
      spec: null,
      errors: [`Could not parse: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`],
    };
  }
  return validateSpec(raw);
}
