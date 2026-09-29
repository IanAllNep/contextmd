import type { ContextMdApi } from '../../shared/api';

declare global {
  interface Window {
    contextmd: ContextMdApi;
  }
}

export const api = (): ContextMdApi => window.contextmd;
