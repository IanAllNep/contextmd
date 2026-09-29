/**
 * Repository paths are always repo-relative, '/'-separated, without a leading slash.
 * The repository root itself is the empty string ''.
 */

export function normalizeRel(p: string): string | null {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null; // escapes the repository
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

export function joinRel(...parts: string[]): string {
  return parts.filter((p) => p !== '').join('/');
}

export function dirnameRel(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

export function basenameRel(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

/** Directories from the repository root down to `dir`, inclusive: '' , 'a', 'a/b'. */
export function ancestorChain(dir: string): string[] {
  const chain = [''];
  if (dir === '') return chain;
  const parts = dir.split('/');
  for (let i = 1; i <= parts.length; i++) chain.push(parts.slice(0, i).join('/'));
  return chain;
}

/** True if `p` equals `dir` or lies beneath it. */
export function isWithin(p: string, dir: string): boolean {
  return dir === '' || p === dir || p.startsWith(dir + '/');
}

export function toAbs(root: string, rel: string): string {
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
  return rel === '' ? r : `${r}/${rel}`;
}

/** Converts an absolute path to repo-relative, or null if it is outside the root. */
export function toRel(root: string, abs: string): string | null {
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const a = abs.replace(/\\/g, '/');
  if (a === r) return '';
  if (a.startsWith(r + '/')) return a.slice(r.length + 1);
  return null;
}

/** Display form used in the UI and exports: '/backend/AGENTS.md'. */
export function displayPath(rel: string): string {
  return '/' + rel;
}
