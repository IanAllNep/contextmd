import { useEffect, useMemo, useRef, useState } from 'react';
import { getCommands } from '../commands';
import { fuzzyScore } from '../lib/fuzzy';
import { baseName, dirOf, displayPath } from '../lib/format';
import { openFile, selectDirectory, useStore } from '../store';

interface Item {
  key: string;
  title: string;
  detail?: string;
  hint?: string;
  run: () => void;
}

const MAX_ITEMS = 200;

export function CommandPalette() {
  const mode = useStore((s) => s.palette);
  const snapshot = useStore((s) => s.snapshot);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery('');
    setCursor(0);
    input.current?.focus();
  }, [mode]);

  const items = useMemo<Item[]>(() => {
    if (!mode) return [];
    let all: Item[];
    if (mode === 'commands') {
      all = getCommands().map((c) => ({ key: c.id, title: c.title, hint: c.shortcut, run: c.run }));
    } else if (mode === 'files') {
      all = (snapshot?.files ?? []).map((f) => ({
        key: f.path,
        title: f.name,
        detail: dirOf(f.path) || '/',
        hint: f.kind !== 'doc' ? (f.label ?? f.kind) : undefined,
        run: () => void openFile(f.path, undefined, { retarget: true }),
      }));
    } else {
      all = (snapshot?.directories ?? []).map((d) => ({
        key: d || '/',
        title: displayPath(d),
        run: () => selectDirectory(d),
      }));
    }
    if (query.trim() === '') return all.slice(0, MAX_ITEMS);
    const scored: { item: Item; score: number }[] = [];
    for (const item of all) {
      const hay = mode === 'files' ? item.key : item.title;
      const score = fuzzyScore(query, hay);
      if (score !== null)
        scored.push({
          item,
          score: score + (mode === 'files' ? (fuzzyScore(query, baseName(item.key)) ?? 0) : 0),
        });
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ITEMS)
      .map((s) => s.item);
  }, [mode, query, snapshot]);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    list.current?.querySelector('.palette-item.cursor')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!mode) return null;
  const close = () => useStore.setState({ palette: null });
  const run = (item: Item | undefined) => {
    if (!item) return;
    close();
    item.run();
  };
  const placeholder =
    mode === 'commands'
      ? 'Type a command…'
      : mode === 'files'
        ? 'Go to file…'
        : 'Choose the launch directory for effective context…';

  return (
    <div className="overlay" onMouseDown={close}>
      <div
        className="palette"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <input
          ref={input}
          className="palette-input"
          placeholder={placeholder}
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(items[cursor]);
            }
          }}
        />
        <div className="palette-list" ref={list} role="listbox">
          {items.length === 0 && <div className="empty-inline muted">No matches</div>}
          {items.map((item, i) => (
            <div
              key={item.key}
              role="option"
              aria-selected={i === cursor}
              className={`palette-item ${i === cursor ? 'cursor' : ''}`}
              onMouseMove={() => setCursor(i)}
              onClick={() => run(item)}
            >
              <span className="palette-title">{item.title}</span>
              {item.detail && <span className="palette-detail">{item.detail}</span>}
              {item.hint && <span className="palette-hint">{item.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
