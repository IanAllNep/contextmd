# Contributing to ContextMD

Thanks for helping. This project is early, so small focused pull requests are easiest to review.

## Setup

```bash
npm install
npm run dev        # desktop app with hot reload
npm test           # Vitest
npm run check      # typecheck + lint + test + build (run before opening a PR)
npm run smoke      # optional: end-to-end run of the built app (after npm run build)
```

Node.js ≥ 22.12. No Rust or native toolchain is required.

## Layout

| Path                             | What lives there                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `packages/core`                  | All analysis: scanner, parser, index, search, adapters, diagnostics. **No Electron or UI imports.** |
| `packages/cli`                   | Headless CLI on top of core                                                                         |
| `apps/desktop/src/main`          | Electron main process: workspace (index + watcher + file IO), IPC                                   |
| `apps/desktop/src/preload`       | The typed bridge (`window.contextmd`)                                                               |
| `apps/desktop/src/shared/api.ts` | The **only** contract between UI and main                                                           |
| `apps/desktop/src/renderer`      | React UI (Zustand store in `store.ts`)                                                              |
| `examples/example-agent-project` | Fixture used by tests and demos. Keep its intentional conflict, duplicates and broken link.         |
| `docs/`                          | Architecture, ADRs, harness semantics, progress log                                                 |

## Ground rules

1. **Core stays portable.** Anything that answers "what does the agent see?" belongs in
   `packages/core` with tests, not in React components.
2. **Provenance is not optional.** New context features must keep source path and line
   information (`ContextSegment.lineMap`, `via`).
3. **No fake harness semantics.** A `documented` adapter must cite sources in `references` and
   in `docs/harness-semantics.md`. Put anything uncertain in `notes`, not in silent behavior.
   Otherwise mark the adapter `heuristic`.
4. **Data safety.** Never write a file without the hash check in `Workspace.saveFile`. Never
   discard a dirty buffer automatically.
5. **Security.** Never execute anything from an opened repository. Don't widen the preload API
   or the CSP without discussion.
6. **No required network or AI services.** Optional integrations must be opt-in.

## Adding a recognized file pattern

Add an entry to `RECOGNIZED_PATTERNS` in `packages/core/src/scan/classify.ts` and a case to
`packages/core/test/scan.test.ts`.

## Adding a harness adapter

1. Implement `HarnessAdapter` in `packages/core/src/harness/<id>.ts`, using `ContextBuilder`.
2. Register it in `harness/registry.ts`.
3. Add tests in `packages/core/test/context.test.ts` covering ordering, skipped files and limits.
4. Document the semantics and sources in `docs/harness-semantics.md`.

## Style

Prettier (`npm run format`) and ESLint (`npm run lint`). Keep comments for the _why_.
Use TypeScript strict mode, with no `any` in core.
