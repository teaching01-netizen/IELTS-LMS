import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../constants/examDefaults';
import { examDeliveryService } from '../examDeliveryService';

describe('Phase 03 ACT reconciliation: examDeliveryService', () => {
  it('includes the enabled science section in the runtime section plan', () => {
    const config = createDefaultConfig('ACT', 'ACT Science');
    expect(config.sections.science.enabled).toBe(true);
    const plan = examDeliveryService.buildSectionPlan(config);
    expect(plan.sections.map((section) => section.sectionKey)).toContain('science');
    expect(plan.plannedDurationMinutes).toBeGreaterThan(0);
  });

  it('leaves IELTS section plans without science', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const plan = examDeliveryService.buildSectionPlan(config);
    expect(plan.sections.map((section) => section.sectionKey)).not.toContain('science');
  });
});
