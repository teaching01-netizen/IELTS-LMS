import { logger } from '../utils/logger';
import { isBackendGradingEnabled } from './backendBridge';

export async function seedDevelopmentFixtures() {
  if (!import.meta.env.DEV) {
    return;
  }

  if (isBackendGradingEnabled()) {
    return;
  }

  const { seedGradingData } = await import('../utils/gradingSeedData');
  try {
    await seedGradingData();
  } catch (error) {
    logger.warn(
      'Optional development grading fixtures were not seeded; continuing without them.',
      error,
    );
  }
}
