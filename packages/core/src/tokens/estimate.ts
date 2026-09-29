/**
 * Token counts in ContextMD are estimates unless an estimator says otherwise.
 * Different models tokenize differently; exact counts need the vendor's tokenizer.
 */
export interface TokenEstimator {
  id: string;
  label: string;
  /** True only for real tokenizers. The UI labels non-exact counts as estimates. */
  exact: boolean;
  estimate(text: string): number;
}

/**
 * ~4 characters per token is the commonly cited average for English prose with
 * BPE tokenizers (OpenAI / Anthropic guidance). Code and non-Latin scripts differ.
 */
export const charHeuristicEstimator: TokenEstimator = {
  id: 'chars-per-4',
  label: '≈ characters ÷ 4',
  exact: false,
  estimate(text: string): number {
    if (text.length === 0) return 0;
    return Math.ceil(text.length / 4);
  },
};

export const defaultEstimator = charHeuristicEstimator;

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
