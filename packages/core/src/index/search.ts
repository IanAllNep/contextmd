import { isAgentFacing } from '../scan/classify';
import type { IndexedDocument, SearchMatch, SearchOptions, SearchResult } from './types';

const SNIPPET_MAX = 180;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function searchDocuments(
  docs: Iterable<IndexedDocument>,
  query: string,
  options: SearchOptions = {},
): SearchResult {
  const started = performance.now();
  const limit = options.limit ?? 500;
  const matches: SearchMatch[] = [];
  const files = new Set<string>();
  if (query.trim() === '') return { matches, fileCount: 0, truncated: false, elapsedMs: 0 };

  let re: RegExp;
  try {
    re = new RegExp(
      options.regex ? query : escapeRegExp(query),
      options.caseSensitive ? 'g' : 'gi',
    );
  } catch (e) {
    return { matches, fileCount: 0, truncated: false, error: (e as Error).message, elapsedMs: 0 };
  }

  let truncated = false;
  outer: for (const d of docs) {
    if (d.content === null) continue;
    if (options.agentOnly && !isAgentFacing(d.classification.kind)) continue;
    const headings = d.doc?.headings ?? [];
    const lines = d.content.split('\n');
    let h = -1;
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      while (h + 1 < headings.length && headings[h + 1]!.line <= lineNo) h++;
      const text = lines[i]!;
      re.lastIndex = 0;
      const m = re.exec(text);
      if (!m || m[0].length === 0) continue;
      if (matches.length >= limit) {
        truncated = true;
        break outer;
      }
      files.add(d.path);
      // Build a snippet window around the match.
      const lead = text.length - text.trimStart().length;
      let start = lead;
      if (m.index - start > 60) start = m.index - 60;
      const snippetRaw = text.slice(start, start + SNIPPET_MAX).trimEnd();
      const prefix = start > lead ? '…' : '';
      matches.push({
        path: d.path,
        line: lineNo,
        column: m.index + 1,
        snippet: prefix + snippetRaw,
        matchStart: prefix.length + (m.index - start),
        matchEnd: prefix.length + Math.min(m.index - start + m[0].length, snippetRaw.length),
        section: h >= 0 ? headings[h]!.text : null,
      });
    }
  }
  return {
    matches,
    fileCount: files.size,
    truncated,
    elapsedMs: Math.round((performance.now() - started) * 10) / 10,
  };
}
