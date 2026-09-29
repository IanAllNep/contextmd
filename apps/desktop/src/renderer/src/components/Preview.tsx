import { useDeferredValue, useEffect, useMemo, useRef, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Root, RootContent } from 'mdast';
import { api } from '../api';
import { resolveHref } from '../lib/format';
import { openFile, toast, useStore } from '../store';

/**
 * Renders untrusted Markdown. Raw HTML is never rendered (no rehype-raw): it is shown as escaped
 * text, and HTML comments are hidden.
 * Images are replaced by placeholders (no local file or remote loading; CSP blocks both).
 * Links: internal → open in the app, external http(s) → system browser.
 */
export function Preview({ path, content }: { path: string; content: string }) {
  const deferred = useDeferredValue(content);
  const ref = useRef<HTMLDivElement>(null);
  const navRequest = useStore((s) => s.navRequest);
  const files = useStore((s) => s.snapshot?.files);

  useEffect(() => {
    if (!navRequest || navRequest.path !== path || !ref.current) return;
    // Nearest block at or above the requested line.
    const blocks = [...ref.current.querySelectorAll<HTMLElement>('[data-line]')];
    let best: HTMLElement | null = null;
    for (const el of blocks) {
      if (Number(el.dataset['line']) <= navRequest.line) best = el;
      else break;
    }
    best?.scrollIntoView({ block: 'start' });
  }, [navRequest, path]);

  const components = useMemo<Components>(() => {
    const withLine =
      (
        Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'li' | 'pre' | 'blockquote' | 'table',
      ) =>
      ({
        node,
        children,
      }: {
        node?: { position?: { start: { line: number } } };
        children?: ReactNode;
      }) => <Tag data-line={node?.position?.start.line}>{children}</Tag>;
    const exists = (p: string) => files?.some((f) => f.path === p);
    return {
      h1: withLine('h1'),
      h2: withLine('h2'),
      h3: withLine('h3'),
      h4: withLine('h4'),
      h5: withLine('h5'),
      h6: withLine('h6'),
      p: withLine('p'),
      li: withLine('li'),
      pre: withLine('pre'),
      blockquote: withLine('blockquote'),
      table: withLine('table'),
      img: ({ src, alt }) => (
        <span className="img-placeholder" title={typeof src === 'string' ? src : ''}>
          image: {alt || (typeof src === 'string' ? src : '')}
        </span>
      ),
      a: ({ href, children }) => {
        const url = href ?? '';
        const isExternal = /^[a-z][a-z0-9+.-]*:/i.test(url);
        const onClick = (e: React.MouseEvent) => {
          e.preventDefault();
          if (isExternal) {
            if (/^(https?|mailto):/i.test(url)) void api().openExternal(url);
            return;
          }
          if (url.startsWith('#')) {
            const slug = decodeURIComponent(url.slice(1));
            const heading = [...(ref.current?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? [])].find(
              (h) => slugify(h.textContent ?? '') === slug,
            );
            heading?.scrollIntoView({ block: 'start' });
            return;
          }
          const { path: target } = resolveHref(path, url);
          const candidates = target
            ? [target, `${target}.md`, `${target.replace(/\/$/, '')}/README.md`]
            : [];
          const found = candidates.find(exists);
          if (found) void openFile(found);
          else toast('warning', `Link target not found: ${url}`);
        };
        const broken =
          !isExternal &&
          !url.startsWith('#') &&
          (() => {
            const { path: target } = resolveHref(path, url);
            return !!target && /\.(md|markdown|mdx|mdc)$/i.test(target) && !exists(target);
          })();
        return (
          <a
            href={url}
            onClick={onClick}
            className={broken ? 'broken-link' : isExternal ? 'external-link' : undefined}
            title={broken ? `Broken link: ${url}` : url}
          >
            {children}
          </a>
        );
      },
    };
  }, [files, path]);

  return (
    <div className="preview" ref={ref}>
      <article className="markdown-body">
        <Markdown remarkPlugins={[remarkGfm, hideHtmlComments]} components={components}>
          {stripFrontmatter(deferred)}
        </Markdown>
      </article>
    </div>
  );
}

/**
 * Other raw HTML is shown as escaped text (never rendered), but HTML comments are hidden,
 * as on GitHub. They are maintainer notes, and Claude Code strips them too.
 */
function hideHtmlComments() {
  const isComment = (n: RootContent) => n.type === 'html' && /^\s*<!--[\s\S]*-->\s*$/.test(n.value);
  const prune = (node: { children?: RootContent[] }) => {
    if (!node.children) return;
    node.children = node.children.filter((c) => !isComment(c));
    node.children.forEach((c) => prune(c as { children?: RootContent[] }));
  };
  return (tree: Root) => prune(tree);
}

/** Frontmatter is shown in the inspector, not rendered as a heading/hr. Keeps line numbers aligned. */
function stripFrontmatter(md: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(md);
  if (!m) return md;
  return '\n'.repeat(m[0].split('\n').length - 1) + md.slice(m[0].length);
}

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}
