import { useMemo } from 'react';
import type { DocumentSummary } from '@contextmd/core';
import { buildTree, isAgentKind, type TreeDir } from '../lib/tree';
import { openFile, selectDirectory, useStore } from '../store';
import { Icon } from './Icon';

const KIND_TAG: Record<string, string> = {
  rule: 'rule',
  skill: 'skill',
  command: 'cmd',
  subagent: 'agent',
  'project-doc': 'doc',
};

function FileRow({ f, depth }: { f: DocumentSummary; depth: number }) {
  const active = useStore((s) => s.activeTab === f.path);
  const dirty = useStore((s) => {
    const b = s.buffers[f.path];
    return !!b && b.content !== b.savedContent;
  });
  const agent = isAgentKind(f.kind);
  return (
    <div
      role="treeitem"
      aria-selected={active}
      className={`tree-row file kind-${f.kind} ${active ? 'active' : ''}`}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={() => void openFile(f.path, undefined, { retarget: true })}
      title={`/${f.path}${f.label ? ` · ${f.label}` : ''}${f.symlinkTarget ? ` → /${f.symlinkTarget}` : ''}`}
    >
      <span className="twisty" />
      <Icon name={agent ? 'agent' : 'file'} size={14} className="row-icon" />
      <span className="row-name">{f.name}</span>
      {f.symlinkTarget && <span className="tag">link</span>}
      {KIND_TAG[f.kind] && <span className={`tag tag-${f.kind}`}>{KIND_TAG[f.kind]}</span>}
      {dirty && <span className="dirty-dot" title="Unsaved changes" />}
    </div>
  );
}

function DirNode({ dir, depth, forceOpen }: { dir: TreeDir; depth: number; forceOpen: boolean }) {
  const open = useStore((s) => forceOpen || !!s.expanded[dir.path]);
  const isTarget = useStore((s) => s.selectedDir === dir.path);
  const toggle = () =>
    useStore.setState((s) => ({ expanded: { ...s.expanded, [dir.path]: !open } }));
  return (
    <div role="group">
      <div
        role="treeitem"
        aria-expanded={open}
        className={`tree-row dir ${isTarget ? 'target' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={toggle}
        title={`/${dir.path}`}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} className="twisty" />
        <Icon name="folder" size={14} className="row-icon" />
        <span className="row-name">{dir.name}</span>
        {dir.hasInstructions && <span className="instr-dot" title="Contains instruction files" />}
        <button
          className="row-action"
          title={`Inspect effective context for /${dir.path}`}
          onClick={(e) => {
            e.stopPropagation();
            selectDirectory(dir.path);
          }}
        >
          <Icon name="target" size={13} />
        </button>
      </div>
      {open && <DirChildren dir={dir} depth={depth + 1} forceOpen={forceOpen} />}
    </div>
  );
}

function DirChildren({
  dir,
  depth,
  forceOpen,
}: {
  dir: TreeDir;
  depth: number;
  forceOpen: boolean;
}) {
  return (
    <>
      {dir.dirs.map((d) => (
        <DirNode key={d.path} dir={d} depth={depth} forceOpen={forceOpen} />
      ))}
      {dir.files.map((f) => (
        <FileRow key={f.path} f={f} depth={depth} />
      ))}
    </>
  );
}

export function FileTree() {
  const files = useStore((s) => s.snapshot?.files);
  const filter = useStore((s) => s.treeFilter);
  const agentOnly = useStore((s) => s.agentOnly);
  const rootIsTarget = useStore((s) => s.selectedDir === '');
  const repoName = useStore((s) => s.snapshot?.name);
  const tree = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return buildTree(
      files ?? [],
      (f) => (!agentOnly || isAgentKind(f.kind)) && (q === '' || f.path.toLowerCase().includes(q)),
    );
  }, [files, filter, agentOnly]);
  const count = useMemo(() => {
    let n = 0;
    const walk = (d: TreeDir) => {
      n += d.files.length;
      d.dirs.forEach(walk);
    };
    walk(tree);
    return n;
  }, [tree]);

  return (
    <div className="file-tree">
      <div className="panel-toolbar">
        <input
          className="input"
          placeholder="Filter files…"
          value={filter}
          onChange={(e) => useStore.setState({ treeFilter: e.target.value })}
          spellCheck={false}
        />
        <button
          className={`toggle ${agentOnly ? 'on' : ''}`}
          onClick={() => useStore.setState({ agentOnly: !agentOnly })}
          title="Show only agent-facing files (instructions, rules, skills, commands, subagents)"
        >
          <Icon name="agent" size={14} />
        </button>
      </div>
      <div className="tree" role="tree">
        <div
          className={`tree-row dir root ${rootIsTarget ? 'target' : ''}`}
          onClick={() => selectDirectory('')}
          title="Inspect effective context for the repository root"
        >
          <Icon name="folder" size={14} className="row-icon" />
          <span className="row-name">{repoName}</span>
          <span className="row-meta">{count}</span>
          <span className="row-action always">
            <Icon name="target" size={13} />
          </span>
        </div>
        {count === 0 ? (
          <div className="empty-inline">
            {filter || agentOnly ? 'No files match.' : 'No Markdown files found.'}
          </div>
        ) : (
          <DirChildren dir={tree} depth={0} forceOpen={filter.trim() !== ''} />
        )}
      </div>
    </div>
  );
}
