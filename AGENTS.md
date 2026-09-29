# ContextMD: instructions for coding agents

- Read `docs/architecture.md` and `docs/progress.md` before large changes; update
  `docs/progress.md` when you finish a feature.
- Analysis logic belongs in `packages/core` (no Electron/React imports there) with tests in
  `packages/core/test`.
- The UI ↔ main contract is `apps/desktop/src/shared/api.ts`; the renderer only imports types
  from `@contextmd/core`.
- Never weaken data safety: saves go through the hash check in `Workspace.saveFile`.
- Harness adapters marked `documented` must match `docs/harness-semantics.md`; cite sources.
- Run `npm run check` before finishing. After UI changes, also run `npm run build && npm run smoke`.
- Keep `examples/example-agent-project` intact: tests depend on its conflicts, duplicates and
  broken link.
