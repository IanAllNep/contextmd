# Progress

Last updated: 2026-09-29 (initial session).

# Implemented

- Monorepo (npm workspaces): `packages/core`, `packages/cli`, `apps/desktop`; TS 6 strict,
  ESLint 10 flat config, Prettier, Vitest 4. `npm run check` runs everything.
- **Core**
  - `FileSystem` abstraction + Node implementation; repo-relative path utilities.
  - Scanner: built-in ignored dirs + nested `.gitignore`; records all directories; symlinked
    Markdown files inside the repo are included (with `symlinkTarget`), escaping links and
    symlinked dirs are not followed; records `.git`/`.hg`/`.sl` markers; entry cap for huge trees.
  - Declarative classification registry (`RECOGNIZED_PATTERNS`).
  - remark/mdast parser: headings (+slugs, lines), links (inline, reference, autolinks,
    resolved targets), code blocks, frontmatter (YAML with error capture), `@references` outside
    code, block-level HTML comments, stats, token estimate.
  - `RepositoryIndex`: parse pool, summaries, backlinks (extensionless/dir-README resolution),
    broken links, line search with section/snippet, incremental `applyChanges` (rescan on
    `.gitignore` change), `readRepoFile` with realpath containment.
  - Context model with provenance: segments (scope, timing, status, reason, `via`, warnings,
    line map), `renderContext` with a line-level source map, Markdown/plain/JSON export.
  - Adapters: Generic (heuristic), Claude Code (documented), Codex CLI (documented).
  - Diagnostics: duplicate statements; experimental polarity/word-overlap conflict hints.
- **CLI**: `contextmd scan | context | search`.
- **Desktop** (Electron 44 + React 19 + CodeMirror 6 + Zustand)
  - Secure window (sandbox, contextIsolation, CSP, no navigation, no reload menu item),
    single allowlisted IPC channel, path validation in main.
  - Workspace: chokidar watcher (debounced, serialized incremental updates), sha256-based
    conflict-safe saves, recent repositories.
  - UI: file tree (agent files highlighted, dirs with instructions marked, filter,
    agent-only toggle, "inspect context" per directory), tabs (same-name disambiguation),
    editor / split / preview, disk-change banners, save-conflict dialog with diff, search
    panel, command palette (commands / files / directories), document inspector (outline,
    metadata, links, backlinks), context inspector (harness, options, launch dir, working
    file, token bar, loaded / on-demand / not-loaded / outside-repo groups, diagnostics,
    notes, copy), full effective-context view with click-to-source, status bar, dark/light.
- Tests: 58 unit/integration tests (core + workspace). `npm run smoke`: 17 end-to-end checks
  of the built app via Playwright.

# In progress

- Nothing half-finished.

# Next

1. Opt-in reading of user-level sources (`~/.claude/CLAUDE.md`, `~/.claude/rules`,
   `~/.codex/AGENTS.md`) with an explicit allowlist in main.
2. Git integration: effective-context diff between branches/commits.
3. Packaging (electron-builder) + CI (GitHub Actions running `npm run check` + smoke on xvfb).
4. Gemini CLI adapter once semantics are settled (see `docs/harness-semantics.md`).
5. Real tokenizers behind `TokenEstimator` (per-model), budget warnings.
6. Graph view for links/imports; stale references (paths/commands mentioned in instructions
   that don't exist).

# Important architecture decisions

- Electron over Tauri: one TypeScript core shared by desktop, CLI and tests; no Rust toolchain
  for contributors (ADR 0001).
- All analysis in `@contextmd/core` (no UI/Electron imports); renderer imports only types.
- Paths are repo-relative everywhere; main validates every renderer path.
- Resolved context = ordered segments with provenance + status. Files that are _not_ loaded are
  first-class (with reasons), because "why isn't my instruction applied?" is the question.
- Adapters declare `fidelity` (`heuristic` | `documented`) + references; uncertainty goes into
  `notes`.
- Target = `{ cwd, file? }`: launch directory plus optional working file (drives on-demand
  loading for Claude Code).
- Saves are compare-and-swap on content hash. External changes are reconciled by hash, so our
  own saves never look like conflicts.

# Known limitations

- Token counts are a chars/4 estimate.
- Sources outside the opened folder (user/global/policy files, parent directories) are listed
  but not read.
- Claude Code: import placement and rule ordering are inferred (see notes in the UI);
  `claudeMdExcludes`, auto memory and skills are not modelled.
- Codex: project root detection only sees `.git` inside the opened folder; `project_root_markers`
  is not configurable yet.
- Conflict detection is a heuristic (word overlap + negation); it will miss paraphrased
  conflicts and can flag false positives. It can be switched off.
- Search is line-based substring/regex over indexed Markdown only (no fuzzy/semantic search).
- The document inspector shows the last _saved_ version's outline/links while a buffer is dirty.
- No packaging/installers yet; run from source.
- Renderer bundle is ~2 MB (CodeMirror Markdown pulls HTML/CSS/JS parsers); not optimized.
- Preview does not render images (placeholders) or raw HTML, by design.
