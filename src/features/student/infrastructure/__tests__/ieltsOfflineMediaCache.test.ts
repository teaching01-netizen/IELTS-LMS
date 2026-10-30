import { describe, expect, it } from 'vitest';
import {
  IeltsOfflineMediaError,
  cacheIeltsOfflineMedia,
  readIeltsOfflineMedia,
  sha256Hex,
} from '../ieltsOfflineMediaCache';
import { createFakeCaches, okFetch, testManifest } from './ieltsOfflineTestKit';

const bodies = { '/media/a.mp3': 'audio-bytes', 'https://cdn.example/i.png': 'image-bytes' };
const audioOk = async () => true;

async function reason(promise: Promise<unknown>) {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof IeltsOfflineMediaError ? error.reason : String(error);
  }
}

describe('IELTS offline media cache', () => {
  it('stores verified bytes and re-verifies them on read', async () => {
    const caches = createFakeCaches();
    const records = await cacheIeltsOfflineMedia('att-1', testManifest().media, { caches, fetchImpl: okFetch(bodies), probeAudio: audioOk });
    expect(records.map((r) => r.bytes)).toEqual([11, 11]);
    expect(records[0]!.sha256).toBe(await sha256Hex(new TextEncoder().encode('audio-bytes').buffer as ArrayBuffer));
    expect(await readIeltsOfflineMedia('att-1', records[0]!, caches)).not.toBeNull();
    caches.corrupt(`https://ielts-offline.invalid/rev-a/r-audio`);
    expect(await readIeltsOfflineMedia('att-1', records[0]!, caches)).toBeNull();
  });

  it('rejects opaque, missing, truncated, mismatched and undecodable media', async () => {
    const caches = createFakeCaches();
    const media = testManifest().media;
    expect(await reason(cacheIeltsOfflineMedia('a', media, { caches, fetchImpl: okFetch(bodies, { type: 'opaque' }), probeAudio: audioOk }))).toBe('opaque_response');
    expect(await reason(cacheIeltsOfflineMedia('a', media, { caches, fetchImpl: okFetch({}), probeAudio: audioOk }))).toBe('http_error');
    expect(await reason(cacheIeltsOfflineMedia('a', [{ ...media[0]!, bytes: 99 }], { caches, fetchImpl: okFetch(bodies), probeAudio: audioOk }))).toBe('size_mismatch');
    expect(await reason(cacheIeltsOfflineMedia('a', [{ ...media[0]!, sha256: '0'.repeat(64) }], { caches, fetchImpl: okFetch(bodies), probeAudio: audioOk }))).toBe('digest_mismatch');
    expect(await reason(cacheIeltsOfflineMedia('a', media, { caches, fetchImpl: okFetch(bodies), probeAudio: async () => false }))).toBe('undecodable');
    const truncated = (async () => new Response('abc', { headers: { 'content-length': '10' } })) as typeof fetch;
    expect(await reason(cacheIeltsOfflineMedia('a', [media[1]!], { caches, fetchImpl: truncated }))).toBe('size_mismatch');
  });

  it('honours cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await reason(
      cacheIeltsOfflineMedia('a', testManifest().media, { caches: createFakeCaches(), fetchImpl: okFetch(bodies), probeAudio: audioOk, signal: controller.signal }),
    );
    expect(result).toBe('cancelled');
  });
});
