import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Filesystem } from '@capacitor/filesystem';
import { MAX_PHOTO_BYTES, VAULT_ROOT } from '@smartbord/local-library';
import { NativeFiles } from './native-vault';

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Library: 'LIBRARY' },
  Filesystem: { stat: vi.fn(), readFile: vi.fn(), copy: vi.fn(), mkdir: vi.fn() },
}));

const path = `${VAULT_ROOT}/lectures/00000000-0000-4000-8000-000000000001/originals/test.jpg`;
function stat(size: number) { return { name: 'test.jpg', type: 'file' as const, size, uri: 'file:///synthetic-vault/test.jpg', ctime: 0, mtime: 0 }; }

describe('native file adapter (mocked SDK, not physical storage evidence)', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it('rejects an oversized staged/original file before requesting its base64 bytes', async () => {
    vi.mocked(Filesystem.stat).mockResolvedValue(stat(MAX_PHOTO_BYTES + 1));
    await expect(new NativeFiles().read(path)).rejects.toMatchObject({ code: 'PHOTO_TOO_LARGE' });
    expect(Filesystem.readFile).not.toHaveBeenCalled();
  });
  it('checks the decoded byte count against native stat before accepting a read', async () => {
    vi.mocked(Filesystem.stat).mockResolvedValue(stat(4));
    vi.mocked(Filesystem.readFile).mockResolvedValue({ data: btoa('abc') });
    await expect(new NativeFiles().read(path)).rejects.toMatchObject({ code: 'FILE_CHANGED' });
  });
  it('uses Library for originals and an exact local URI for the native camera result', async () => {
    vi.mocked(Filesystem.stat).mockResolvedValue(stat(3));
    vi.mocked(Filesystem.readFile).mockResolvedValue({ data: btoa('abc') });
    const files = new NativeFiles();
    expect(await files.read(path)).toEqual(new Uint8Array([97, 98, 99]));
    expect(Filesystem.readFile).toHaveBeenLastCalledWith({ path, directory: 'LIBRARY' });
    await files.read('file:///synthetic-camera-cache/test.jpg', true);
    expect(Filesystem.readFile).toHaveBeenLastCalledWith({ path: 'file:///synthetic-camera-cache/test.jpg' });
    await expect(files.read('https://example.test/private.jpg', true)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(files.read(`${VAULT_ROOT}/lectures/../../outside.jpg`)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
