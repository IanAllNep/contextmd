import { useEffect } from 'react';
import { diffLines } from '../lib/diff';
import { displayPath } from '../lib/format';
import { closeTab, keepMine, reloadFromDisk, saveFile, useStore } from '../store';

function Dialog({
  title,
  children,
  actions,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  actions: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useStore.setState({ modal: null });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="overlay center">
      <div className={`dialog ${wide ? 'wide' : ''}`} role="alertdialog" aria-label={title}>
        <h3>{title}</h3>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}

function Compare({ path, disk }: { path: string; disk: string | null }) {
  const mine = useStore((s) => s.buffers[path]?.content ?? '');
  const ops = diffLines(disk ?? '', mine);
  return (
    <div className="diff">
      <div className="diff-legend">
        <span className="del">− on disk</span> <span className="add">+ your edits</span>
      </div>
      <pre>
        {ops.map((op, i) => (
          <div key={i} className={`diff-line ${op.type}`}>
            <span className="diff-sign">
              {op.type === 'add' ? '+' : op.type === 'del' ? '−' : ' '}
            </span>
            {op.text || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}

export function Modals() {
  const modal = useStore((s) => s.modal);
  const buffers = useStore((s) => s.buffers);
  if (!modal) return null;
  const cancel = () => useStore.setState({ modal: null });

  if (modal.type === 'confirm-close') {
    return (
      <Dialog
        title="Unsaved changes"
        actions={
          <>
            <button className="btn" onClick={cancel}>
              Cancel
            </button>
            <button className="btn danger" onClick={() => closeTab(modal.path, true)}>
              Discard changes
            </button>
            <button
              className="btn primary"
              autoFocus
              onClick={async () => {
                await saveFile(modal.path);
                const b = useStore.getState().buffers[modal.path];
                if (b && b.content === b.savedContent) closeTab(modal.path, true);
              }}
            >
              Save and close
            </button>
          </>
        }
      >
        <p>{displayPath(modal.path)} has unsaved changes.</p>
      </Dialog>
    );
  }

  if (modal.type === 'save-conflict') {
    return (
      <Dialog
        wide
        title="The file changed on disk"
        actions={
          <>
            <button className="btn" onClick={() => keepMine(modal.path)}>
              Cancel (keep editing)
            </button>
            <button className="btn" onClick={() => void reloadFromDisk(modal.path)}>
              Discard mine, load disk version
            </button>
            <button className="btn danger" onClick={() => void saveFile(modal.path, true)}>
              Overwrite disk with my version
            </button>
          </>
        }
      >
        <p>
          {modal.diskContent === null
            ? `${displayPath(modal.path)} no longer exists on disk.`
            : `${displayPath(modal.path)} was modified by another program after you opened it. Nothing was saved.`}
        </p>
        <Compare path={modal.path} disk={modal.diskContent} />
      </Dialog>
    );
  }

  const b = buffers[modal.path];
  return (
    <Dialog
      wide
      title={`Compare: ${displayPath(modal.path)}`}
      actions={
        <button className="btn primary" onClick={cancel}>
          Close
        </button>
      }
    >
      <Compare path={modal.path} disk={b?.diskContent ?? null} />
    </Dialog>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
