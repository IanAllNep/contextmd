import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { api } from '../api';

/**
 * xterm.js instances live outside React so terminals keep their scrollback and state while
 * tabs switch or the panel is hidden. Output that arrives before a terminal is shown is
 * written to its buffer and appears when it is attached.
 */
interface Entry {
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  opened: boolean;
}

const entries = new Map<number, Entry>();
let inputListener: ((id: number) => void) | null = null;

export function onTerminalInput(fn: (id: number) => void): void {
  inputListener = fn;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function terminalTheme(): ITheme {
  return {
    background: cssVar('--bg'),
    foreground: cssVar('--text'),
    cursor: cssVar('--accent'),
    cursorAccent: cssVar('--bg'),
    selectionBackground: cssVar('--selection'),
  };
}

function entry(id: number): Entry {
  let e = entries.get(id);
  if (e) return e;
  const term = new Terminal({
    fontFamily: cssVar('--font-mono') || 'monospace',
    fontSize: 12.5,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 5000,
    theme: terminalTheme(),
    allowProposedApi: false,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.onData((data) => {
    api().terminalInput(id, data);
    inputListener?.(id);
  });
  term.onResize(({ cols, rows }) => api().terminalResize(id, cols, rows));
  const host = document.createElement('div');
  host.className = 'xterm-host';
  host.dataset['terminalId'] = String(id);
  e = { term, fit, host, opened: false };
  entries.set(id, e);
  return e;
}

export function writeTerminal(id: number, data: string): void {
  entry(id).term.write(data);
}

/** Shows terminal `id` inside `container`, fits it to the available space and focuses it. */
export function attachTerminal(id: number, container: HTMLElement): void {
  const e = entry(id);
  if (e.host.parentElement !== container) container.replaceChildren(e.host);
  if (!e.opened) {
    e.term.open(e.host);
    e.opened = true;
  }
  fitTerminal(id);
  e.term.focus();
}

export function fitTerminal(id: number): void {
  const e = entries.get(id);
  if (!e?.opened || e.host.clientWidth === 0) return;
  try {
    e.fit.fit();
  } catch {
    /* not measurable while hidden */
  }
}

export function disposeTerminal(id: number): void {
  entries.get(id)?.term.dispose();
  entries.delete(id);
}

export function disposeAllTerminals(): void {
  for (const id of [...entries.keys()]) disposeTerminal(id);
}

export function applyTerminalTheme(): void {
  const theme = terminalTheme();
  for (const e of entries.values()) e.term.options.theme = theme;
}
