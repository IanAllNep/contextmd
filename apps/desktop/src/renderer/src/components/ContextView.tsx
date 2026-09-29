import { displayPath, fmtTokens } from '../lib/format';
import { copyContext, navigate, useStore } from '../store';
import { segmentHue } from './ContextInspector';
import { Icon } from './Icon';

/**
 * The concatenated effective context, one row per output line, each traced back to its
 * source file and line. Click a line to jump to where it came from.
 */
export function ContextView() {
  const context = useStore((s) => s.context);
  if (!context)
    return (
      <div className="empty-state">
        <p className="muted">Resolving context…</p>
      </div>
    );
  const { resolved, rendered } = context;
  const texts = rendered.text.split('\n');
  const loaded = resolved.segments.filter(
    (s) => s.status === 'included' || s.status === 'truncated',
  );
  const hue = new Map(loaded.map((s, i) => [s.id, segmentHue(i)]));
  const target = resolved.target.file
    ? `${displayPath(resolved.target.cwd)} · working on ${displayPath(resolved.target.file)}`
    : displayPath(resolved.target.cwd);

  return (
    <div className="context-view">
      <div className="context-view-header">
        <div>
          <strong>Effective context</strong>
          <span className="muted">
            {' '}
            · {resolved.adapterName} ({resolved.fidelity}) · {target} · ~
            {fmtTokens(resolved.totals.tokens)} tokens (estimate)
          </span>
        </div>
        <button className="btn" onClick={() => void copyContext('markdown')}>
          <Icon name="copy" size={13} /> Copy
        </button>
      </div>
      <div className="context-lines" role="list">
        {rendered.lines.map((info, i) => {
          const text = texts[i] ?? '';
          const src = info.source;
          const clickable = src?.type === 'repo' && info.sourceLine !== null;
          const isBoundary =
            info.segmentId !== null && info.sourceLine === null && text.includes('SOURCE:');
          return (
            <div
              key={i}
              role="listitem"
              className={`ctx-line ${isBoundary ? 'boundary' : ''} ${info.segmentId === null ? 'meta' : ''} ${clickable ? 'clickable' : ''}`}
              style={
                info.segmentId
                  ? { borderLeftColor: `hsl(${hue.get(info.segmentId) ?? 0} 60% 55%)` }
                  : undefined
              }
              onClick={() =>
                clickable && src?.type === 'repo' && navigate(src.path, info.sourceLine!)
              }
              title={clickable && src ? `${displayPath(src.path)}:${info.sourceLine}` : undefined}
            >
              <span className="ctx-gutter">
                {clickable && src ? `${src.path.split('/').pop()}:${info.sourceLine}` : ''}
              </span>
              <span className="ctx-text">{text || ' '}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
