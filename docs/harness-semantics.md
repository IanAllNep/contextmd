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

## Gemini CLI: not implemented

The docs and source disagree (downward subdirectory scan; stop condition without git; ordering
after deduplication). Until that is settled, Gemini is represented only by `GEMINI.md`
classification and the Generic adapter. Research notes, checked 2026-09-29:

- Global `~/.gemini/GEMINI.md`; configurable `context.fileName` (string or list, e.g.
  `AGENTS.md`); **all** configured names per directory (not one).
- Upward search from cwd to the first directory with `context.memoryBoundaryMarkers`
  (default `.git`).
- Imports `@./file.md`, max depth 5, ignored in code.
- Blocks wrapped as `--- Context from: <path> ---` … `--- End of Context from: <path> ---`.
- Downward startup scan (up to 200 dirs) is still in the configuration docs but appears to be
  replaced by just-in-time loading in the current source.
