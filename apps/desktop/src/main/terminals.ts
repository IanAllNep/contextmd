import { spawn, type IPty } from 'node-pty';

export interface TerminalInfo {
  id: number;
  title: string;
  /** Repo-relative working directory. */
  cwd: string;
  /** Command typed (not run) into the prompt, if any. */
  prefill?: string;
}

export type TerminalEvent =
  | { type: 'terminal-data'; id: number; data: string }
  | { type: 'terminal-exit'; id: number; exitCode: number };

const FLUSH_MS = 8;

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32')
    return { file: process.env['COMSPEC'] ?? 'powershell.exe', args: [] };
  const file = process.env['SHELL'] || '/bin/bash';
  // GUI apps on macOS get a minimal PATH; a login shell picks up the user's profile.
  return { file, args: process.platform === 'darwin' ? ['-l'] : [] };
}

/**
 * Interactive shells for the embedded terminal. Terminals are only ever created by an
 * explicit user action; ContextMD never runs commands on its own. A `prefill` command is
 * typed at the prompt but not executed: the user presses Enter.
 */
export class TerminalManager {
  private terms = new Map<number, IPty>();
  private buffers = new Map<number, string>();
  private timer: NodeJS.Timeout | null = null;
  private nextId = 1;

  constructor(private readonly emit: (e: TerminalEvent) => void) {}

  create(
    absCwd: string,
    relCwd: string,
    opts: { cols: number; rows: number; prefill?: string },
  ): TerminalInfo {
    const { file, args } = defaultShell();
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env))
      if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
    Object.assign(env, {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'ContextMD',
    });
    const id = this.nextId++;
    const p = spawn(file, args, {
      name: 'xterm-256color',
      cols: clamp(opts.cols, 2, 1000, 80),
      rows: clamp(opts.rows, 2, 500, 24),
      cwd: absCwd,
      env,
    });
    this.terms.set(id, p);
    let prefill = opts.prefill;
    p.onData((data) => {
      this.queue(id, data);
      // Type the command once the shell has printed its first output (the prompt).
      if (prefill) {
        const cmd = prefill;
        prefill = undefined;
        setTimeout(() => this.terms.get(id)?.write(cmd), 50);
      }
    });
    p.onExit(({ exitCode }) => {
      this.flush();
      this.terms.delete(id);
      this.emit({ type: 'terminal-exit', id, exitCode });
    });
    const shellName = file.split(/[\\/]/).pop() ?? 'shell';
    const info: TerminalInfo = {
      id,
      title: opts.prefill ? opts.prefill.split(' ')[0]! : shellName,
      cwd: relCwd,
    };
    if (opts.prefill) info.prefill = opts.prefill;
    return info;
  }

  write(id: number, data: string): void {
    this.terms.get(id)?.write(data);
  }

  resize(id: number, cols: number, rows: number): void {
    try {
      this.terms.get(id)?.resize(clamp(cols, 2, 1000, 80), clamp(rows, 2, 500, 24));
    } catch {
      /* the process may have exited */
    }
  }

  kill(id: number): void {
    this.terms.get(id)?.kill();
  }

  killAll(): void {
    for (const p of this.terms.values()) p.kill();
    this.terms.clear();
  }

  get count(): number {
    return this.terms.size;
  }

  /** Coalesce output chunks to limit IPC traffic. */
  private queue(id: number, data: string): void {
    this.buffers.set(id, (this.buffers.get(id) ?? '') + data);
    this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }

  private flush(): void {
    this.timer = null;
    for (const [id, data] of this.buffers) this.emit({ type: 'terminal-data', id, data });
    this.buffers.clear();
  }
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n)
    ? Math.max(min, Math.min(max, Math.floor(n)))
    : fallback;
}
