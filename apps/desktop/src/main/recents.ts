import { promises as fsp } from 'node:fs';
import { basename, join } from 'node:path';
import type { RecentRepo } from '../shared/api';

const MAX_RECENTS = 12;

/** Recently opened repositories, stored as JSON in the app's user-data directory. */
export class Recents {
  constructor(private readonly dir: string) {}

  private get file(): string {
    return join(this.dir, 'recent-repositories.json');
  }

  async list(): Promise<RecentRepo[]> {
    try {
      const data: unknown = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      if (!Array.isArray(data)) return [];
      return data.filter(
        (r): r is RecentRepo =>
          typeof r?.path === 'string' &&
          typeof r?.name === 'string' &&
          typeof r?.openedAt === 'number',
      );
    } catch {
      return [];
    }
  }

  async add(path: string): Promise<RecentRepo[]> {
    const list = (await this.list()).filter((r) => r.path !== path);
    list.unshift({ path, name: basename(path), openedAt: Date.now() });
    return this.write(list.slice(0, MAX_RECENTS));
  }

  async remove(path: string): Promise<RecentRepo[]> {
    return this.write((await this.list()).filter((r) => r.path !== path));
  }

  private async write(list: RecentRepo[]): Promise<RecentRepo[]> {
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(this.file, JSON.stringify(list, null, 2));
    return list;
  }
}
