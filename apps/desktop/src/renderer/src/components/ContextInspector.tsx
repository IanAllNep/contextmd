import type { ContextSegment, Diagnostic } from '@contextmd/core';
import { api } from '../api';
import { displayPath, fmtTokens } from '../lib/format';
import { copyContext, navigate, openContextTab, openFile, setTarget, useStore } from '../store';
import { Icon } from './Icon';
import { Section } from './Section';

const SCOPE_LABEL: Record<ContextSegment['scope'], string> = {
  policy: 'policy',
  user: 'user',
  project: 'project',
  directory: 'directory',
  local: 'local',
  rule: 'rule',
  imported: 'import',
  target: 'target',
};

const STATUS_ICON: Record<ContextSegment['status'], string> = {
  included: '●',
  truncated: '◐',
  skipped: '○',
  'not-read': '?',
};

/** Stable hue per source so segments are recognisable across views. */
export function segmentHue(index: number): number {
  return (index * 67 + 200) % 360;
}

function SegmentRow({ s, hue }: { s: ContextSegment; hue: number | null }) {
  const loaded = s.status === 'included' || s.status === 'truncated';
  const open = () => {
    if (s.source.type !== 'repo') return;
    const first = s.lineMap[0];
    if (s.source.path.match(/\.(md|markdown|mdx|mdc)$/i)) void openFile(s.source.path, first);
  };
  return (
    <li className={`segment status-${s.status}`} style={{ paddingLeft: 6 + s.depth * 14 }}>
      <div
        className="segment-main"
        onClick={open}
        title={s.source.type === 'repo' ? 'Open source' : 'Outside the repository'}
      >
        <span
          className="segment-swatch"
          style={hue !== null ? { background: `hsl(${hue} 60% 55%)` } : undefined}
        >
          {hue === null ? STATUS_ICON[s.status] : ''}
        </span>
        <span className={`segment-path ${s.source.type === 'external' ? 'external' : ''}`}>
          {s.depth > 0 && <span className="muted">↳ </span>}
          {s.source.type === 'repo' ? displayPath(s.source.path) : s.source.path}
        </span>
        <span className="tag">{SCOPE_LABEL[s.scope]}</span>
        {loaded && <span className="segment-tokens">~{fmtTokens(s.tokens)}</span>}
      </div>
      <div className="segment-reason">
        {s.via ? (
          <>
            {s.reason.replace(/ at \/.*$/, '')} at{' '}
            <button className="link-btn" onClick={() => navigate(s.via!.path, s.via!.line)}>
              {displayPath(s.via.path)}:{s.via.line}
            </button>
          </>
        ) : (
          s.reason
        )}
      </div>
      {s.statusDetail && <div className={`segment-detail ${s.status}`}>{s.statusDetail}</div>}
      {s.warnings.map((w) => (
        <div key={w} className="segment-warning">
          <Icon name="info" size={11} /> {w}
        </div>
      ))}
    </li>
  );
}

function DiagnosticItem({ d }: { d: Diagnostic }) {
  return (
    <li className={`diagnostic severity-${d.severity}`}>
      <div className="diag-head">
        <Icon name={d.severity === 'info' ? 'info' : 'warning'} size={13} />
        <span className="diag-message">{d.message}</span>
        {d.heuristic && (
          <span className="tag tag-heuristic" title="Produced by a heuristic, so it may be wrong">
            heuristic
          </span>
        )}
      </div>
      {d.sources.map((src, i) => (
        <div
          key={i}
          className="diag-source"
          onClick={() => src.line && navigate(src.path, src.line)}
        >
          <span className="mono">
            {displayPath(src.path)}
            {src.line ? `:${src.line}` : ''}
          </span>
          <span className="diag-excerpt">“{src.excerpt}”</span>
        </div>
      ))}
      <div className="diag-explanation">{d.explanation}</div>
    </li>
  );
}

