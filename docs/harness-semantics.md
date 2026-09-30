# Harness semantics

Each **documented** adapter follows a vendor's published documentation. This file records what
was checked, when, and what remains uncertain. Update it when you change an adapter.

A result from an adapter is only as good as this file. Anything not documented is surfaced in
the UI as a **note** on the resolved context instead of being guessed silently.

## Generic (heuristic)

ContextMD's own tool-neutral model. **Not** any vendor's behavior.

- From repository root to the target directory: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` in each
  directory, in that order.
- If the target is a Markdown file, it is appended as the target document.
- Symlinked duplicates (e.g. `CLAUDE.md → AGENTS.md`) are loaded once.

## Claude Code (documented, checked 2026-09-29)

Source: <https://code.claude.com/docs/en/memory>

| Behavior                                                                                                                                                                                                           | Status                  | Implementation                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Managed policy → user (`~/.claude/CLAUDE.md`) → project → local order                                                                                                                                              | documented              | external sources shown as _not read_                                                                                                                        |
| `CLAUDE.md` and `CLAUDE.local.md` loaded from the working directory and every directory above it, ordered root → cwd                                                                                               | documented              | launch segments; directories above the opened folder aren't inspected (noted)                                                                               |
| `./CLAUDE.md` or `./.claude/CLAUDE.md`                                                                                                                                                                             | documented              | both loaded if both exist (order between them undocumented)                                                                                                 |
| `CLAUDE.local.md` appended after `CLAUDE.md` in each directory                                                                                                                                                     | documented              | ✓                                                                                                                                                           |
| Subdirectory `CLAUDE.md` files load when Claude reads files there                                                                                                                                                  | documented              | on-demand segments when a _working file_ is set; exactly which directories trigger is not fully specified. We load every directory between cwd and the file |
| `@path` imports: relative to the importing file, max **4 hops**, not in code spans/blocks, `~/` allowed, any file type                                                                                             | documented              | ✓; home and out-of-repo imports shown as _not read_                                                                                                         |
| Imports resolving outside the working directory need approval                                                                                                                                                      | documented              | warning on the segment                                                                                                                                      |
| Block-level HTML comments stripped before injection                                                                                                                                                                | documented              | ✓ (with line map)                                                                                                                                           |
| Files > 4 MiB skipped                                                                                                                                                                                              | documented              | ✓                                                                                                                                                           |
| `.claude/rules/**/*.md`: no `paths` → load at launch "with the same priority as `.claude/CLAUDE.md`"; `paths` globs → load when matching files are read; frontmatter removed; invalid YAML → treated as no `paths` | documented              | ✓; rules in _ancestor_ directories are assumed to behave like the project's (unverified)                                                                    |
| `AGENTS.md` read natively (v2.1.277+) only when no `CLAUDE.md`/`.claude/CLAUDE.md`/`CLAUDE.local.md` exists at or above cwd (default `claude-md-or-agents-md`)                                                     | documented              | ✓ plus the `claude-md-and-agents-md` and `claude-md` settings                                                                                               |
| Subdirectory `AGENTS.md` loads on demand when that directory has none of the three CLAUDE files                                                                                                                    | documented              | ✓                                                                                                                                                           |
| An `AGENTS.md` already loaded (import/symlink) isn't read twice                                                                                                                                                    | documented              | generalized: any file is loaded once                                                                                                                        |
| Where imported text is placed relative to the importing file                                                                                                                                                       | **uncertain**           | listed after the importer (noted)                                                                                                                           |
| Position of unconditional rules relative to `CLAUDE.local.md`                                                                                                                                                      | **uncertain**           | CLAUDE.md, .claude/CLAUDE.md, rules, CLAUDE.local.md, AGENTS.md                                                                                             |
| Skills / commands / subagents                                                                                                                                                                                      | documented as on-demand | not part of resolved context in v0.1                                                                                                                        |
| Auto memory (`~/.claude/projects/<project>/memory/MEMORY.md`, first 200 lines / 25 KB)                                                                                                                             | documented              | **not modelled** (outside the repo)                                                                                                                         |
| `claudeMdExcludes` setting                                                                                                                                                                                         | documented              | **not modelled**                                                                                                                                            |

## OpenAI Codex CLI (documented, checked 2026-09-29)

Sources: <https://developers.openai.com/codex/guides/agents-md> (now redirects to
learn.chatgpt.com/docs/agent-configuration/agents-md) and the Codex advanced configuration /
config reference pages.

| Behavior                                                                                                                                         | Status                                              | Implementation                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------- |
| Global `$CODEX_HOME` (default `~/.codex`): `AGENTS.override.md`, else `AGENTS.md`                                                                | documented                                          | external source shown as _not read_                               |
| Project root = nearest ancestor containing `.git` (configurable `project_root_markers`)                                                          | documented                                          | uses `.git` markers found by the scanner inside the opened folder |
| No project root → only the working directory is checked                                                                                          | documented                                          | ✓ (with a note, since the folder may sit inside a larger repo)    |
| Walk root → cwd; per directory `AGENTS.override.md`, then `AGENTS.md`, then `project_doc_fallback_filenames`; **at most one file per directory** | documented                                          | ✓; losers shown as _skipped_ with the reason                      |
| Empty (whitespace-only) files skipped                                                                                                            | documented                                          | ✓                                                                 |
| Concatenated root → cwd, joined with blank lines                                                                                                 | documented                                          | ✓                                                                 |
| Combined budget `project_doc_max_bytes` (32 KiB default); the crossing file is truncated, later files dropped                                    | documented default; truncation behavior from source | ✓ (truncated/skipped segments)                                    |
| Projects that are not trusted skip project docs                                                                                                  | source                                              | noted                                                             |

## Terminal agents as declarative specs (documented, checked 2026-09-29)

These are built-in [harness specs](harness-specs.md) in
[`builtin-specs.ts`](../packages/core/src/harness/builtin-specs.ts). The `notes` in each spec
restate the open questions below, and the UI shows them with every resolution.

### Gemini CLI

Sources: `docs/cli/gemini-md.md`, `docs/reference/memport.md` and `docs/reference/configuration.md`
in [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli), plus
`packages/core/src/utils/memoryDiscovery.ts`.

| Behavior                                                                                                 | Status                                                                            | Spec                                           |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| Global `~/.gemini/GEMINI.md`                                                                             | documented                                                                        | `global`                                       |
| Upward walk from cwd stops at the first directory with `context.memoryBoundaryMarkers` (default `.git`)  | documented                                                                        | `root: {markers: [.git]}`, `root-to-cwd`       |
| All configured file names load in each directory (`context.fileName`, default `GEMINI.md`)               | source                                                                            | `perDirectory: all`, default name only (noted) |
| Just-in-time loading when a tool touches a file: that directory and its ancestors up to the trusted root | documented (current gemini-md.md)                                                 | `onDemand: true`                               |
| Downward startup scan (200 dirs)                                                                         | **stale**: still in configuration.md, absent from the current page and the source | not modelled                                   |
| `@file` imports, max depth 5, ignored in code                                                            | documented                                                                        | `imports: {maxDepth: 5}`                       |
| Behavior without a `.git`                                                                                | **uncertain** (docs vs source)                                                    | noted                                          |

### Amp

Source: <https://ampcode.com/docs/customize/agents-md>

| Behavior                                                                                     | Status     | Spec                                                                    |
| -------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| `AGENTS.md` in cwd and parents up to `$HOME`; subtree files when the agent reads files there | documented | `root-to-cwd`, `onDemand`                                               |
| Falls back to `AGENT.md` or `CLAUDE.md` if a directory has no `AGENTS.md`                    | documented | `perDirectory: first`; priority between the two fallbacks **uncertain** |
| Global `~/.config/amp/AGENTS.md`, `~/.config/AGENTS.md`, system paths                        | documented | `global`                                                                |
| `@` mentions relative to the file, ignored in code; `@~/` and absolute paths                 | documented | `imports` (depth undocumented → 5; globs not modelled)                  |
| `globs` frontmatter on mentioned files                                                       | documented | **not modelled** (noted)                                                |

### GitHub Copilot CLI

Source: <https://docs.github.com/en/copilot/how-tos/copilot-cli/add-custom-instructions>

| Behavior                                                                                                                        | Status                           | Spec                             |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------- |
| Repository root, cwd, directories between them, and directories on the path to the working file                                 | documented                       | `root-to-cwd`, `onDemand`        |
| `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`; all combined, duplicates removed | documented                       | `perDirectory: all`, `rootFiles` |
| `.github/instructions/**/*.instructions.md` with `applyTo`                                                                      | documented                       | `rules` (root only)              |
| Order between files                                                                                                             | documented as undefined          | ContextMD's order (noted)        |
| File references expanded in AGENTS.md / CLAUDE.md                                                                               | documented, syntax **uncertain** | not expanded (noted)             |
| Global `~/.copilot/…`, `COPILOT_HOME`, `COPILOT_CUSTOM_INSTRUCTIONS_DIRS`                                                       | documented                       | `global`                         |

### OpenCode

Source: <https://opencode.ai/docs/rules/>

| Behavior                                                                                               | Status        | Spec                                        |
| ------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------- |
| Local files found by traversing up from cwd: `AGENTS.md`, else `CLAUDE.md`; "first matching file wins" | documented    | `traversal: nearest`, `perDirectory: first` |
| Where the walk stops, and whether several ancestors combine                                            | **uncertain** | nearest only (noted)                        |
| Global `~/.config/opencode/AGENTS.md`, fallback `~/.claude/CLAUDE.md`                                  | documented    | `global`                                    |
| `instructions` in opencode.json (globs, URLs)                                                          | documented    | **not modelled** (noted)                    |

### Cursor CLI

Sources: <https://cursor.com/docs/cli/using>, <https://cursor.com/docs/context/rules>

| Behavior                                                                                                       | Status                                               | Spec                             |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------- |
| `AGENTS.md` and `CLAUDE.md` at the project root, alongside `.cursor/rules`                                     | documented                                           | `root-only`, `perDirectory: all` |
| `.mdc` rules: `alwaysApply`, `globs`, description-only (agent decides); plain `.md` in `.cursor/rules` ignored | documented                                           | `rules`                          |
| Nested `AGENTS.md`                                                                                             | documented for the editor; **uncertain** for the CLI | root only (noted)                |

### Aider

Sources: <https://aider.chat/docs/usage/conventions.html>, <https://aider.chat/docs/config/aider_conf.html>

| Behavior                                           | Status                  | Spec                                |
| -------------------------------------------------- | ----------------------- | ----------------------------------- |
| No instruction file is loaded automatically        | documented (by absence) | `files: []`                         |
| `read:` in `.aider.conf.yml` (home, git root, cwd) | documented              | `configReads` (home not read)       |
| How `read:` paths are resolved                     | **uncertain**           | relative to the config file (noted) |
| `--read` and `/read` during a session              | documented              | not modelled                        |
