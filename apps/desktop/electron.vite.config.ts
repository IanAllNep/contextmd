import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

/**
 * The production CSP forbids inline scripts. The dev server's React Fast Refresh preamble
 * is an inline script, so the policy is relaxed only while serving in development.
 */
function devCsp(): Plugin {
  return {
    name: 'contextmd-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
        .replace("connect-src 'self'", "connect-src 'self' ws://localhost:* http://localhost:*");
    },
  };
}

export default defineConfig({
  main: {
    build: {
      // Bundle the workspace core package (TypeScript source); keep real deps external.
      externalizeDeps: { exclude: ['@contextmd/core'] },
    },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: ['@contextmd/core'] },
      rollupOptions: {
        // Sandboxed preload scripts must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react(), devCsp()],
  },
});
