import type { ResolvedContext } from '../context/types';
import { extractStatements, type Statement } from './statements';
import type { Diagnostic } from './types';

export interface AnalyzeOptions {
  /** Enables the experimental polarity-based conflict heuristic. */
  experimentalConflicts?: boolean;
}

const NEGATION =
  /\b(never|not|don't|dont|do not|must not|mustn't|should not|shouldn't|avoid|no longer|forbidden|prohibited|disallowed|without)\b/;
const STOPWORDS = new Set(
  (
    'a an the and or but if then else when whenever while of to in on at by for with from into onto as is are be been being ' +
    'it its this that these those there here you your we our they their i me my he she them us do does did done ' +
    "always never not dont don't must should shall will would can could may might please only also just any all " +
    'every each some no yes avoid without so than too very more most less least new required require requires ' +
    'make sure ensure use using used prefer instead'
  ).split(' '),
);

function stem(w: string): string {
  return w.replace(/(ations|ation|ings|ing|ies|ied|es|ed|ly|s)$/, '').replace(/e$/, '');
}

export function contentWords(normalized: string): Set<string> {
  return new Set(
    normalized
      .split(' ')
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map(stem)
      .filter((w) => w.length > 2),
  );
}

export function isNegative(normalized: string): boolean {
  return NEGATION.test(normalized);
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

/**
 * Deterministic analysis of a resolved context. No network, no LLM.
 *  - duplicate: the same normalized statement appears in more than one source
 *  - conflict (experimental, heuristic): a negated and an affirmative statement from different
 *    sources that share most of their content words
 */
export function analyzeContext(
  resolved: ResolvedContext,
  options: AnalyzeOptions = {},
): Diagnostic[] {
  const statements = extractStatements(resolved.segments);
  const diagnostics: Diagnostic[] = [];

  const byText = new Map<string, Statement[]>();
  for (const s of statements) {
    const list = byText.get(s.normalized);
    if (list) list.push(s);
    else byText.set(s.normalized, [s]);
  }
  for (const group of byText.values()) {
    const paths = new Set(group.map((g) => g.path));
    if (paths.size < 2) continue;
    diagnostics.push({
      id: nextId('dup'),
      kind: 'duplicate',
      severity: 'info',
      rule: 'duplicate-statement',
      heuristic: false,
      message: `Duplicated instruction in ${paths.size} sources`,
      explanation:
        'The same instruction reaches the agent more than once. That costs tokens, and the copies can drift apart when one is edited.',
      sources: group.map((g) => ({ path: g.path, line: g.line, excerpt: g.text })),
    });
  }

  if (options.experimentalConflicts) {
    const withWords = statements.map((s) => ({
      s,
      neg: isNegative(s.normalized),
      words: contentWords(s.normalized),
    }));
    const seen = new Set<string>();
    for (const a of withWords) {
      if (!a.neg) continue;
      for (const b of withWords) {
        if (b.neg || a.s.path === b.s.path) continue;
        const shared = [...a.words].filter((w) => b.words.has(w));
        const overlap = shared.length / Math.max(1, Math.min(a.words.size, b.words.size));
        if (shared.length < 2 || overlap < 0.5) continue;
        const key = `${a.s.path}:${a.s.line}|${b.s.path}:${b.s.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        diagnostics.push({
          id: nextId('conflict'),
          kind: 'conflict',
          severity: 'warning',
          rule: 'polarity-overlap',
          heuristic: true,
          message: 'Potential conflict',
          explanation: `One source says not to do something and another says to do it. Both mention: ${shared.join(', ')}. This is a word-overlap heuristic, so verify manually.`,
          sources: [
            { path: a.s.path, line: a.s.line, excerpt: a.s.text },
            { path: b.s.path, line: b.s.line, excerpt: b.s.text },
          ],
        });
      }
    }
  }
  const rank = { error: 0, warning: 1, info: 2 } as const;
  return diagnostics.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
