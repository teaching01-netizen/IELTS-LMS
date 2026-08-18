import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import { shouldOfferTimeExtension } from '../timeExtensionPolicy';

describe('shouldOfferTimeExtension', () => {
  it('does not offer an extension when +5 is not allowed', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.delivery.allowedExtensionMinutes = [10];

    expect(
      shouldOfferTimeExtension({
        config,
        phase: 'exam',
        runtimeBacked: false,
        displayTimeRemaining: 300,
      }),
    ).toBe(false);
  });

  it('offers an extension at 5 minutes remaining when +5 is allowed', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.delivery.allowedExtensionMinutes = [5, 10];

    expect(
      shouldOfferTimeExtension({
        config,
        phase: 'exam',
        runtimeBacked: false,
        displayTimeRemaining: 300,
      }),
    ).toBe(true);
  });

  it('still offers an extension when the 5-minute mark is skipped (e.g. 4:40 remaining)', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.delivery.allowedExtensionMinutes = [5, 10];

    expect(
      shouldOfferTimeExtension({
        config,
        phase: 'exam',
        runtimeBacked: false,
        displayTimeRemaining: 280,
      }),
    ).toBe(true);
  });

  it('does not offer an extension once time has expired', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.delivery.allowedExtensionMinutes = [5, 10];

    expect(
      shouldOfferTimeExtension({
        config,
        phase: 'exam',
        runtimeBacked: false,
        displayTimeRemaining: 0,
      }),
    ).toBe(false);
  });
});
