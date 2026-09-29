import { claudeCodeAdapter } from './claude-code';
import { codexAdapter } from './codex';
import { genericAdapter } from './generic';
import type { HarnessAdapter } from './types';

/**
 * Built-in adapters. Add new harnesses here. An adapter should be 'documented' only if
 * its semantics follow published documentation, with references.
 */
export const BUILTIN_ADAPTERS: readonly HarnessAdapter[] = [
  genericAdapter,
  claudeCodeAdapter,
  codexAdapter,
];

export function getAdapter(id: string): HarnessAdapter | undefined {
  return BUILTIN_ADAPTERS.find((a) => a.id === id);
}
