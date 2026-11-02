export const MAX_PHOTO_BYTES = 20_000_000;
export const VAULT_ROOT = 'SmartBordVault';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface Lecture { id: string; title: string; createdAt: string }
export interface Capture {
  id: string; lectureId: string; requestId: string; createdAt: string;
  path: string; bytes: number; sha256: string;
}
export interface PendingSave extends Capture { sourceUri: string }
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
export type LocalErrorCode = 'NATIVE_REQUIRED' | 'INVALID_INPUT' | 'CAPTURE_BUSY' | 'PERMISSION_DENIED' |
  'CAPTURE_CANCELLED' | 'PHOTO_TOO_LARGE' | 'FILE_MISSING' | 'FILE_CHANGED' | 'DEVICE_STORAGE_FULL' | 'LOCAL_SAVE_FAILED';

const messages: Record<LocalErrorCode, string> = {
  NATIVE_REQUIRED: 'Install the mobile app to use the camera and durable phone storage.',
  INVALID_INPUT: 'Check the lecture name or selected item.',
  CAPTURE_BUSY: 'Finish the current capture before starting another.',
  PERMISSION_DENIED: 'Camera or file permission was denied. Your existing files are unchanged.',
  CAPTURE_CANCELLED: 'Capture cancelled.',
  PHOTO_TOO_LARGE: 'This photo exceeds the 20 MB limit for this build. It has not been accepted as saved.',
  FILE_MISSING: 'The local original is missing. There is no server copy to restore.',
  FILE_CHANGED: 'The local file does not match its saved checksum. It has not been replaced.',
  DEVICE_STORAGE_FULL: 'Your phone is out of storage. Existing files are preserved; the save is incomplete.',
  LOCAL_SAVE_FAILED: 'The local save could not finish. Reopen or retry to check recoverable files.',
};

export class LocalVaultError extends Error {
  constructor(public readonly code: LocalErrorCode) { super(messages[code]); }
}

export function safeLocalError(error: unknown): LocalVaultError {
  if (error instanceof LocalVaultError) return error;
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : '';
  if (/ENOSPC|no space left|not enough space|disk.*full/i.test(`${code} ${message}`)) return new LocalVaultError('DEVICE_STORAGE_FULL');
  if (/denied|not authorized|permission/i.test(`${code} ${message}`)) return new LocalVaultError('PERMISSION_DENIED');
  if (/cancel/i.test(`${code} ${message}`)) return new LocalVaultError('CAPTURE_CANCELLED');
  return new LocalVaultError('LOCAL_SAVE_FAILED');
}

export interface CatalogPort {
  open(): Promise<void>;
  close(): Promise<void>;
  createLecture(lecture: Lecture): Promise<void>;
  getLecture(id: string): Promise<Lecture | null>;
  listLectures(page: number): Promise<Page<Lecture>>;
  getCaptureByRequest(requestId: string): Promise<Capture | null>;
  getCapture(id: string): Promise<Capture | null>;
  listCaptures(lectureId: string, page: number): Promise<Page<Capture>>;
  getPending(requestId: string): Promise<PendingSave | null>;
  listPending(): Promise<PendingSave[]>;
  pendingCount(): Promise<number>;
  putPending(save: PendingSave): Promise<void>;
  commit(save: PendingSave): Promise<void>;
}
export interface FilePort {
  prepareDirectory(path: string): Promise<void>;
  size(path: string, source?: boolean): Promise<number | null>;
  copy(sourceUri: string, destination: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  read(path: string, source?: boolean): Promise<Uint8Array>;
  uri(path: string): Promise<string>;
}
export interface RuntimePort { uuid(): string; now(): string; hash(bytes: Uint8Array): Promise<string> }

function validId(id: string) { if (!uuidPattern.test(id)) throw new LocalVaultError('INVALID_INPUT'); }
function validSize(size: number | null): asserts size is number {
  if (size === null) throw new LocalVaultError('FILE_MISSING');
  if (!Number.isSafeInteger(size) || size <= 0) throw new LocalVaultError('LOCAL_SAVE_FAILED');
  if (size > MAX_PHOTO_BYTES) throw new LocalVaultError('PHOTO_TOO_LARGE');
}

export class LocalLibrary {
  private initialization?: Promise<void>;
  private operation?: { id: string; lectureId: string; promise: Promise<Capture> };
  constructor(private readonly catalog: CatalogPort, private readonly files: FilePort, private readonly runtime: RuntimePort) {}

  initialize() {
    return this.initialization ??= (async () => {
      // Native SQLite first establishes the backup-excluded iOS vault root.
      await this.catalog.open();
      await this.files.prepareDirectory(VAULT_ROOT);
    })().catch(async error => {
      this.initialization = undefined;
      await this.catalog.close().catch(() => undefined);
      throw safeLocalError(error);
    });
  }

  async createLecture(title: string) {
    await this.initialize();
    const cleaned = title.trim();
    if (!cleaned || cleaned.length > 120) throw new LocalVaultError('INVALID_INPUT');
    const lecture = { id: this.runtime.uuid(), title: cleaned, createdAt: this.runtime.now() };
    validId(lecture.id);
    await this.files.prepareDirectory(`${VAULT_ROOT}/lectures/${lecture.id}/originals`);
    await this.catalog.createLecture(lecture);
    return lecture;
  }
  async listLectures(page = 1) {
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw new LocalVaultError('INVALID_INPUT');
    await this.initialize(); return this.catalog.listLectures(page);
  }
  async pendingCount() { await this.initialize(); return this.catalog.pendingCount(); }
  async listCaptures(lectureId: string, page = 1) {
    validId(lectureId);
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw new LocalVaultError('INVALID_INPUT');
    await this.initialize();
    return this.catalog.listCaptures(lectureId, page);
  }
  newRequestId() { return this.runtime.uuid(); }

