import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface DesktopCustomAppRecord {
  id: string;
  pathKey: string;
  executablePath: string;
  displayName: string;
  version: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveDesktopCustomApp {
  id?: string;
  pathKey: string;
  executablePath: string;
  displayName: string;
  version: string | null;
  createdAt: string;
  updatedAt: string;
}

const columns = `id, path_key AS pathKey, executable_path AS executablePath,
  display_name AS displayName, version, created_at AS createdAt, updated_at AS updatedAt`;

export class DesktopAppCatalogRepository {
  constructor(private readonly db: DatabaseSync) {}

  listCustom(): DesktopCustomAppRecord[] {
    return this.db.prepare(`SELECT ${columns} FROM desktop_custom_apps
      ORDER BY display_name COLLATE NOCASE`).all() as unknown as DesktopCustomAppRecord[];
  }

  saveCustom(input: SaveDesktopCustomApp): DesktopCustomAppRecord {
    const id = input.id?.trim() ? input.id : randomUUID();
    const previous = id
      ? this.db.prepare(`SELECT ${columns} FROM desktop_custom_apps WHERE id=?`).get(id) as
        unknown as DesktopCustomAppRecord | undefined
      : undefined;
    if (previous) {
      this.db.prepare(`UPDATE desktop_custom_apps SET path_key=?,executable_path=?,display_name=?,
        version=?,updated_at=? WHERE id=?`).run(
        input.pathKey,
        input.executablePath,
        input.displayName,
        input.version,
        input.updatedAt,
        previous.id,
      );
      return this.db.prepare(`SELECT ${columns} FROM desktop_custom_apps WHERE id=?`)
        .get(previous.id) as unknown as DesktopCustomAppRecord;
    }
    this.db.prepare(`INSERT INTO desktop_custom_apps(
      id,path_key,executable_path,display_name,version,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(path_key) DO UPDATE SET
      executable_path=excluded.executable_path,display_name=excluded.display_name,
      version=excluded.version,updated_at=excluded.updated_at`).run(
      id,
      input.pathKey,
      input.executablePath,
      input.displayName,
      input.version,
      input.createdAt,
      input.updatedAt,
    );
    return this.db.prepare(`SELECT ${columns} FROM desktop_custom_apps WHERE path_key=?`)
      .get(input.pathKey) as unknown as DesktopCustomAppRecord;
  }

  deleteCustom(id: string): DesktopCustomAppRecord | null {
    const existing = this.db.prepare(`SELECT ${columns} FROM desktop_custom_apps WHERE id=?`)
      .get(id) as unknown as DesktopCustomAppRecord | undefined;
    if (!existing) return null;
    this.db.prepare('DELETE FROM desktop_custom_apps WHERE id=?').run(id);
    return existing;
  }

  findCustomByPath(pathKey: string): DesktopCustomAppRecord | null {
    return (this.db.prepare(`SELECT ${columns} FROM desktop_custom_apps WHERE path_key=?`)
      .get(pathKey) as DesktopCustomAppRecord | undefined) ?? null;
  }
}
