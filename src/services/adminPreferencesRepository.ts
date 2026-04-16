import { createDefaultConfig } from '../constants/examDefaults';
import type { ExamConfig } from '../types';

const STORAGE_KEY_DEFAULTS = 'ielts_defaults';

class AdminPreferencesRepository {
  getDefaults(): ExamConfig {
    const saved = localStorage.getItem(STORAGE_KEY_DEFAULTS);
    return saved
      ? (JSON.parse(saved) as ExamConfig)
      : createDefaultConfig('Academic', 'Academic');
  }

  saveDefaults(config: ExamConfig) {
    localStorage.setItem(STORAGE_KEY_DEFAULTS, JSON.stringify(config));
  }
}

export const adminPreferencesRepository = new AdminPreferencesRepository();
