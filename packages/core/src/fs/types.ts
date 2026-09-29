/**
 * Minimal filesystem abstraction so the core never imports Node APIs directly.
 * All paths passed to a FileSystem are absolute, '/'-separated.
 */
export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}

export interface FileSystem {
  readFile(absPath: string): Promise<string>;
  readDir(absPath: string): Promise<DirEntry[]>;
  /** Follows symlinks. Rejects if the path does not exist. */
  stat(absPath: string): Promise<FileStat>;
  /** Resolves symlinks. Rejects if the path does not exist. */
  realpath(absPath: string): Promise<string>;
}
