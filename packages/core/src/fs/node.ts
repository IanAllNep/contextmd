import { promises as fsp } from 'node:fs';
import type { DirEntry, FileStat, FileSystem } from './types';

export const toPosix = (p: string): string => p.replace(/\\/g, '/');

export class NodeFileSystem implements FileSystem {
  async readFile(absPath: string): Promise<string> {
    return fsp.readFile(absPath, 'utf8');
  }

  async readDir(absPath: string): Promise<DirEntry[]> {
    const entries = await fsp.readdir(absPath, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isFile: e.isFile(),
      isDirectory: e.isDirectory(),
      isSymbolicLink: e.isSymbolicLink(),
    }));
  }

  async stat(absPath: string): Promise<FileStat> {
    const s = await fsp.stat(absPath);
    return { isFile: s.isFile(), isDirectory: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs };
  }

  async realpath(absPath: string): Promise<string> {
    return toPosix(await fsp.realpath(absPath));
  }
}
