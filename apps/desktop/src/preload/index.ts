import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ContextMdApi, type InvokeMethod, type RepoEvent } from '../shared/api';

const invoke =
  (method: InvokeMethod) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(IPC.invoke, method, ...args);

const methods: InvokeMethod[] = [
  'openRepositoryDialog',
  'openRepository',
  'getLaunchInfo',
  'getRecent',
  'removeRecent',
  'closeRepository',
  'reload',
  'readFile',
  'saveFile',
  'getDocument',
  'search',
  'resolveContext',
  'exportContext',
  'copyText',
  'openExternal',
  'revealInFolder',
];

const api = Object.fromEntries(methods.map((m) => [m, invoke(m)])) as unknown as Omit<
  ContextMdApi,
  'onEvent' | 'setDirty'
>;

const bridge: ContextMdApi = {
  ...api,
  setDirty: (dirty) => ipcRenderer.send(IPC.dirty, dirty),
  onEvent(listener) {
    const handler = (_e: unknown, event: RepoEvent) => listener(event);
    ipcRenderer.on(IPC.event, handler);
    return () => ipcRenderer.removeListener(IPC.event, handler);
  },
};

contextBridge.exposeInMainWorld('contextmd', bridge);
