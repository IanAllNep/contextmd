import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  analyzeContext,
  BUILTIN_ADAPTERS,
  exportContext,
  getAdapter,
  isAgentFacing,
  normalizeRel,
  RepositoryIndex,
  sourceLabel,
  type ExportFormat,
} from '@contextmd/core';
import { NodeFileSystem, toPosix } from '@contextmd/core/node';

const HELP = `contextmd: inspect agent instruction Markdown in a repository

Usage:
  contextmd scan    [repo]                     List Markdown files and their roles
  contextmd context [repo] [options]           Print the effective context for a target
  contextmd search  <query> [repo] [--regex]   Search Markdown files

Context options:
  --cwd <dir>        Launch directory, repo-relative (default: repository root)
  --file <path>      File the agent is working on (enables on-demand loading)
  --adapter <id>     ${BUILTIN_ADAPTERS.map((a) => a.id).join(' | ')} (default: generic)
  --format <fmt>     markdown | plain | json | summary (default: summary)
  --option k=v       Adapter option, repeatable (e.g. instructionFiles=claude-md-and-agents-md)
  --conflicts        Include experimental conflict heuristics in diagnostics

Token counts are estimates (≈ characters ÷ 4).
`;

function fail(msg: string): never {
  process.stderr.write(`contextmd: ${msg}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      cwd: { type: 'string' },
      file: { type: 'string' },
      adapter: { type: 'string', default: 'generic' },
      format: { type: 'string', default: 'summary' },
      option: { type: 'string', multiple: true },
      regex: { type: 'boolean' },
      conflicts: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    process.stdout.write(HELP);
    return;
  }
  const repoArg = command === 'search' ? rest[1] : rest[0];
  const root = toPosix(resolve(repoArg ?? '.'));
  const index = await RepositoryIndex.open(root, new NodeFileSystem());

  if (command === 'scan') {
    for (const d of index.summaries()) {
      const tokens = d.stats ? `~${d.stats.tokens}`.padStart(8) : '       -';
      process.stdout.write(
        `${d.kind.padEnd(13)}${tokens}  /${d.path}${d.symlinkTarget ? ` -> /${d.symlinkTarget}` : ''}\n`,
      );
    }
    const agent = index.summaries().filter((d) => isAgentFacing(d.kind)).length;
    process.stdout.write(
      `\n${index.size} Markdown files, ${agent} agent-facing, ${index.directories().length} directories\n`,
    );
    return;
  }

  if (command === 'search') {
    const query = rest[0] ?? fail('search needs a query');
    const r = index.search(query, { regex: values.regex ?? false });
    if (r.error) fail(r.error);
    for (const m of r.matches) {
      process.stdout.write(
        `/${m.path}:${m.line}:${m.column}${m.section ? `  [${m.section}]` : ''}\n    ${m.snippet}\n`,
      );
    }
    process.stdout.write(
      `\n${r.matches.length} matches in ${r.fileCount} files (${r.elapsedMs} ms)${r.truncated ? ', truncated' : ''}\n`,
    );
    return;
  }

  if (command === 'context') {
    const adapter =
      getAdapter(values.adapter ?? 'generic') ?? fail(`unknown adapter "${values.adapter}"`);
    const cwd = normalizeRel(values.cwd ?? '') ?? fail('--cwd must be inside the repository');
    const file = values.file
      ? (normalizeRel(values.file) ?? fail('--file must be inside the repository'))
      : null;
    const options: Record<string, string> = {};
    for (const kv of values.option ?? []) {
      const [k, ...v] = kv.split('=');
      if (k) options[k] = v.join('=');
    }
    const resolved = await adapter.resolve(index, { cwd, file }, options);
    const format = values.format ?? 'summary';
    if (format !== 'summary') {
      if (!['markdown', 'plain', 'json'].includes(format)) fail(`unknown format "${format}"`);
      process.stdout.write(exportContext(resolved, format as ExportFormat));
      return;
    }
    process.stdout.write(
      `Effective context · ${resolved.adapterName} (${resolved.fidelity}) · /${cwd}${file ? ` · working on /${file}` : ''}\n\n`,
    );
    resolved.segments.forEach((s) => {
      const mark = { included: '✓', truncated: '◐', skipped: '·', 'not-read': '?' }[s.status];
      const tokens =
        s.status === 'included' || s.status === 'truncated'
          ? `~${s.tokens}`.padStart(7)
          : ''.padStart(7);
      const timing = s.timing === 'on-demand' ? ' [on-demand]' : '';
      process.stdout.write(
        `${mark} ${tokens}  ${'  '.repeat(s.depth)}${sourceLabel(s.source)}${timing}\n`,
      );
      process.stdout.write(
        `${' '.repeat(12)}${'  '.repeat(s.depth)}${s.statusDetail ?? s.reason}\n`,
      );
    });
    process.stdout.write(
      `\nTotal ~${resolved.totals.tokens} tokens (${resolved.estimatorLabel}), ${resolved.totals.files} files\n`,
    );
    for (const n of resolved.notes) process.stdout.write(`note: ${n}\n`);
    const diags = analyzeContext(resolved, { experimentalConflicts: values.conflicts ?? false });
    for (const d of diags) {
      process.stdout.write(`\n${d.severity}: ${d.message}${d.heuristic ? ' (heuristic)' : ''}\n`);
      for (const s of d.sources)
        process.stdout.write(`  /${s.path}${s.line ? `:${s.line}` : ''}  ${s.excerpt}\n`);
    }
    return;
  }

  fail(`unknown command "${command}". Run contextmd --help.`);
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
