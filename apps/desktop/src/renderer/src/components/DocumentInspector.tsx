import { useEffect, useState } from 'react';
import type { DocumentDetail } from '../../../shared/api';
import { api } from '../api';
import { displayPath, fmtBytes, fmtDate, fmtInt, fmtTokens } from '../lib/format';
import { navigate, openFile, useStore } from '../store';
import { Icon } from './Icon';
import { Section } from './Section';

const KIND_LABEL: Record<string, string> = {
  instructions: 'Agent instructions',
  rule: 'Rule',
  skill: 'Skill',
  command: 'Command',
  subagent: 'Subagent',
  'project-doc': 'Project doc',
  doc: 'Markdown',
};

export function DocumentInspector({ path }: { path: string }) {
  const version = useStore((s) => s.snapshot?.version);
  const dirty = useStore((s) => {
    const b = s.buffers[path];
    return !!b && b.content !== b.savedContent;
  });
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api()
      .getDocument(path)
      .then((d) => live && (setDetail(d), setError(null)))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [path, version]);

  if (error) return <div className="empty-inline error-text">{error}</div>;
  if (!detail)
    return <div className="empty-inline muted">Not indexed (ignored or not Markdown).</div>;
  const { summary, doc, backlinks, brokenLinks } = detail;
  const brokenLines = new Set(brokenLinks.map((b) => `${b.line}:${b.href}`));
  const internal = doc?.links.filter((l) => l.kind === 'internal') ?? [];
  const external = doc?.links.filter((l) => l.kind === 'external') ?? [];
  const minDepth = Math.min(...(doc?.headings.map((h) => h.depth) ?? [1]));

  return (
    <div className="inspector-body">
      {dirty && (
        <div className="notice">
          Showing the last saved version. Save to update the outline and links.
        </div>
      )}
      <Section title="Outline" count={doc?.headings.length ?? 0}>
        {doc && doc.headings.length > 0 ? (
          <ul className="outline">
            {doc.headings.map((h) => (
              <li
                key={`${h.line}-${h.slug}`}
                style={{ paddingLeft: 8 + (h.depth - minDepth) * 12 }}
                onClick={() => navigate(path, h.line)}
                title={`Line ${h.line}`}
              >
                <span className="outline-depth">H{h.depth}</span>
                <span className="outline-text">{h.text || '(empty)'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-inline muted">No headings.</div>
        )}
      </Section>

      <Section title="Metadata">
        <dl className="meta">
          <dt>File</dt>
          <dd>{summary.name}</dd>
          <dt>Path</dt>
          <dd className="mono" title={displayPath(summary.path)}>
            {displayPath(summary.path)}
            <button
              className="icon-btn inline"
              title="Reveal in file manager"
              onClick={() => void api().revealInFolder(summary.path)}
            >
              <Icon name="external" size={12} />
            </button>
          </dd>
          <dt>Role</dt>
          <dd>
            <span className={`kind-pill kind-${summary.kind}`}>{KIND_LABEL[summary.kind]}</span>
            {summary.label && summary.kind !== 'doc' && (
              <span className="muted"> {summary.label}</span>
            )}
          </dd>
          {summary.symlinkTarget && (
            <>
              <dt>Symlink</dt>
              <dd className="mono">→ {displayPath(summary.symlinkTarget)}</dd>
            </>
          )}
          {summary.stats && (
            <>
              <dt>Tokens</dt>
              <dd>
                ~{fmtTokens(summary.stats.tokens)} <span className="muted">(estimate)</span>
              </dd>
              <dt>Words</dt>
              <dd>{fmtInt(summary.stats.words)}</dd>
              <dt>Characters</dt>
              <dd>{fmtInt(summary.stats.characters)}</dd>
              <dt>Lines</dt>
              <dd>{fmtInt(summary.stats.lines)}</dd>
            </>
          )}
          <dt>Size</dt>
          <dd>{fmtBytes(summary.size)}</dd>
          <dt>Modified</dt>
          <dd>{fmtDate(summary.mtimeMs)}</dd>
          {doc?.codeBlocks.length ? (
            <>
              <dt>Code blocks</dt>
              <dd>{doc.codeBlocks.length}</dd>
            </>
          ) : null}
          {doc?.frontmatter && (
            <>
              <dt>Frontmatter</dt>
              <dd>
                {doc.frontmatter.error ? (
                  <span className="error-text" title={doc.frontmatter.error}>
                    invalid YAML
                  </span>
                ) : (
                  Object.keys(doc.frontmatter.data ?? {}).join(', ') || '(empty)'
                )}
              </dd>
            </>
          )}
          {summary.error && (
            <>
              <dt>Note</dt>
              <dd className="error-text">{summary.error}</dd>
            </>
          )}
        </dl>
      </Section>

      <Section title="Links" count={internal.length + external.length}>
        {internal.length + external.length === 0 && (
          <div className="empty-inline muted">No outgoing links.</div>
        )}
        <ul className="link-list">
          {internal.map((l) => {
            const broken = brokenLines.has(`${l.line}:${l.href}`);
            return (
              <li key={`${l.line}:${l.column}`} className={broken ? 'broken' : ''}>
                <Icon name={broken ? 'warning' : 'link'} size={12} />
                <button
                  className="link-btn"
                  onClick={() =>
                    broken || !l.target ? navigate(path, l.line) : void openFile(l.target)
                  }
                  title={broken ? `Broken: ${l.href}` : l.href}
                >
                  {l.target ? displayPath(l.target) : l.href}
                  {l.fragment ? `#${l.fragment}` : ''}
                </button>
                <span className="line-ref" onClick={() => navigate(path, l.line)}>
                  :{l.line}
                </span>
              </li>
            );
          })}
          {external.map((l) => (
            <li key={`${l.line}:${l.column}`} className="external">
              <Icon name="external" size={12} />
              <button
                className="link-btn"
                onClick={() => void api().openExternal(l.href)}
                title={l.href}
              >
                {l.href}
              </button>
              <span className="line-ref" onClick={() => navigate(path, l.line)}>
                :{l.line}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Backlinks" count={backlinks.length}>
        {backlinks.length === 0 ? (
          <div className="empty-inline muted">No other Markdown file links here.</div>
        ) : (
          <ul className="link-list">
            {backlinks.map((b) => (
              <li key={`${b.from}:${b.line}`}>
                <Icon name="link" size={12} />
                <button
                  className="link-btn"
                  onClick={() => void openFile(b.from, b.line)}
                  title={`“${b.text}”`}
                >
                  {displayPath(b.from)}
                </button>
                <span className="line-ref">:{b.line}</span>
                <div className="link-text">“{b.text}”</div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
