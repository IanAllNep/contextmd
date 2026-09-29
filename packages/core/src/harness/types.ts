import type { ContextTarget, ResolvedContext } from '../context/types';
import type { RepositoryIndex } from '../index/repository-index';

export interface DetectionResult {
  detected: boolean;
  /** Files or markers that suggest this harness is used in the repository. */
  evidence: string[];
}

export interface AdapterOptionSpec {
  id: string;
  label: string;
  description: string;
  type: 'select' | 'boolean' | 'number' | 'text';
  choices?: { value: string; label: string }[];
  default: string | boolean | number;
}

export type AdapterOptions = Record<string, string | boolean | number>;

export interface HarnessAdapter {
  id: string;
  name: string;
  description: string;
  /**
   * 'heuristic': ContextMD's own approximation, not any tool's behavior.
   * 'documented': follows the vendor's published documentation (see `references`).
   */
  fidelity: 'heuristic' | 'documented';
  references: { title: string; url: string }[];
  /** Date the documented semantics were last checked against `references`. */
  verifiedOn?: string;
  options: AdapterOptionSpec[];
  detect(index: RepositoryIndex): DetectionResult;
  resolve(
    index: RepositoryIndex,
    target: ContextTarget,
    options?: AdapterOptions,
  ): Promise<ResolvedContext>;
}

export function optionValue<T extends string | boolean | number>(
  adapter: Pick<HarnessAdapter, 'options'>,
  options: AdapterOptions | undefined,
  id: string,
): T {
  const v = options?.[id];
  if (v !== undefined) return v as T;
  return adapter.options.find((o) => o.id === id)?.default as T;
}
