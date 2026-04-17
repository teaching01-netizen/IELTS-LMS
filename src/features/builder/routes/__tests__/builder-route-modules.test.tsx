import { describe, expect, it } from 'vitest';

describe('builder route modules', () => {
  it('exports the config and review route components used by lazy routing', async () => {
    const [configModule, reviewModule] = await Promise.all([
      import('../ExamConfigRoute'),
      import('../ExamReviewRoute'),
    ]);

    expect(configModule.ExamConfigRoute).toBeTypeOf('function');
    expect(reviewModule.ExamReviewRoute).toBeTypeOf('function');
  });
});
