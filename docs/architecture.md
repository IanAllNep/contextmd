# Architecture

ContextMD treats Markdown instruction files as **source code for agent behavior**. The
architecture is a pipeline in which every stage preserves _where things came from_.

```text
filesystem ──► scanner ──► markdown parser ──► repository index ──► harness adapter ──► resolved context ──► UI
   (FileSystem)  (ignore rules,   (mdast: headings,     (docs, backlinks,     (Generic, Claude    (segments +
                  classification)  links, code, fm)      search, dirs)         Code, Codex …)      source map)
```

See [ADR 0001](adr/0001-runtime-and-stack.md) for why Electron + React + TypeScript.

## Layout

```text
packages/core        UI-independent analysis library (no Electron imports)
  src/fs/            FileSystem interface + Node implementation
  src/scan/          repository scanner, ignore rules, instruction-file classification
  src/markdown/      parsing (remark/mdast) → MarkdownDocument
  src/tokens/        TokenEstimator interface + heuristic estimator
  src/index/         RepositoryIndex: documents, directories, link graph, search, incremental updates
  src/harness/       HarnessAdapter interface + adapters (generic, claude-code, codex)
  src/context/       ResolvedContext model, rendering/export, source maps
  src/diagnostics/   Diagnostic/Conflict model + deterministic detectors
packages/cli         `contextmd` CLI (scan / context / search) on top of core
apps/desktop         Electron app
  src/main/          main process: owns the RepositoryIndex, watcher, file IO, IPC handlers
  src/preload/       typed, minimal bridge exposed as window.contextmd
  src/renderer/      React UI (Zustand store, components)
examples/            fixture repositories used by tests and development
```

## Runtime (Electron)

- **Main process** owns everything that touches disk: opening a repository, scanning,
  parsing, the in-memory `RepositoryIndex`, file watching (chokidar), reads and writes.
- **Renderer** is a sandboxed React app. It holds a lightweight snapshot (file list +
  metadata) and requests document content / context resolutions over IPC.
- **Preload** exposes a single typed API object (`window.contextmd`). The contract lives in
  `apps/desktop/src/shared/api.ts` and is the only coupling between UI and main. Calls go
  over one `invoke` channel whose method names are allowlisted in main; events (`indexing`,
  `index-changed`, `files-changed`, `watch-error`) are pushed on one event channel.

All renderer-supplied paths are **repository-relative** and validated in main (`resolveInside`)
so the renderer cannot read or write outside the opened repository.

## Filesystem strategy

- `FileSystem` interface in core (`readFile`, `readDir`, `stat`). Node implementation for
  desktop/CLI; tests use real temp directories.
- Scanner walks the tree once, skipping a built-in ignore list (`.git`, `node_modules`,
  `dist`, `build`, `.next`, `target`, `vendor`, …) and honouring `.gitignore` files (root and
  nested). It records **all** non-ignored directories (so any directory can be a context
  target) but only reads Markdown files (`.md`, `.markdown`, `.mdx`, `.mdc`).
- Files above a size cap (default 2 MB) are listed but not parsed.

## File watching and data safety

- chokidar watches the repository with the same ignore predicate as the scanner.
- Events are debounced (~75 ms) and applied **incrementally** to the index
  (`index.applyChanges`): only changed files are re-parsed; the link graph is rebuilt from
  cached per-document links (cheap). A `.gitignore` change triggers a full rescan.
- Every read returns a **content hash** (sha256) and mtime. Saving sends the hash the
  editor's buffer was based on; main re-reads the file and **refuses to write** if the disk
  content no longer matches (`conflict` result). The UI then offers _reload from disk_,
  _overwrite_ (explicit), or _keep editing_. Our own saves are recognised by hash, so they
  never look like external changes.
- External change to an open file: clean buffer → silently reload; dirty buffer → banner,
  never overwrite either side automatically. External delete of an open file keeps the
  buffer and marks it as deleted.

## Markdown parsing

`parseMarkdown(path, content)` → `MarkdownDocument`:

- `headings` (depth, text, slug, line), `links` (href, text, line, resolved target path,
  kind: markdown/external/anchor), `codeBlocks` (lang, line range), `frontmatter` (parsed
  YAML + error), `stats` (words, chars, lines), `tokens` (estimate).
