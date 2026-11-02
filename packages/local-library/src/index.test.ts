import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LocalLibrary, LocalVaultError, MAX_PHOTO_BYTES, type Capture, type CatalogPort, type FilePort, type Lecture, type PendingSave } from './index';

class MemoryCatalog implements CatalogPort {
  lectures = new Map<string, Lecture>(); captures = new Map<string, Capture>(); pending = new Map<string, PendingSave>();
  failCommit = false;
  async open() {} async close() {}
  async createLecture(value: Lecture) { this.lectures.set(value.id, value); }
  async getLecture(id: string) { return this.lectures.get(id) ?? null; }
  async listLectures(page: number) { return { items: [...this.lectures.values()], page, pageSize: 30, total: this.lectures.size }; }
  async getCaptureByRequest(id: string) { return [...this.captures.values()].find(value => value.requestId === id) ?? null; }
  async getCapture(id: string) { return this.captures.get(id) ?? null; }
  async listCaptures(id: string, page: number) { const items = [...this.captures.values()].filter(value => value.lectureId === id); return { items, page, pageSize: 30, total: items.length }; }
  async getPending(id: string) { return this.pending.get(id) ?? null; }
  async listPending() { return [...this.pending.values()].slice(0, 20); }
  async pendingCount() { return this.pending.size; }
  async putPending(value: PendingSave) { this.pending.set(value.requestId, value); }
  async commit(value: PendingSave) {
    if (this.failCommit) throw new Error('Synthetic SQLite commit failure');
    if ([...this.captures.values()].some(capture => capture.requestId === value.requestId)) throw new Error('duplicate');
    const { sourceUri: _source, ...capture } = value;
    this.captures.set(value.id, capture); this.pending.delete(value.requestId);
  }
}
class MemoryFiles implements FilePort {
  data = new Map<string, Uint8Array>(); sizes = new Map<string, number>();
  failCopy = false; failRename = false; partialCopy = false; copies = 0; reads = 0;
  async prepareDirectory() {}
  async size(path: string) { return this.sizes.get(path) ?? this.data.get(path)?.length ?? null; }
  async copy(source: string, path: string) {
    this.copies++;
    if (this.failCopy) throw new Error('ENOSPC: synthetic storage full');
    const bytes = this.data.get(source); if (!bytes) throw new LocalVaultError('FILE_MISSING');
    this.data.set(path, this.partialCopy ? bytes.slice(0, 2) : bytes.slice());
  }
  async rename(from: string, to: string) {
    if (this.failRename) throw new Error('synthetic interrupted rename');
    if (this.data.has(to)) throw new Error('refuse overwrite');
    const bytes = this.data.get(from); if (!bytes) throw new LocalVaultError('FILE_MISSING');
    this.data.set(to, bytes); this.data.delete(from);
  }
  async read(path: string) { this.reads++; const bytes = this.data.get(path); if (!bytes) throw new LocalVaultError('FILE_MISSING'); return bytes.slice(); }
  async uri(path: string) { return `file:///synthetic-owned-vault/${path}`; }
}
const syntheticBytes = new TextEncoder().encode('explicit synthetic unit-test bytes; not a physical camera fixture');
const runtime = { uuid: randomUUID, now: () => '2026-11-02T00:00:00.000Z', hash: async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex') };
async function fixture() {
  const catalog = new MemoryCatalog(), files = new MemoryFiles();
  const source = 'file:///synthetic-camera-cache/image.jpg'; files.data.set(source, syntheticBytes.slice());
  const library = new LocalLibrary(catalog, files, runtime);
  const lecture = await library.createLecture('Synthetic lecture');
  return { library, catalog, files, source, lecture, request: randomUUID() };
}

describe('local save protocol (synthetic ports, not phone acceptance)', () => {
  it('preserves the source bytes, commits a checked original and reopens after cache loss and service restart', async () => {
    const f = await fixture();
    const saved = await f.library.savePhoto(f.lecture.id, f.source, f.request);
    expect(f.files.data.get(f.source)).toEqual(syntheticBytes);
    expect(f.files.data.get(saved.path)).toEqual(syntheticBytes);
    expect(saved.sha256).toBe(createHash('sha256').update(syntheticBytes).digest('hex'));
    expect(f.catalog.pending.size).toBe(0);
    f.files.data.delete(f.source);
    const reopened = new LocalLibrary(f.catalog, f.files, runtime);
    expect((await reopened.openCapture(saved.id)).capture).toEqual(saved);
    expect((await reopened.listLectures()).total).toBe(1);
    expect((await reopened.listCaptures(f.lecture.id)).total).toBe(1);
  });
  it('coalesces duplicate in-flight and later requests without another file or catalog row', async () => {
    const f = await fixture();
    const first = f.library.savePhoto(f.lecture.id, f.source, f.request);
    const duplicate = f.library.savePhoto(f.lecture.id, f.source, f.request);
    expect(first).toBe(duplicate);
    await expect(f.library.savePhoto(randomUUID(), f.source, f.request)).rejects.toMatchObject({ code: 'CAPTURE_BUSY' });
    const saved = await first;
    expect(await f.library.savePhoto(f.lecture.id, f.source, f.request)).toEqual(saved);
    expect(f.files.copies).toBe(1); expect(f.catalog.captures.size).toBe(1);
  });
  it('bounds work to one distinct save and rejects another while hashing is in flight', async () => {
    const f = await fixture(); let ready!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const library = new LocalLibrary(f.catalog, f.files, { ...runtime, hash: async bytes => { ready(); await gate; return runtime.hash(bytes); } });
    const first = library.savePhoto(f.lecture.id, f.source, f.request);
    await started;
    try { await expect(library.savePhoto(f.lecture.id, f.source, randomUUID())).rejects.toMatchObject({ code: 'CAPTURE_BUSY' }); }
    finally { release(); }
    await first; expect(f.catalog.captures.size).toBe(1);
  });
  it('reports disk-full failure without accepted metadata or original deletion, and retries the same request', async () => {
    const f = await fixture(); f.files.failCopy = true;
    await expect(f.library.savePhoto(f.lecture.id, f.source, f.request)).rejects.toMatchObject({ code: 'DEVICE_STORAGE_FULL' });
    expect(f.catalog.captures.size).toBe(0); expect(f.catalog.pending.size).toBe(1);
    expect(f.files.data.get(f.source)).toEqual(syntheticBytes);
    f.files.failCopy = false;
    expect((await f.library.savePhoto(f.lecture.id, f.source, f.request)).requestId).toBe(f.request);
    expect(f.catalog.captures.size).toBe(1);
  });
  it('recovers a final file left by a failed catalog commit even after the camera cache is gone', async () => {
    const f = await fixture(); f.catalog.failCommit = true;
    await expect(f.library.savePhoto(f.lecture.id, f.source, f.request)).rejects.toMatchObject({ code: 'LOCAL_SAVE_FAILED' });
    const pending = f.catalog.pending.get(f.request)!;
    expect(f.files.data.has(pending.path)).toBe(true); expect(f.catalog.captures.size).toBe(0);
    f.files.data.delete(f.source); f.catalog.failCommit = false;
    const restarted = new LocalLibrary(f.catalog, f.files, runtime);
    expect(await restarted.recoverPending()).toEqual({ recovered: 1, failed: 0, remaining: 0 });
    expect((await restarted.openCapture(pending.id)).capture.requestId).toBe(f.request);
  });
  it('recovers a checked stage after interruption before rename, preserving the original request ID', async () => {
    const f = await fixture(); f.files.failRename = true;
    await expect(f.library.savePhoto(f.lecture.id, f.source, f.request)).rejects.toMatchObject({ code: 'LOCAL_SAVE_FAILED' });
    const pending = f.catalog.pending.get(f.request)!;
    expect(f.files.data.has(`${pending.path}.pending`)).toBe(true);
    f.files.data.delete(f.source); f.files.failRename = false;
    const restarted = new LocalLibrary(f.catalog, f.files, runtime);
    expect((await restarted.recoverPending()).recovered).toBe(1);
    expect(f.catalog.captures.size).toBe(1); expect(f.files.copies).toBe(1);
  });
  it('never promotes, overwrites or deletes a partial stage or altered original', async () => {
    const f = await fixture(); f.files.partialCopy = true;
    await expect(f.library.savePhoto(f.lecture.id, f.source, f.request)).rejects.toMatchObject({ code: 'FILE_CHANGED' });
    const pending = f.catalog.pending.get(f.request)!;
    expect(f.catalog.captures.size).toBe(0); expect(f.files.data.has(`${pending.path}.pending`)).toBe(true);
    expect(await new LocalLibrary(f.catalog, f.files, runtime).recoverPending()).toEqual({ recovered: 0, failed: 1, remaining: 1 });
    expect(f.files.data.get(f.source)).toEqual(syntheticBytes);
  });
  it('reports local deletion or corruption without fetching or replacing a recorded original', async () => {
    const f = await fixture(); const saved = await f.library.savePhoto(f.lecture.id, f.source, f.request);
    const changed = syntheticBytes.slice(); changed[0] ^= 1; f.files.data.set(saved.path, changed);
    await expect(f.library.openCapture(saved.id)).rejects.toMatchObject({ code: 'FILE_CHANGED' });
    f.files.data.delete(saved.path);
    await expect(f.library.openCapture(saved.id)).rejects.toMatchObject({ code: 'FILE_MISSING' });
    await expect(f.library.savePhoto(f.lecture.id, f.source, f.request)).rejects.toMatchObject({ code: 'FILE_MISSING' });
    expect(f.files.copies).toBe(1); expect(f.catalog.captures.size).toBe(1);
  });
  it('rejects oversized sources before reading them and refuses remote URLs or catalog path traversal', async () => {
    const f = await fixture(); f.files.sizes.set(f.source, MAX_PHOTO_BYTES + 1);
    await expect(f.library.savePhoto(f.lecture.id, f.source, f.request)).rejects.toMatchObject({ code: 'PHOTO_TOO_LARGE' });
    expect(f.files.reads).toBe(0); expect(f.catalog.pending.size).toBe(0);
    await expect(f.library.savePhoto(f.lecture.id, 'https://example.test/image.jpg', randomUUID())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    f.catalog.pending.set(f.request, { id: randomUUID(), requestId: f.request, lectureId: f.lecture.id, sourceUri: f.source,
      path: '../../outside.jpg', bytes: 4, sha256: '0'.repeat(64), createdAt: runtime.now() });
    await expect(f.library.savePhoto(f.lecture.id, f.source, f.request)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(f.files.copies).toBe(0);
  });
  it('keeps pending records when all recoverable file sources are missing', async () => {
    const f = await fixture(); f.files.failCopy = true;
    await expect(f.library.savePhoto(f.lecture.id, f.source, f.request)).rejects.toThrow();
    f.files.failCopy = false; f.files.data.clear();
    expect(await new LocalLibrary(f.catalog, f.files, runtime).recoverPending()).toEqual({ recovered: 0, failed: 1, remaining: 1 });
    expect(f.catalog.captures.size).toBe(0); expect(f.catalog.pending.size).toBe(1);
  });
});
