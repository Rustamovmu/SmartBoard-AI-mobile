import { Capacitor } from '@capacitor/core';
import { Camera, CameraDirection, CameraResultType, CameraSource } from '@capacitor/camera';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import {
  LocalLibrary, LocalVaultError, MAX_PHOTO_BYTES, VAULT_ROOT,
  type Capture, type CatalogPort, type FilePort, type Lecture, type PendingSave,
} from '@smartbord/local-library';

const database = 'SmartBordLibrary';
const pageSize = 30;
const columns = 'id, lecture_id, request_id, created_at, path, bytes, sha256';
export const schema = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS lectures (
 id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS captures (
 id TEXT PRIMARY KEY NOT NULL, lecture_id TEXT NOT NULL REFERENCES lectures(id),
 request_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
 bytes INTEGER NOT NULL CHECK(bytes > 0 AND bytes <= 20000000), sha256 TEXT NOT NULL CHECK(length(sha256)=64)
);
CREATE INDEX IF NOT EXISTS captures_lecture_date ON captures(lecture_id, created_at DESC, id);
CREATE TABLE IF NOT EXISTS pending_saves (
 id TEXT PRIMARY KEY NOT NULL, lecture_id TEXT NOT NULL REFERENCES lectures(id),
 request_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
 bytes INTEGER NOT NULL CHECK(bytes > 0 AND bytes <= 20000000), sha256 TEXT NOT NULL CHECK(length(sha256)=64), source_uri TEXT NOT NULL
);
`;

function capture(row: Record<string, unknown>): Capture {
  const bytes = Number(row.bytes);
  for (const field of ['id', 'lecture_id', 'request_id', 'created_at', 'path', 'sha256']) {
    if (typeof row[field] !== 'string') throw new LocalVaultError('LOCAL_SAVE_FAILED');
  }
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_PHOTO_BYTES || !/^[a-f0-9]{64}$/.test(String(row.sha256))) throw new LocalVaultError('LOCAL_SAVE_FAILED');
  return { id: String(row.id), lectureId: String(row.lecture_id), requestId: String(row.request_id),
    createdAt: String(row.created_at), path: String(row.path), bytes, sha256: String(row.sha256) };
}
function lecture(row: Record<string, unknown>): Lecture {
  if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.created_at !== 'string') throw new LocalVaultError('LOCAL_SAVE_FAILED');
  return { id: row.id, title: row.title, createdAt: row.created_at };
}

export class NativeCatalog implements CatalogPort {
  private readonly sqlite = new SQLiteConnection(CapacitorSQLite);
  private db?: SQLiteDBConnection;
  async open() {
    if (!Capacitor.isNativePlatform()) throw new LocalVaultError('NATIVE_REQUIRED');
    await this.sqlite.checkConnectionsConsistency();
    this.db = (await this.sqlite.isConnection(database, false)).result
      ? await this.sqlite.retrieveConnection(database, false)
      : await this.sqlite.createConnection(database, false, 'no-encryption', 1, false);
    if (!(await this.db.isDBOpen()).result) await this.db.open();
    await this.db.execute('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;', false);
    await this.db.execute(schema, false);
  }
  async close() {
    if (this.db) { await this.sqlite.closeConnection(database, false); this.db = undefined; }
  }
  private connection() { if (!this.db) throw new LocalVaultError('LOCAL_SAVE_FAILED'); return this.db; }
  private async rows(sql: string, values: (string | number)[] = []) {
    const result = await this.connection().query(sql, values);
    return (result.values ?? []).filter((row: Record<string, unknown>) => !('ios_columns' in row)) as Record<string, unknown>[];
  }
  async createLecture(value: Lecture) { await this.connection().run('INSERT INTO lectures(id,title,created_at) VALUES(?,?,?)', [value.id, value.title, value.createdAt]); }
  async getLecture(id: string) { const rows = await this.rows('SELECT * FROM lectures WHERE id=?', [id]); return rows[0] ? lecture(rows[0]) : null; }
  async listLectures(page: number) {
    const items = (await this.rows('SELECT * FROM lectures ORDER BY created_at DESC,id LIMIT ? OFFSET ?', [pageSize, (page - 1) * pageSize])).map(lecture);
    const count = (await this.rows('SELECT count(*) AS total FROM lectures'))[0];
    if (!count || !Number.isSafeInteger(Number(count.total))) throw new LocalVaultError('LOCAL_SAVE_FAILED');
    return { items, page, pageSize, total: Number(count.total) };
  }
  async getCaptureByRequest(id: string) { const rows = await this.rows(`SELECT ${columns} FROM captures WHERE request_id=?`, [id]); return rows[0] ? capture(rows[0]) : null; }
  async getCapture(id: string) { const rows = await this.rows(`SELECT ${columns} FROM captures WHERE id=?`, [id]); return rows[0] ? capture(rows[0]) : null; }
  async listCaptures(lectureId: string, page: number) {
    const items = (await this.rows(`SELECT ${columns} FROM captures WHERE lecture_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?`, [lectureId, pageSize, (page - 1) * pageSize])).map(capture);
    const count = (await this.rows('SELECT count(*) AS total FROM captures WHERE lecture_id=?', [lectureId]))[0];
    if (!count || !Number.isSafeInteger(Number(count.total))) throw new LocalVaultError('LOCAL_SAVE_FAILED');
    return { items, page, pageSize, total: Number(count.total) };
  }
  private pending(row: Record<string, unknown>): PendingSave {
    if (typeof row.source_uri !== 'string') throw new LocalVaultError('LOCAL_SAVE_FAILED');
    return { ...capture(row), sourceUri: row.source_uri };
  }
  async getPending(id: string) { const rows = await this.rows('SELECT * FROM pending_saves WHERE request_id=?', [id]); return rows[0] ? this.pending(rows[0]) : null; }
  async listPending() { return (await this.rows('SELECT * FROM pending_saves ORDER BY created_at,id LIMIT 20')).map(row => this.pending(row)); }
  async pendingCount() {
    const row = (await this.rows('SELECT count(*) AS total FROM pending_saves'))[0];
    if (!row || !Number.isSafeInteger(Number(row.total))) throw new LocalVaultError('LOCAL_SAVE_FAILED');
    return Number(row.total);
  }
  private values(value: Capture) { return [value.id, value.lectureId, value.requestId, value.createdAt, value.path, value.bytes, value.sha256]; }
  async putPending(value: PendingSave) {
    await this.connection().run(`INSERT INTO pending_saves(${columns},source_uri) VALUES(?,?,?,?,?,?,?,?)`, [...this.values(value), value.sourceUri]);
  }
  async commit(value: PendingSave) {
    await this.connection().executeSet([
      { statement: `INSERT INTO captures(${columns}) VALUES(?,?,?,?,?,?,?)`, values: this.values(value) },
      { statement: 'DELETE FROM pending_saves WHERE request_id=?', values: [value.requestId] },
    ], true);
  }
}

function ownedPath(path: string) {
  if (!path.startsWith(`${VAULT_ROOT}/lectures/`) || path.includes('..') || path.startsWith('/') || path.includes('://')) throw new LocalVaultError('INVALID_INPUT');
}
function localCameraUri(path: string) {
  const uri = new URL(path);
  if (uri.protocol !== 'file:' || (uri.hostname && uri.hostname !== 'localhost') || uri.search || uri.hash) throw new LocalVaultError('INVALID_INPUT');
}
function missing(error: unknown) {
  return typeof error === 'object' && error && 'code' in error && (error.code === 'OS-PLUG-FILE-0008' || error.code === 'ENOENT');
}
export class NativeFiles implements FilePort {
  async prepareDirectory(path: string) {
    if (path !== VAULT_ROOT) ownedPath(path);
    try { await Filesystem.mkdir({ path, directory: Directory.Library, recursive: true }); }
    catch (error) {
      if (!(typeof error === 'object' && error && 'code' in error && error.code === 'OS-PLUG-FILE-0010')) throw error;
      const existing = await Filesystem.stat({ path, directory: Directory.Library });
      if (existing.type !== 'directory') throw new LocalVaultError('LOCAL_SAVE_FAILED');
    }
  }
  async size(path: string, source = false) {
    if (source) localCameraUri(path); else ownedPath(path);
    try {
      const info = await Filesystem.stat({ path, ...(source ? {} : { directory: Directory.Library }) });
      if (info.type !== 'file') throw new LocalVaultError('FILE_CHANGED');
      return info.size;
    } catch (error) { if (missing(error)) return null; throw error; }
  }
  async copy(sourceUri: string, destination: string) {
    localCameraUri(sourceUri); ownedPath(destination);
    await Filesystem.copy({ from: sourceUri, to: destination, toDirectory: Directory.Library });
  }
  async rename(from: string, to: string) {
    ownedPath(from); ownedPath(to);
    if (await this.size(to) !== null) throw new LocalVaultError('FILE_CHANGED');
    await Filesystem.rename({ from, to, directory: Directory.Library, toDirectory: Directory.Library });
  }
  async read(path: string, source = false) {
    if (source) localCameraUri(path); else ownedPath(path);
    const size = await this.size(path, source);
    if (size === null) throw new LocalVaultError('FILE_MISSING');
    if (!Number.isSafeInteger(size) || size < 1) throw new LocalVaultError('FILE_CHANGED');
    if (size > MAX_PHOTO_BYTES) throw new LocalVaultError('PHOTO_TOO_LARGE');
    const result = await Filesystem.readFile({ path, ...(source ? {} : { directory: Directory.Library }) });
    if (typeof result.data !== 'string' || result.data.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 4) throw new LocalVaultError('PHOTO_TOO_LARGE');
    const binary = atob(result.data);
    if (binary.length > MAX_PHOTO_BYTES) throw new LocalVaultError('PHOTO_TOO_LARGE');
    if (binary.length !== size) throw new LocalVaultError('FILE_CHANGED');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  async uri(path: string) { ownedPath(path); return Capacitor.convertFileSrc((await Filesystem.getUri({ path, directory: Directory.Library })).uri); }
}

let instance: LocalLibrary | undefined;
export function nativeLibrary() {
  if (!Capacitor.isNativePlatform()) throw new LocalVaultError('NATIVE_REQUIRED');
  return instance ??= new LocalLibrary(new NativeCatalog(), new NativeFiles(), {
    uuid: () => crypto.randomUUID(), now: () => new Date().toISOString(),
    hash: async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))).map(byte => byte.toString(16).padStart(2, '0')).join(''),
  });
}
export async function takeNativePhoto() {
  if (!Capacitor.isNativePlatform()) throw new LocalVaultError('NATIVE_REQUIRED');
  const photo = await Camera.getPhoto({ source: CameraSource.Camera, direction: CameraDirection.Rear,
    resultType: CameraResultType.Uri, quality: 100, allowEditing: false, saveToGallery: false });
  if (!photo.path || photo.format !== 'jpeg') throw new LocalVaultError('LOCAL_SAVE_FAILED');
  localCameraUri(photo.path);
  return photo.path;
}
