export type DiagnosticKind = 'duplicate' | 'conflict' | 'broken-link' | 'size';
export type Severity = 'info' | 'warning' | 'error';

export interface DiagnosticSource {
  path: string;
  line: number | null;
  excerpt: string;
}

export interface Diagnostic {
  id: string;
  kind: DiagnosticKind;
  severity: Severity;
  message: string;
  explanation: string;
  /** Deterministic rule id that produced it, for traceability. */
  rule: string;
  /** True for heuristics that can be wrong (shown as such in the UI). */
  heuristic: boolean;
  sources: DiagnosticSource[];
}
