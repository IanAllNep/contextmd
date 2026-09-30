# Harness specs

A **harness spec** describes, as data, where a coding agent looks for instruction files.
ContextMD turns a spec into a harness adapter, so a new agent needs no code.

Complex behavior stays in TypeScript adapters (Claude Code, Codex). Most terminal agents fit a
spec: Gemini CLI, Amp, GitHub Copilot CLI, OpenCode, Cursor CLI and Aider ship as built-in
specs in [`builtin-specs.ts`](../packages/core/src/harness/builtin-specs.ts).

## Where specs are loaded from

| Location                                                                                               | Origin       | Trust                                                                                |
| ------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------ |
| Built into ContextMD                                                                                   | `builtin`    | May be marked `documented` (sources in [harness-semantics.md](harness-semantics.md)) |
| Your harness folder: palette → **Open Your Harness Specs Folder…**, or `contextmd --harness-dir <dir>` | `user`       | Always `declared`; may define a `command`                                            |
| `.contextmd/harnesses/*.yaml`, `*.yml` or `*.json` in the opened repository                            | `repository` | Always `declared`; **`command` is ignored**                                          |

Rules:

- Built-in ids (`generic`, `claude-code`, `codex`, `gemini-cli`, …) are reserved. A spec cannot
  replace a built-in adapter.
- If a user spec and a repository spec share an id, the user spec wins.
- Invalid specs are listed in the Context panel ("harness specs have problems") and printed by
  the CLI. They never break the app.
- Repository specs reload live when the files change. After editing your own specs, reload the
  repository (⌘⇧R).
- Specs are data. Nothing in a spec is executed, and specs can't reference files outside the
  repository. Paths in `global` are shown but never read.

## Example

```yaml
# .contextmd/harnesses/my-agent.yaml
id: my-agent
name: My Agent
description: MYAGENT.md from the git root to the launch directory, nearest wins per directory.
command: my-agent # user specs only: typed by "Start My Agent" in the terminal
global: [~/.myagent/MYAGENT.md]
root: { markers: [.git], fallback: repo-root }
traversal: root-to-cwd
files: [MYAGENT.md, AGENTS.md]
perDirectory: first
onDemand: true
imports: { syntax: at, maxDepth: 3 }
stripHtmlComments: true
maxBytes: 32768
overflow: truncate
rules:
  - glob: .myagent/rules/**/*.md
    globsField: paths
notes:
  - Anything the agent's docs leave open goes here; it is shown with every resolution.
```

## Fields

| Field                                  | Type                                                              | Meaning                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                   | string, required                                                  | Lowercase letters, digits, dashes; starts with a letter; ≤ 40 characters.                                                                |
| `name`                                 | string, required                                                  | Display name.                                                                                                                            |
| `description`                          | string                                                            | Shown under the harness picker.                                                                                                          |
| `files`                                | string[], required (may be empty)                                 | Candidate files in **each** checked directory, in priority order. Subpaths are allowed (`.claude/CLAUDE.md`).                            |
| `rootFiles`                            | string[]                                                          | Extra candidates checked only in the project root (e.g. `.github/copilot-instructions.md`).                                              |
| `perDirectory`                         | `first` \| `all` (default `all`)                                  | `first`: at most one file per directory; the others are shown as skipped.                                                                |
| `traversal`                            | `root-to-cwd` (default) \| `cwd-only` \| `root-only` \| `nearest` | Which directories are checked. `nearest` walks up from the launch directory and stops at the first directory with a match.               |
| `root`                                 | `{ markers: string[], fallback?: 'cwd' \| 'repo-root' }`          | Project root = nearest ancestor of the launch directory containing a marker (e.g. `.git`). Without it, the opened folder is the root.    |
| `onDemand`                             | boolean                                                           | Directories between the launch directory and the _working file_ load on demand.                                                          |
| `imports`                              | `{ syntax: 'at', maxDepth: 1–20, in?: string[] }`                 | Expand `@path` references (outside code), relative to the importing file. `in` limits expansion to these file names.                     |
| `stripHtmlComments`                    | boolean                                                           | Remove block-level HTML comments before injection.                                                                                       |
| `skipEmpty`                            | boolean                                                           | Skip empty or whitespace-only files.                                                                                                     |
| `maxBytes`                             | integer                                                           | Combined byte budget across loaded files, in load order.                                                                                 |
| `overflow`                             | `truncate` (default) \| `skip`                                    | What happens to the file that crosses `maxBytes`.                                                                                        |
| `maxFileBytes`                         | integer                                                           | Skip individual files larger than this.                                                                                                  |
| `rules`                                | list                                                              | Conditional rule files; see below.                                                                                                       |
| `configReads`                          | `{ file, key }[]`                                                 | YAML/JSON config files (in the project root or launch directory) that list extra files to read, e.g. Aider's `.aider.conf.yml` → `read`. |
| `global`                               | string[]                                                          | Files outside the repository the agent also reads. Shown as _not read_.                                                                  |
| `command`                              | string (one line)                                                 | The CLI that starts the agent. Used by **Start ‹name›** in the terminal. Ignored for repository specs.                                   |
| `notes`                                | string[]                                                          | Caveats shown with every resolution.                                                                                                     |
| `references`, `verifiedOn`, `fidelity` |                                                                   | Documentation links. `fidelity: documented` is honoured only for built-in specs.                                                         |

### Rules

```yaml
rules:
  - glob: .cursor/rules/**/*.mdc # relative to the project root
    globsField: globs # frontmatter field with file globs (string or list)
    alwaysField: alwaysApply # frontmatter field that means "always load"
    default: skip # rules with neither: 'always' (default) or 'skip'
    stripFrontmatter: true # default true
```

A rule file loads:

- **at launch** if its `alwaysField` is `true`, or if it has no globs and `default` is `always`;
- **on demand** if the working file matches its globs;
- otherwise it is listed as _not loaded_, with the reason.

## Fidelity

| Badge        | Meaning                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `heuristic`  | ContextMD's own model (Generic).                                                                                       |
| `documented` | A built-in adapter or spec that follows the vendor's documentation (see [harness-semantics.md](harness-semantics.md)). |
| `declared`   | Defined by you or by the repository. ContextMD shows what the spec says; it has not verified the agent.                |

## Testing a spec

```bash
node packages/cli/dist/cli.js harnesses path/to/repo
node packages/cli/dist/cli.js context path/to/repo --adapter my-agent --cwd src --file src/app.ts
node packages/cli/dist/cli.js context path/to/repo --adapter my-agent --harness-dir ~/my-specs
```
