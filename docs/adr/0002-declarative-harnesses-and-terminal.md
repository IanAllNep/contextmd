# ADR 0002 — Declarative harness specs and an embedded terminal

- Status: accepted
- Date: 2026-09-30

## Context

Supporting more agents (Gemini CLI, Amp, Copilot CLI, OpenCode, Cursor CLI, Aider, and any
in-house agent) one TypeScript adapter at a time doesn't scale. Their discovery rules differ
along a small number of dimensions:

- which directories are checked, and where the walk stops;
- whether one file or all files load per directory;
- imports, size budgets, and conditional rules;
- config-listed files.

Users also want to go from "this is the context" to "start the agent here" without leaving the
app.

## Decision

1. **Declarative specs** (YAML/JSON) for harnesses whose behavior fits those dimensions. A
   generic engine (`createSpecAdapter`) turns a spec into a `HarnessAdapter`. Complex harnesses
   (Claude Code, with its conditional AGENTS.md fallback) stay in TypeScript. To show the
   format is expressive enough, a test checks that a declarative Codex spec produces exactly the
   same result as the hand-written Codex adapter.
2. **Three origins with different trust.** Built-in specs may be `documented`. User specs and
   repository specs (`.contextmd/harnesses/`) are always `declared`. Built-in ids are reserved,
   so a repository cannot impersonate a documented adapter.
3. **No code plugins.** Loading third-party JavaScript would break the rule that opening a
   repository never executes anything from it.
4. **Embedded terminal** (xterm.js + node-pty, the stack VS Code uses) in the main process.
   - A shell starts only on an explicit click, in a validated directory inside the repository.
   - "Start ‹agent›" looks up the command in the registry in the main process (the renderer
     sends an adapter id, never a command). The command is **typed at the prompt without
     pressing Enter**.
   - Repository specs cannot provide commands at all.

## Consequences

- The security model changes from "ContextMD never executes anything" to "ContextMD never
  executes anything **on its own**". Opening a repository still runs nothing.
- `node-pty` is a native module. It ships prebuilt N-API binaries for macOS and Windows. On
  Linux it compiles at install time (needs `make` and a C++ compiler, present on common
  distros and CI images). Because it uses N-API, no Electron-specific rebuild is needed.
- `scripts/ensure-native.mjs` restores the macOS `spawn-helper` execute bit when npm skips
  install scripts.