  savePhoto(lectureId: string, sourceUri: string, requestId: string): Promise<Capture> {
    validId(lectureId); validId(requestId);
    if (this.operation) {
      if (this.operation.id === requestId && this.operation.lectureId === lectureId) return this.operation.promise;
      return Promise.reject(new LocalVaultError('CAPTURE_BUSY'));
    }
    const promise = this.performSave(lectureId, sourceUri, requestId).catch(error => { throw safeLocalError(error); })
      .finally(() => { this.operation = undefined; });
    this.operation = { id: requestId, lectureId, promise };
    return promise;
  }

  private async checksum(path: string, source = false) {
    const bytes = await this.files.read(path, source);
    validSize(bytes.byteLength);
    try { return { bytes: bytes.byteLength, sha256: await this.runtime.hash(bytes) }; }
    finally { bytes.fill(0); }
  }

  private validatePath(capture: Capture) {
    validId(capture.id); validId(capture.lectureId);
    const expectedPath = `${VAULT_ROOT}/lectures/${capture.lectureId}/originals/${capture.id}.jpg`;
    if (capture.path !== expectedPath) throw new LocalVaultError('INVALID_INPUT');
  }
  private async verify(capture: Capture) {
    this.validatePath(capture);
    const size = await this.files.size(capture.path);
    validSize(size);
    if (size !== capture.bytes) throw new LocalVaultError('FILE_CHANGED');
    const digest = await this.checksum(capture.path);
    if (digest.sha256 !== capture.sha256) throw new LocalVaultError('FILE_CHANGED');
  }

  private async performSave(lectureId: string, sourceUri: string, requestId: string) {
    await this.initialize();
    const existing = await this.catalog.getCaptureByRequest(requestId);
    if (existing) {
      if (existing.lectureId !== lectureId) throw new LocalVaultError('INVALID_INPUT');
      await this.verify(existing);
      return existing;
    }
    let pending = await this.catalog.getPending(requestId);
    if (pending && pending.lectureId !== lectureId) throw new LocalVaultError('INVALID_INPUT');
    if (!pending) {
      if (!await this.catalog.getLecture(lectureId)) throw new LocalVaultError('INVALID_INPUT');
      // Only native local camera results enter this boundary; never remote URLs.
      if (!sourceUri.startsWith('file://')) throw new LocalVaultError('INVALID_INPUT');
      const size = await this.files.size(sourceUri, true);
      validSize(size);
      const original = await this.checksum(sourceUri, true);
      if (original.bytes !== size) throw new LocalVaultError('FILE_CHANGED');
      const id = this.runtime.uuid(); validId(id);
      pending = { id, requestId, lectureId, sourceUri, bytes: size, sha256: original.sha256,
        path: `${VAULT_ROOT}/lectures/${lectureId}/originals/${id}.jpg`, createdAt: this.runtime.now() };
      await this.catalog.putPending(pending);
    }
    this.validatePath(pending);
    const stage = `${pending.path}.pending`;
    await this.files.prepareDirectory(`${VAULT_ROOT}/lectures/${lectureId}/originals`);
    if (await this.files.size(pending.path) === null) {
      if (await this.files.size(stage) === null) await this.files.copy(pending.sourceUri, stage);
      const staged = await this.checksum(stage);
      if (staged.bytes !== pending.bytes || staged.sha256 !== pending.sha256) throw new LocalVaultError('FILE_CHANGED');
      await this.files.rename(stage, pending.path);
    }
    await this.verify(pending);
    // Capture insert and pending removal are one SQLite transaction. Failures
    // preserve the final/staged original and its durable pending record.
    await this.catalog.commit(pending);
    const accepted = await this.catalog.getCaptureByRequest(requestId);
    if (!accepted || accepted.id !== pending.id || accepted.sha256 !== pending.sha256 || accepted.bytes !== pending.bytes) throw new LocalVaultError('LOCAL_SAVE_FAILED');
    const { sourceUri: _source, ...capture } = pending;
    return capture;
  }

  async openCapture(id: string) {
    validId(id);
    await this.initialize();
    const capture = await this.catalog.getCapture(id);
    if (!capture) throw new LocalVaultError('FILE_MISSING');
    await this.verify(capture);
    return { capture, uri: await this.files.uri(capture.path) };
  }

  async recoverPending() {
    await this.initialize();
    const result: { recovered: number; failed: number; remaining: number } = { recovered: 0, failed: 0, remaining: 0 };
    // Native catalog returns at most 20 records. Recovery has no disk deletion
    // or remote fallback, including when the camera temporary source is gone.
    for (const pending of await this.catalog.listPending()) {
      try { await this.savePhoto(pending.lectureId, pending.sourceUri, pending.requestId); result.recovered++; }
      catch { result.failed++; }
    }
    result.remaining = await this.catalog.pendingCount();
    return result;
  }
  async close() { await this.catalog.close(); this.initialization = undefined; }
}
