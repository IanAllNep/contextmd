import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import { toPosix } from '@contextmd/core/node';
import { IPC, type ContextMdApi, type InvokeMethod, type RepoEvent } from '../shared/api';
import { Recents } from './recents';
import { Workspace } from './workspace';

const APP_NAME = 'ContextMD';
app.setName(APP_NAME);
// Lets tests and multiple dev instances use an isolated profile.
if (process.env['CONTEXTMD_USER_DATA']) app.setPath('userData', process.env['CONTEXTMD_USER_DATA']);

let mainWindow: BrowserWindow | null = null;
let workspace: Workspace | null = null;
let rendererDirty = false;
const recents = new Recents(app.getPath('userData'));

/** A repository path passed on the command line: `contextmd /path/to/repo`. */
function launchRepositoryArg(): string | null {
  const args = process.argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((a) => !a.startsWith('-') && a !== '.');
  const candidate = args.at(-1) ?? process.env['CONTEXTMD_OPEN'] ?? null;
  return candidate ? resolve(candidate) : null;
}

function examplePath(): string | null {
  const p = resolve(app.getAppPath(), '../../examples/example-agent-project');
  return existsSync(p) ? p : null;
}

function emit(event: RepoEvent): void {
  mainWindow?.webContents.send(IPC.event, event);
}

async function openWorkspace(path: string) {
  await workspace?.close();
  workspace = null;
  const ws = await Workspace.open(toPosix(resolve(path)), emit);
  workspace = ws;
  await recents.add(ws.root);
  mainWindow?.setTitle(`${ws.name} — ${APP_NAME}`);
  return ws.snapshot();
}

function requireWorkspace(): Workspace {
  if (!workspace) throw new Error('No repository is open.');
  return workspace;
}

const handlers: {
  [K in InvokeMethod]: (...args: Parameters<ContextMdApi[K]>) => ReturnType<ContextMdApi[K]>;
} = {
  async openRepositoryDialog() {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open repository or folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return openWorkspace(result.filePaths[0]);
  },
  openRepository: (path) => openWorkspace(path),
  getLaunchInfo: async () => ({ repository: launchRepositoryArg(), examplePath: examplePath() }),
  getRecent: () => recents.list(),
  removeRecent: (path) => recents.remove(path),
  async closeRepository() {
    await workspace?.close();
    workspace = null;
    mainWindow?.setTitle(APP_NAME);
  },
  reload: () => requireWorkspace().reload(),
  readFile: (path) => requireWorkspace().readFile(path),
  saveFile: (path, content, baseHash, force) =>
    requireWorkspace().saveFile(path, content, baseHash, force),
  getDocument: (path) => requireWorkspace().getDocument(path),
  search: async (query, options) => requireWorkspace().search(query, options),
  resolveContext: (req) => requireWorkspace().resolveContext(req),
  exportContext: (req, format) => requireWorkspace().exportContext(req, format),
  copyText: async (text) => clipboard.writeText(text),
  async openExternal(url) {
    // Only web and mail links; never file:// or custom protocols from untrusted Markdown.
    if (/^(https?:|mailto:)/i.test(url)) await shell.openExternal(url);
  },
  async revealInFolder(path) {
    shell.showItemInFolder(await requireWorkspace().resolveInside(path, { mustExist: true }));
  },
};

ipcMain.handle(IPC.invoke, async (event, method: string, ...args: unknown[]) => {
  if (event.senderFrame?.url && !isAppUrl(event.senderFrame.url))
    throw new Error('Untrusted sender');
  if (!Object.hasOwn(handlers, method)) throw new Error(`Unknown method: ${method}`);
  return (handlers[method as InvokeMethod] as (...a: unknown[]) => unknown)(...args);
});
ipcMain.on(IPC.dirty, (_e, dirty: unknown) => {
  rendererDirty = dirty === true;
});

function isAppUrl(url: string): boolean {
  const dev = process.env['ELECTRON_RENDERER_URL'];
  return url.startsWith('file://') || (!!dev && url.startsWith(dev));
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      // No reload items: reloading the renderer would discard unsaved editor buffers.
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: APP_NAME,
    backgroundColor: '#16181d',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // The renderer never navigates or opens windows; links go through openExternal.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.on('close', (e) => {
    if (!rendererDirty) return;
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      buttons: ['Cancel', 'Discard changes and quit'],
      defaultId: 0,
      cancelId: 0,
      message: 'You have unsaved changes.',
      detail: 'Closing now will discard them.',
    });
    if (choice === 0) e.preventDefault();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  void workspace?.close();
  if (process.platform !== 'darwin') app.quit();
});

// Disallow any webview / remote content creation.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});