export function ContextInspector() {
  const snapshot = useStore((s) => s.snapshot);
  const context = useStore((s) => s.context);
  const loading = useStore((s) => s.contextLoading);
  const error = useStore((s) => s.contextError);
  const target = useStore((s) => s.target);
  const pinCwd = useStore((s) => s.pinCwd);
  const adapterId = useStore((s) => s.adapterId);
  const adapterOptions = useStore((s) => s.adapterOptions);
  const experimental = useStore((s) => s.experimentalConflicts);
  const activeTab = useStore((s) => s.activeTab);
  if (!snapshot) return null;

  const adapter = snapshot.adapters.find((a) => a.id === adapterId) ?? snapshot.adapters[0]!;
  const opts = adapterOptions[adapter.id] ?? {};
  const setOpt = (id: string, value: string | number | boolean) =>
    useStore.setState((s) => ({
      adapterOptions: { ...s.adapterOptions, [adapter.id]: { ...opts, [id]: value } },
    }));

  const segs = context?.resolved.segments ?? [];
  const loaded = segs.filter((s) => s.status === 'included' || s.status === 'truncated');
  const hueOf = new Map(loaded.map((s, i) => [s.id, segmentHue(i)]));
  const launch = loaded.filter((s) => s.timing === 'launch');
  const onDemand = loaded.filter((s) => s.timing === 'on-demand');
  const skipped = segs.filter((s) => s.status === 'skipped');
  const notRead = segs.filter((s) => s.status === 'not-read');
  const total = context?.resolved.totals.tokens ?? 0;
  const activeFile = activeTab && !activeTab.startsWith('context://') ? activeTab : null;

  return (
    <div className="inspector-body context-inspector">
      <div className="ctx-controls">
        <label className="field">
          <span className="field-label">Harness</span>
          <select
            className="select"
            value={adapter.id}
            onChange={(e) => useStore.setState({ adapterId: e.target.value })}
          >
            {snapshot.adapters.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.detected && a.id !== 'generic' ? ' •' : ''}
              </option>
            ))}
          </select>
          <span
            className={`fidelity fidelity-${adapter.fidelity}`}
            title={
              adapter.fidelity === 'heuristic'
                ? 'ContextMD approximation, not a specific tool'
                : `Follows the vendor documentation${adapter.verifiedOn ? ` (checked ${adapter.verifiedOn})` : ''}`
            }
          >
            {adapter.fidelity}
          </span>
        </label>
        <p className="adapter-desc">
          {adapter.description}
          {adapter.references.map((r) => (
            <button
              key={r.url}
              className="link-btn ref"
              onClick={() => void api().openExternal(r.url)}
              title={r.url}
            >
              {r.title} <Icon name="external" size={10} />
            </button>
          ))}
        </p>
        {adapter.options.map((o) => (
          <label key={o.id} className="field" title={o.description}>
            <span className="field-label">{o.label}</span>
            {o.type === 'select' ? (
              <select
                className="select"
                value={String(opts[o.id] ?? o.default)}
                onChange={(e) => setOpt(o.id, e.target.value)}
              >
                {o.choices?.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            ) : o.type === 'boolean' ? (
              <input
                type="checkbox"
                checked={Boolean(opts[o.id] ?? o.default)}
                onChange={(e) => setOpt(o.id, e.target.checked)}
              />
            ) : (
              <input
                className="input"
                type={o.type === 'number' ? 'number' : 'text'}
                value={String(opts[o.id] ?? o.default)}
                placeholder={o.type === 'text' ? 'none' : undefined}
                onChange={(e) =>
                  setOpt(o.id, o.type === 'number' ? Number(e.target.value) : e.target.value)
                }
              />
            )}
          </label>
        ))}

        <div className="field">
          <span className="field-label">Launch dir</span>
          <button
            className="chip"
            onClick={() => useStore.setState({ palette: 'dirs' })}
            title="Choose the directory the agent is launched from"
          >
            <Icon name="folder" size={12} /> {displayPath(target.cwd)}
          </button>
          <button
            className={`toggle small ${pinCwd ? 'on' : ''}`}
            onClick={() => useStore.setState({ pinCwd: !pinCwd })}
            title="Keep this launch directory when opening files"
          >
            <Icon name="pin" size={12} />
          </button>
        </div>
        <div className="field">
          <span className="field-label">Working on</span>
          {target.file ? (
            <span className="chip">
              <Icon name="file" size={12} /> {displayPath(target.file)}
              <button
                className="chip-x"
                onClick={() => setTarget({ file: null })}
                title="Clear working file"
              >
                <Icon name="close" size={10} />
              </button>
            </span>
          ) : (
            <span className="muted small">none</span>
          )}
          {activeFile && activeFile !== target.file && (
            <button className="link-btn small" onClick={() => setTarget({ file: activeFile })}>
              use active file
            </button>
          )}
        </div>
      </div>

      <div className="ctx-total">
        <div className="ctx-total-row">
          <span className="ctx-total-num">~{fmtTokens(total)}</span>
          <span className="muted">
            tokens · {loaded.length} {loaded.length === 1 ? 'source' : 'sources'}
            {context &&
              context.resolved.totals.onDemandTokens > 0 &&
              ` · ${fmtTokens(context.resolved.totals.onDemandTokens)} on demand`}
          </span>
          {loading && <span className="spinner" />}
        </div>
        <div className="token-bar" title="Share of estimated tokens per source">
          {loaded.map((s) => (
            <span
              key={s.id}
              style={{
                flexGrow: Math.max(s.tokens, 1),
                background: `hsl(${hueOf.get(s.id)} 60% 55%)`,
              }}
              title={`${s.source.path} · ~${s.tokens} tokens`}
            />
          ))}
        </div>
        <div className="ctx-actions">
          <button
            className="btn primary"
            onClick={() => void copyContext('markdown')}
            disabled={loaded.length === 0}
          >
            <Icon name="copy" size={13} /> Copy
          </button>
          <button
            className="btn"
            onClick={() => void copyContext('plain')}
            disabled={loaded.length === 0}
            title="Copy as plain text"
          >
            Plain
          </button>
          <button
            className="btn"
            onClick={() => void copyContext('json')}
            title="Copy as JSON with provenance"
          >
            JSON
          </button>
          <button
            className="btn"
            onClick={openContextTab}
            title="Open the concatenated context with line-level provenance"
          >
            <Icon name="layers" size={13} /> Full view
          </button>
        </div>
        <div className="muted small">
          Token counts are estimates ({context?.resolved.estimatorLabel ?? '≈ characters ÷ 4'}).
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}

      <Section title="Loaded at launch" count={launch.length}>
        {launch.length === 0 ? (
          <div className="empty-inline muted">
            No instruction files reach the agent for this target.
          </div>
        ) : (
          <ul className="segments">
            {launch.map((s) => (
              <SegmentRow key={s.id} s={s} hue={hueOf.get(s.id) ?? null} />
            ))}
          </ul>
        )}
      </Section>
      {onDemand.length > 0 && (
        <Section title="Loaded on demand" count={onDemand.length}>
          <ul className="segments">
            {onDemand.map((s) => (
              <SegmentRow key={s.id} s={s} hue={hueOf.get(s.id) ?? null} />
            ))}
          </ul>
        </Section>
      )}
      {skipped.length > 0 && (
        <Section title="Not loaded" count={skipped.length}>
          <ul className="segments">
            {skipped.map((s) => (
              <SegmentRow key={s.id} s={s} hue={null} />
            ))}
          </ul>
        </Section>
      )}
      <Section
        title="Diagnostics"
        count={context?.diagnostics.length ?? 0}
        actions={
          <label
            className="small muted check"
            title="Heuristic contradiction detection. It can produce false positives."
          >
            <input
              type="checkbox"
              checked={experimental}
              onChange={(e) => useStore.setState({ experimentalConflicts: e.target.checked })}
            />{' '}
            conflicts
          </label>
        }
      >
        {context && context.diagnostics.length > 0 ? (
          <ul className="diagnostics">
            {context.diagnostics.map((d) => (
              <DiagnosticItem key={d.id} d={d} />
            ))}
          </ul>
        ) : (
          <div className="empty-inline muted">
            No duplicates{experimental ? ' or potential conflicts' : ''} found.
          </div>
        )}
      </Section>
      {notRead.length > 0 && (
        <Section title="Outside repository" count={notRead.length} defaultOpen={false}>
          <ul className="segments">
            {notRead.map((s) => (
              <SegmentRow key={s.id} s={s} hue={null} />
            ))}
          </ul>
        </Section>
      )}
      {context && context.resolved.notes.length > 0 && (
        <Section
          title="Notes"
          count={context.resolved.notes.length}
          defaultOpen={adapter.id !== 'generic'}
        >
          <ul className="notes">
            {context.resolved.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
