import type { LineRange } from '../markdown/types';

export interface MappedContent {
  content: string;
  /** lineMap[i] = 1-based source line of output line i. */
  lineMap: number[];
}

export function identity(content: string): MappedContent {
  const n = content === '' ? 0 : content.split('\n').length;
  return { content, lineMap: Array.from({ length: n }, (_, i) => i + 1) };
}

/** Removes whole source lines in the given (1-based, inclusive) ranges, keeping a line map. */
export function removeLines(input: MappedContent, ranges: readonly LineRange[]): MappedContent {
  if (ranges.length === 0) return input;
  const drop = (line: number) => ranges.some((r) => line >= r.startLine && line <= r.endLine);
  const lines = input.content.split('\n');
  const outLines: string[] = [];
  const lineMap: number[] = [];
  lines.forEach((l, i) => {
    const src = input.lineMap[i] ?? i + 1;
    if (drop(src)) return;
    outLines.push(l);
    lineMap.push(src);
  });
  // Collapse leading blank lines left behind by removed frontmatter/comments.
  while (outLines.length > 0 && outLines[0]!.trim() === '') {
    outLines.shift();
    lineMap.shift();
  }
  return { content: outLines.join('\n'), lineMap };
}

/** Cuts content to at most `maxBytes` UTF-8 bytes, at a character boundary. */
export function truncateBytes(input: MappedContent, maxBytes: number): MappedContent {
  const bytes = new TextEncoder().encode(input.content);
  if (bytes.length <= maxBytes) return input;
  let cut = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, maxBytes));
  if (cut.endsWith('�')) cut = cut.slice(0, -1);
  const n = cut.split('\n').length;
  return { content: cut, lineMap: input.lineMap.slice(0, n) };
}
