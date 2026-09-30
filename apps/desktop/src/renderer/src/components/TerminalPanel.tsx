import { useEffect, useRef } from 'react';
import { displayPath } from '../lib/format';
import { attachTerminal, fitTerminal } from '../lib/terminals';
import { killTerminal, newTerminal, useStore } from '../store';
import { Icon } from './Icon';

function HeightResizer() {
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const start =
      parseInt(getComputedStyle(document.documentElement).getPropertyValue('--terminal-h'), 10) ||
      280;
    const move = (ev: MouseEvent) => {
      const h = Math.max(120, Math.min(window.innerHeight - 200, start + startY - ev.clientY));
      document.documentElement.style.setProperty('--terminal-h', `${h}px`);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return <div className="terminal-resizer" onMouseDown={onMouseDown} />;
}

/**
 * Embedded terminals. A shell only ever starts from an explicit user action, in a directory
 * inside the opened repository. "Start agent" types the command but never presses Enter.
 */
export function TerminalPanel() {
  const terminals = useStore((s) => s.terminals);
  const active = useStore((s) => s.activeTerminal);
  const open = useStore((s) => s.terminalOpen);
  const container = useRef<HTMLDivElement>(null);
  const current = terminals.find((t) => t.id === active) ?? null;

  useEffect(() => {
    if (open && active !== null && container.current) attachTerminal(active, container.current);
  }, [open, active]);

  useEffect(() => {
    if (!container.current || active === null) return;
    const ro = new ResizeObserver(() => fitTerminal(active));
    ro.observe(container.current);
    return () => ro.disconnect();
  }, [active, open]);

  if (!open || terminals.length === 0) return null;
  return (
    <section className="terminal-panel" aria-label="Terminal">
      <HeightResizer />
      <div className="terminal-header">
        <div className="terminal-tabs" role="tablist">
          {terminals.map((t) => (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === active}
              className={`terminal-tab ${t.id === active ? 'active' : ''} ${t.exitCode !== null ? 'exited' : ''}`}
              onClick={() => useStore.setState({ activeTerminal: t.id })}
              title={`${t.title} in ${displayPath(t.cwd)}`}
            >
              <span>{t.title}</span>
              <span className="terminal-cwd">{displayPath(t.cwd)}</span>
              <button
                className="tab-close"
                title="Kill terminal"
                onClick={(e) => {
                  e.stopPropagation();
                  killTerminal(t.id);
                }}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          ))}
        </div>
        {current?.prefill && !current.typed && current.exitCode === null && (
          <span className="terminal-hint">
            <code>{current.prefill}</code> is typed at the prompt. Press Enter in the terminal to
            run it.
          </span>
        )}
        <span className="spacer" />
        <button
          className="icon-btn"
          title="New terminal in the launch directory"
          onClick={() => void newTerminal()}
        >
          +
        </button>
        <button
          className="icon-btn"
          title="Hide terminal (Ctrl+`)"
          onClick={() => useStore.setState({ terminalOpen: false })}
        >
          <Icon name="chevronDown" size={13} />
        </button>
      </div>
      <div className="terminal-body" ref={container} />
    </section>
  );
}
