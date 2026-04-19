import { describe, expect, it } from 'vitest';
import { extractGoogleDriveFileId, normalizeAudioUrl } from '../audioUrl';

describe('audioUrl', () => {
  it('normalizes google drive share links to direct download urls', () => {
    expect(
      normalizeAudioUrl('https://drive.google.com/file/d/1AbCDefG123456/view?usp=sharing'),
    ).toBe('https://drive.google.com/uc?export=download&id=1AbCDefG123456');
  });

  it('extracts drive file ids from common link formats', () => {
    expect(extractGoogleDriveFileId('https://drive.google.com/open?id=1AbCDefG123456')).toBe(
      '1AbCDefG123456',
    );
    expect(
      extractGoogleDriveFileId('https://drive.google.com/uc?export=download&id=1AbCDefG123456'),
    ).toBe('1AbCDefG123456');
  });

  it('leaves non-drive urls unchanged', () => {
    expect(normalizeAudioUrl('https://example.com/audio.mp3')).toBe('https://example.com/audio.mp3');
  });
});
