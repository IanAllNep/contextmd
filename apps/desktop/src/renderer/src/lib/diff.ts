export type DiffOp = { type: 'same' | 'add' | 'del'; text: string };

/** Line diff via LCS. Adequate for Markdown files up to a few thousand lines. */
export function diffLines(a: string, b: string): DiffOp[] {
  const x = a.split('\n');
  const y = b.split('\n');
  if (x.length * y.length > 4_000_000) {
    return [
      ...x.map((text) => ({ type: 'del' as const, text })),
      ...y.map((text) => ({ type: 'add' as const, text })),
    ];
  }
  const m = x.length;
  const n = y.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (x[i] === y[j]) {
      out.push({ type: 'same', text: x[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ type: 'del', text: x[i++]! });
    else out.push({ type: 'add', text: y[j++]! });
  }
  while (i < m) out.push({ type: 'del', text: x[i++]! });
  while (j < n) out.push({ type: 'add', text: y[j++]! });
  return out;
}
