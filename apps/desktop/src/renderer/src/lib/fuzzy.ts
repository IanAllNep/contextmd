/** Subsequence fuzzy score; higher is better, null if no match. */
export function fuzzyScore(query: string, text: string): number | null {
  if (query === '') return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct !== -1) return 1000 - direct - (t.length - q.length) * 0.1;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    streak = found === ti ? streak + 1 : 0;
    score += 1 + streak * 2 + (found === 0 || '/._- '.includes(t[found - 1] ?? '') ? 5 : 0);
    ti = found + 1;
  }
  return score - t.length * 0.05;
}
