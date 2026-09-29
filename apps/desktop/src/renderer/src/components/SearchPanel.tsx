import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { SearchMatch } from '@contextmd/core';
import { baseName, dirOf } from '../lib/format';
import { openFile, runSearch, useStore } from '../store';
import { Icon } from './Icon';

export function SearchPanel() {
  const query = useStore((s) => s.searchQuery);
  const caseSensitive = useStore((s) => s.searchCase);
  const regex = useStore((s) => s.searchRegex);
  const agentOnly = useStore((s) => s.searchAgentOnly);
  const result = useStore((s) => s.searchResult);
  const focusNonce = useStore((s) => s.searchFocusNonce);
  const version = useStore((s) => s.snapshot?.version);
  const input = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusNonce]);

  // Debounced search; re-run when the index changes so results stay fresh.
  useEffect(() => {
    const t = setTimeout(() => void runSearch(), 120);
    return () => clearTimeout(t);
  }, [query, caseSensitive, regex, agentOnly, version]);

  const groups = useMemo(() => {
    const map = new Map<string, SearchMatch[]>();
    for (const m of result?.matches ?? []) {
      const list = map.get(m.path);
      if (list) list.push(m);
      else map.set(m.path, [m]);
    }
    return [...map.entries()];
  }, [result]);
  const flat = useMemo(() => groups.flatMap(([, ms]) => ms), [groups]);
  useEffect(() => setCursor(0), [result]);

  const open = (m: SearchMatch) => void openFile(m.path, m.line);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' && flat[cursor]) {
      e.preventDefault();
      open(flat[cursor]);
    }
  };

  const set = useStore.setState;
  let i = -1;
  return (
    <div className="search-panel" onKeyDown={onKeyDown}>
      <div className="panel-toolbar">
        <input
          ref={input}
          className="input"
          placeholder="Search Markdown…"
          value={query}
          onChange={(e) => set({ searchQuery: e.target.value })}
          spellCheck={false}
        />
      </div>
      <div className="search-options">
        <button
          className={`toggle text ${caseSensitive ? 'on' : ''}`}
          onClick={() => set({ searchCase: !caseSensitive })}
          title="Match case"
        >
          Aa
        </button>
        <button
          className={`toggle text ${regex ? 'on' : ''}`}
          onClick={() => set({ searchRegex: !regex })}
          title="Regular expression"
        >
          .*
        </button>
        <button
          className={`toggle ${agentOnly ? 'on' : ''}`}
          onClick={() => set({ searchAgentOnly: !agentOnly })}
          title="Only agent-facing files"
        >
          <Icon name="agent" size={14} />
        </button>
        <span className="search-summary">
          {result?.error ? (
            <span className="error-text">{result.error}</span>
          ) : result ? (
            `${result.matches.length}${result.truncated ? '+' : ''} in ${result.fileCount} files · ${result.elapsedMs} ms`
          ) : (
            ''
          )}
        </span>
      </div>
      <div className="search-results">
        {groups.map(([path, matches]) => (
          <Fragment key={path}>
            <div className="result-file" title={`/${path}`} onClick={() => void openFile(path)}>
              <Icon name="file" size={13} />
              <span className="row-name">{baseName(path)}</span>
              <span className="row-dir">{dirOf(path)}</span>
              <span className="count">{matches.length}</span>
            </div>
            {matches.map((m) => {
              i++;
              const idx = i;
              return (
                <div
                  key={`${m.line}:${m.column}`}
                  className={`result-line ${idx === cursor ? 'cursor' : ''}`}
                  onClick={() => {
                    setCursor(idx);
                    open(m);
                  }}
                >
                  <span className="line-no">{m.line}</span>
                  <span className="snippet">
                    {m.snippet.slice(0, m.matchStart)}
                    <mark>{m.snippet.slice(m.matchStart, m.matchEnd)}</mark>
                    {m.snippet.slice(m.matchEnd)}
                  </span>
                  {m.section && (
                    <span className="section" title={m.section}>
                      § {m.section}
                    </span>
                  )}
                </div>
              );
            })}
          </Fragment>
        ))}
        {result && result.matches.length === 0 && !result.error && (
          <div className="empty-inline">No matches.</div>
        )}
        {!result && (
          <div className="empty-inline muted">
            Search every Markdown file in the repository. ↑↓ to move, Enter to open.
          </div>
        )}
      </div>
    </div>
  );
}
