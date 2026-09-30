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

/**
 * - heuristic:  ContextMD's own approximation, not any tool's behavior
 * - documented: follows the vendor's published documentation (see `references`)
 * - declared:   defined by a user or repository spec file; ContextMD has not verified it
 */
export type AdapterFidelity = 'heuristic' | 'documented' | 'declared';

/** Where an adapter came from. Repository specs are untrusted data. */
export type AdapterOrigin = 'builtin' | 'repository' | 'user';

export interface HarnessAdapter {
  id: string;
  name: string;
  description: string;
  /**
   * 'heuristic': ContextMD's own approximation, not any tool's behavior.
   * 'documented': follows the vendor's published documentation (see `references`).
   */
  fidelity: AdapterFidelity;
  references: { title: string; url: string }[];
  /** Date the documented semantics were last checked against `references`. */
  verifiedOn?: string;
  options: AdapterOptionSpec[];
  /** CLI command that starts this agent, offered in the terminal. Never set for repository specs. */
  command?: string;
  origin?: AdapterOrigin;
  /** Spec file this adapter was loaded from (declarative adapters). */
  sourceFile?: string;
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
