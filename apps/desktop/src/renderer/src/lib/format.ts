export const fmtTokens = (n: number): string =>
  n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString('en-US');
export const fmtInt = (n: number): string => n.toLocaleString('en-US');
export const fmtBytes = (n: number): string =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;
export const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const displayPath = (rel: string): string => '/' + rel;
export const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

/** Resolves a relative Markdown href against the current document's path. */
export function resolveHref(
  fromPath: string,
  href: string,
): { path: string | null; fragment: string | null } {
  const [pathPart = '', fragment = null] = href.split('#') as [string, string | undefined];
  if (pathPart === '') return { path: null, fragment };
  let decoded = pathPart;
  try {
    decoded = decodeURI(pathPart);
  } catch {
    /* keep */
  }
  const parts: string[] = decoded.startsWith('/') ? [] : dirOf(fromPath).split('/').filter(Boolean);
  for (const seg of decoded.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return { path: null, fragment };
      parts.pop();
    } else parts.push(seg);
  }
  return { path: parts.join('/'), fragment: fragment ?? null };
}
