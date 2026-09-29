import type { DocumentSummary } from '@contextmd/core';

export interface TreeDir {
  type: 'dir';
  name: string;
  path: string;
  dirs: TreeDir[];
  files: DocumentSummary[];
  /** This directory directly contains an always-on instruction file. */
  hasInstructions: boolean;
  /** Number of agent-facing files in this subtree. */
  agentCount: number;
}

const AGENT_KINDS = new Set(['instructions', 'rule', 'skill', 'command', 'subagent']);
export const isAgentKind = (kind: string): boolean => AGENT_KINDS.has(kind);

const kindRank = (f: DocumentSummary) =>
  f.kind === 'instructions' ? 0 : isAgentKind(f.kind) ? 1 : f.kind === 'project-doc' ? 2 : 3;

export function buildTree(
  files: DocumentSummary[],
  filter: (f: DocumentSummary) => boolean,
): TreeDir {
  const root: TreeDir = {
    type: 'dir',
    name: '',
    path: '',
    dirs: [],
    files: [],
    hasInstructions: false,
    agentCount: 0,
  };
  const byPath = new Map<string, TreeDir>([['', root]]);
  const ensure = (path: string): TreeDir => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const i = path.lastIndexOf('/');
    const parent = ensure(i === -1 ? '' : path.slice(0, i));
    const dir: TreeDir = {
      type: 'dir',
      name: path.slice(i + 1),
      path,
      dirs: [],
      files: [],
      hasInstructions: false,
      agentCount: 0,
    };
    parent.dirs.push(dir);
    byPath.set(path, dir);
    return dir;
  };
  for (const f of files) {
    if (!filter(f)) continue;
    const dir = ensure(f.dir);
    dir.files.push(f);
    if (f.kind === 'instructions') dir.hasInstructions = true;
    if (isAgentKind(f.kind)) {
      let p: string | null = f.dir;
      while (p !== null) {
        byPath.get(p)!.agentCount++;
        p = p === '' ? null : p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
      }
    }
  }
  const sort = (d: TreeDir) => {
    d.dirs.sort((a, b) => a.name.localeCompare(b.name));
    d.files.sort((a, b) => kindRank(a) - kindRank(b) || a.name.localeCompare(b.name));
    d.dirs.forEach(sort);
  };
  sort(root);
  return root;
}
