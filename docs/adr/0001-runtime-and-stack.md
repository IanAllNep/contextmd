# ADR 0001 — Runtime and stack

- Status: accepted
- Date: 2026-09-29

## Context

ContextMD (working name) must read, index, watch and write files in an arbitrary local
repository, render untrusted Markdown safely, feel like an IDE, and stay approachable for
open-source contributors. The core analysis (scanning, parsing, context resolution,
diagnostics) must be reusable outside the desktop shell (CLI, CI, a future editor
extension).

## Options considered

| Option                | Filesystem + watching                                                                                                                                                                                | Size / startup                       | Contributor friction                                           | Verdict                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------- | ------------------------------- |
| **Tauri + React**     | Via Rust commands or Tauri fs/watch plugins. TS core can't use Node `fs`, so scanning/watching either moves to Rust (splitting core logic across two languages) or goes through plugin IPC per call. | Excellent (~10 MB, fast)             | Requires a Rust toolchain + per-OS WebView quirks (WebKitGTK). | Strong, but splits the core.    |
| **Electron + React**  | Full Node `fs`, mature watchers (chokidar), same TS core runs in main process, tests and CLI.                                                                                                        | Heavy (~100 MB+), startup acceptable | Only Node/npm required. Largest contributor pool.              | **Chosen.**                     |
| **Local web app**     | Needs a local server with fs access; browser sandbox gets in the way of "open folder"; a localhost server that can write files is a real attack surface (DNS rebinding, CSRF).                       | Light                                | Easy                                                           | Rejected for v0.1.              |
| **VS Code extension** | Excellent fs/watch APIs, huge distribution.                                                                                                                                                          | n/a                                  | Easy for VS Code users only                                    | Future target, not the primary. |

## Decision

**Electron + Vite (electron-vite) + React + TypeScript**, with all analysis in a
UI-independent package `@contextmd/core`.

Deciding factors:

1. **One language for the core.** The scanner, parser, index, resolver and adapters are pure
   TypeScript and run unchanged in the Electron main process, in Vitest, and in a CLI.
   With Tauri we would either duplicate the scanner/watcher in Rust or pay IPC per file
   operation.
2. **Contributor friendliness.** `npm install && npm run dev` is the whole setup. No Rust,
   no system WebView dependencies.
3. **Filesystem watching** is a solved problem in Node (chokidar → FSEvents/inotify/
   ReadDirectoryChangesW).
4. **Security can be made strict**: `contextIsolation`, `sandbox`, no `nodeIntegration`, a
   narrow typed preload bridge, CSP, and main-process path validation. The renderer never
   touches the filesystem directly.

Accepted costs: bundle size and memory are larger than Tauri. The core is deliberately
kept free of Electron imports so a Tauri shell (with a Node sidecar) or a VS Code
extension remains possible later — the `FileSystem` abstraction in core exists for this.

## Other choices

- **Markdown parsing:** `unified` + `remark-parse` (mdast) + `remark-gfm` +
  `remark-frontmatter`, `yaml` for frontmatter. Real AST with source positions — needed for
  headings, links, code blocks and line-level provenance.
- **Rendering:** `react-markdown` + `remark-gfm` **without** `rehype-raw`: raw HTML in
  Markdown is never rendered (HTML nodes are dropped). Remote images are blocked by CSP.
- **Editor:** CodeMirror 6 (small, modular, good Markdown mode, easy to embed) instead of
  Monaco (large, heavier to bundle in Electron, IDE-scale features we don't need yet).
- **State management:** Zustand — tiny, no boilerplate, works well with IPC-driven
  updates.
- **Ignore rules:** built-in ignored directory list + `.gitignore` files (root and nested)
  via the `ignore` package.
- **Token counts:** a pluggable `TokenEstimator`; default is a documented heuristic
  (~4 chars/token), always labelled as an estimate in the UI.
- **Monorepo:** npm workspaces (no extra package manager). Three packages:
  `packages/core`, `packages/cli`, `apps/desktop`. We did _not_ split `markdown`,
  `harnesses`, `ui` into separate packages: they are modules inside core/desktop until
  there is a consumer that needs them separately.
- **Tests:** Vitest for core; a Playwright (`playwright-core` + Electron) smoke script
  for the desktop app.
- **License:** MIT.