- Built on remark's mdast with positions; no regex parsing of structure.
- `@path` import references (Claude Code syntax) are extracted as a separate structure by
  the Claude adapter from the AST text nodes, ignoring code spans/blocks.

## Repository index

`RepositoryIndex` (core) is the query surface for everything else:

- `files()` / `get(path)` — documents with metadata and classification
- `directories()` — all non-ignored directories
- `backlinks(path)` / `outgoingLinks(path)` — from the link graph
- `search(query, opts)` — line-based search over cached content, returns file, line,
  column, snippet and enclosing heading. In-memory scan; fast for hundreds of documents.
- `applyChanges(events)` — incremental updates; returns a change summary

The index is pure data + functions; it knows nothing about Electron.

## Instruction-file classification

`scan/classify.ts` holds a declarative list of **recognized patterns** (`AGENTS.md`,
`CLAUDE.md`, `CLAUDE.local.md`, `GEMINI.md`, `AGENTS.override.md`,
`.github/copilot-instructions.md`, `.claude/skills/*/SKILL.md`, `.claude/commands/*.md`,
`.claude/agents/*.md`, `.claude/rules/**/*.md`, `.cursor/rules/*.mdc`, `README.md`,
`CONTRIBUTING.md`, …). Each pattern has a `kind` (`instructions`, `skill`, `command`,
`subagent`, `rule`, `project-doc`) and a list of harness hints. Adding a pattern is a one-line
change.

## Context resolution and provenance

```ts
interface HarnessAdapter {
  id: string;
  name: string;
  description: string;
  fidelity: 'heuristic' | 'documented'; // Generic = heuristic; others cite docs
  references: string[]; // documentation URLs the semantics follow
  detect(index): DetectionResult;
  resolve(index, target, options): Promise<ResolvedContext>;
}
```

A `ResolvedContext` is an ordered list of **segments**. Each segment carries:

- `source` — repo-relative path (or an external/unread placeholder)
- `scope` — `policy | user | project | directory | imported | target | rule`
- `reason` — human-readable rule that included it (“ancestor of target”, “imported by
  CLAUDE.md:12”, …) and `via` (the including segment, for imports)
- `content`, `tokens` (estimate)
- `status` — `included | truncated | skipped` (+ explanation), so adapters can show files that
  exist but _won't_ be loaded and why.

`renderContext(resolved, format)` produces Markdown/plaintext with source boundaries and a
**line-level source map** (`output line → source path + source line`). The UI uses it to jump
from any line of the effective context back to its origin.

Adapters implemented in v0.1:

- **Generic** (heuristic, not any vendor's behavior): recognized instruction files in each
  ancestor directory from repo root → target, then the target document itself.
- **Claude Code** and **Codex**: follow the vendors' documented discovery rules (see each
  adapter's `references`). Anything outside the repository (user/global files) is shown as an
  _unread external source_ rather than read silently.

## Diagnostics / conflicts

`Diagnostic { id, kind, severity, message, explanation, rule, heuristic, sources }` where
`kind ∈ duplicate | conflict | broken-link | size`. v0.1 detectors are deterministic:

- **duplicate** (`analyzeContext`): identical normalized instruction lines across sources in
  one resolved context.
- **broken links** (`RepositoryIndex.brokenLinks`): relative links to Markdown files that
  don't exist. Shown in the document inspector and preview.
- **conflict (experimental)**: a conservative polarity heuristic. It flags a “never/don't”
  statement and an affirmative statement from different sources that share most of their
  content words. It is labelled _heuristic_ in the UI and gated by a toggle (on by default).
- `size` is reserved for budget warnings (not implemented).

No LLM is used anywhere.

## State management (renderer)

A single Zustand store: repository snapshot, open tabs/buffers (content, base hash, dirty,
disk state), view mode, context target and adapter, search state. IPC events
(`index:changed`, `file:changed`) are reduced into the store.

## Security

- Opening a repository never executes anything from it. No scripts, hooks, MCP servers or
  commands from Markdown are run.
- Renderer: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP
  (`default-src 'self'`, no remote images/scripts), navigation and `window.open` blocked;
  external `http(s)` links open in the system browser only on click.
- Raw HTML inside Markdown is never rendered (dropped by react-markdown without rehype-raw).
- Main validates every path against the repository root (after `realpath`) — symlinks that
  escape the repo are not followed.
