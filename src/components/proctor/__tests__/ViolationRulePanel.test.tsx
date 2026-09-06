import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViolationRulePanel } from '../ViolationRulePanel';
import type { ViolationRule } from '../../../types';

const { saveViolationRule, deleteViolationRule } = vi.hoisted(() => ({
  saveViolationRule: vi.fn(),
  deleteViolationRule: vi.fn(),
}));

// The panel lazy-imports the repository through the proctor gateway on every
// mutation; stub just that seam so persistence resolves without the backend.
vi.mock('../../../features/proctor/infrastructure/proctorGateway', () => ({
  examRepository: { saveViolationRule, deleteViolationRule },
}));

function makeRule(overrides: Partial<ViolationRule> = {}): ViolationRule {
  return {
    id: 'rule-1',
    scheduleId: 'sched-1',
    triggerType: 'violation_count',
    threshold: 3,
    action: 'warn',
    isEnabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'Proctor A',
    ...overrides,
  };
}

interface PanelOverrides {
  rules?: ViolationRule[];
  scheduleId?: string;
  currentProctor?: string;
  violationCounts?: { low: number; medium: number; high: number; critical: number };
  severityThresholds?: { lowLimit: number; mediumLimit: number; highLimit: number };
}

function renderPanel(overrides: PanelOverrides = {}) {
  const onUpdateRules = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <ViolationRulePanel
      rules={overrides.rules ?? []}
      scheduleId={overrides.scheduleId ?? 'sched-1'}
      currentProctor={overrides.currentProctor ?? 'Proctor A'}
      onUpdateRules={onUpdateRules}
      onClose={onClose}
      violationCounts={overrides.violationCounts}
      severityThresholds={overrides.severityThresholds}
    />,
  );
  return { onUpdateRules, onClose, ...utils };
}

function openNewRuleForm() {
  fireEvent.click(screen.getByRole('button', { name: /new rule/i }));
  expect(screen.getByLabelText('Rule trigger type')).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  saveViolationRule.mockResolvedValue(undefined);
  deleteViolationRule.mockResolvedValue(undefined);
});

describe('ViolationRulePanel', () => {
  it('renders the empty state with minimal props', () => {
    renderPanel();

    expect(screen.getByText('Auto-Response Rules')).toBeInTheDocument();
    expect(screen.getByText('0 active of 0 total rules')).toBeInTheDocument();
    expect(screen.getByText('No rules configured')).toBeInTheDocument();
    expect(
      screen.getByText('Create rules to automatically respond to violations'),
    ).toBeInTheDocument();
  });

  it('calls onClose from the header close button', () => {
    const { onClose } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Close auto-response rules' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders each rule description variant and the active/total count', () => {
    const rules = [
      makeRule({ id: 'r1', triggerType: 'violation_count', threshold: 3, action: 'warn' }),
      makeRule({
        id: 'r2',
        triggerType: 'specific_violation_type',
        threshold: 2,
        specificViolationType: 'TAB_SWITCH',
        action: 'pause',
      }),
      makeRule({
        id: 'r3',
        triggerType: 'severity_threshold',
        threshold: 1,
        specificSeverity: 'high',
        action: 'notify_proctor',
        isEnabled: false,
      }),
    ];
    const { container } = renderPanel({ rules });

    expect(screen.getByText('When violations reach 3')).toBeInTheDocument();
    expect(screen.getByText('When TAB_SWITCH occurs 2 times')).toBeInTheDocument();
    expect(screen.getByText('When high violations reach 1')).toBeInTheDocument();
    expect(screen.getByText('2 active of 3 total rules')).toBeInTheDocument();
    expect(screen.getByText('DISABLED')).toBeInTheDocument();
    expect(screen.getByText('notify proctor')).toBeInTheDocument();
    expect(screen.getAllByText('Created by Proctor A')).toHaveLength(3);
    expect(container.querySelectorAll('[data-rule-item="true"]')).toHaveLength(3);
  });

  it('falls back to "Unknown trigger" for unrecognized trigger types', () => {
    const rule = makeRule({ triggerType: 'bogus' as ViolationRule['triggerType'] });
    renderPanel({ rules: [rule] });

    expect(screen.getByText('Unknown trigger')).toBeInTheDocument();
  });

  it('renders severity counts when counts and thresholds are provided', () => {
    renderPanel({
      rules: [makeRule()],
      violationCounts: { low: 2, medium: 1, high: 0, critical: 1 },
      severityThresholds: { lowLimit: 5, mediumLimit: 3, highLimit: 2 },
    });

    expect(screen.getByText('Violation Counts by Severity')).toBeInTheDocument();
    expect(screen.getByText('LOW')).toBeInTheDocument();
    expect(screen.getByText('MEDIUM')).toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeInTheDocument();
    expect(screen.getByText('CRITICAL')).toBeInTheDocument();
    expect(screen.getByText('Limit: 5')).toBeInTheDocument();
    expect(screen.getByText('Limit: 3')).toBeInTheDocument();
    expect(screen.getByText('Limit: 2')).toBeInTheDocument();
    expect(screen.getByText('Immediate')).toBeInTheDocument();
  });

  it('hides the severity counts section when counts or thresholds are missing', () => {
    const first = renderPanel();
    expect(screen.queryByText('Violation Counts by Severity')).not.toBeInTheDocument();
    first.unmount();

    renderPanel({ violationCounts: { low: 1, medium: 0, high: 0, critical: 0 } });
    expect(screen.queryByText('Violation Counts by Severity')).not.toBeInTheDocument();
  });

  it('toggles a rule off and persists the change', async () => {
    const rule = makeRule();
    const { onUpdateRules } = renderPanel({ rules: [rule] });

    fireEvent.click(screen.getByRole('button', { name: 'Disable rule' }));

    expect(onUpdateRules).toHaveBeenCalledTimes(1);
    expect(onUpdateRules).toHaveBeenCalledWith([{ ...rule, isEnabled: false }]);
    await waitFor(() =>
      expect(saveViolationRule).toHaveBeenCalledWith({ ...rule, isEnabled: false }),
    );
  });

  it('enables a disabled rule', async () => {
    const rule = makeRule({ isEnabled: false });
    const { onUpdateRules } = renderPanel({ rules: [rule] });

    fireEvent.click(screen.getByRole('button', { name: 'Enable rule' }));

    expect(onUpdateRules).toHaveBeenCalledWith([{ ...rule, isEnabled: true }]);
    await waitFor(() =>
      expect(saveViolationRule).toHaveBeenCalledWith({ ...rule, isEnabled: true }),
    );
  });

  it('deletes a rule and persists the deletion', async () => {
    const keep = makeRule({ id: 'rule-keep' });
    const remove = makeRule({ id: 'rule-remove' });
    const { onUpdateRules } = renderPanel({ rules: [keep, remove] });

    fireEvent.click(screen.getByRole('button', { name: 'Delete rule rule-remove' }));

    expect(onUpdateRules).toHaveBeenCalledWith([keep]);
    await waitFor(() => expect(deleteViolationRule).toHaveBeenCalledWith('rule-remove'));
    expect(saveViolationRule).not.toHaveBeenCalled();
  });

  it('closes the new-rule form without notifying when cancelled', () => {
    const { onUpdateRules } = renderPanel();
    openNewRuleForm();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Rule trigger type')).not.toBeInTheDocument();
    expect(onUpdateRules).not.toHaveBeenCalled();
  });

  it('creates a violation-count rule with edited threshold and action', async () => {
    const { onUpdateRules } = renderPanel();
    openNewRuleForm();

    fireEvent.change(screen.getByLabelText('Rule threshold'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Rule action'), { target: { value: 'terminate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Rule' }));

    await waitFor(() => expect(onUpdateRules).toHaveBeenCalledTimes(1));
    const created = onUpdateRules.mock.calls[0]?.[0] as ViolationRule[];
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      scheduleId: 'sched-1',
      triggerType: 'violation_count',
      threshold: 5,
      action: 'terminate',
      isEnabled: true,
      createdBy: 'Proctor A',
    });
    expect(created[0]?.id).toEqual(expect.any(String));
    await waitFor(() => expect(saveViolationRule).toHaveBeenCalledWith(created[0]));
    expect(screen.queryByLabelText('Rule trigger type')).not.toBeInTheDocument();
  });

  it('shows the violation-type field for specific-violation-type triggers and saves it', async () => {
    const { onUpdateRules } = renderPanel();
    openNewRuleForm();

    expect(screen.queryByLabelText('Specific violation type')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Rule trigger type'), {
      target: { value: 'specific_violation_type' },
    });
    fireEvent.change(screen.getByLabelText('Specific violation type'), {
      target: { value: 'TAB_SWITCH' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Rule' }));

    await waitFor(() => expect(onUpdateRules).toHaveBeenCalledTimes(1));
    const created = onUpdateRules.mock.calls[0]?.[0] as ViolationRule[];
    expect(created[0]).toMatchObject({
      triggerType: 'specific_violation_type',
      specificViolationType: 'TAB_SWITCH',
    });
  });

  it('shows the severity field for severity-threshold triggers and saves it', async () => {
    const { onUpdateRules } = renderPanel();
    openNewRuleForm();

    expect(screen.queryByLabelText('Specific severity')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Rule trigger type'), {
      target: { value: 'severity_threshold' },
    });
    fireEvent.change(screen.getByLabelText('Specific severity'), {
      target: { value: 'high' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Rule' }));

    await waitFor(() => expect(onUpdateRules).toHaveBeenCalledTimes(1));
    const created = onUpdateRules.mock.calls[0]?.[0] as ViolationRule[];
    expect(created[0]).toMatchObject({
      triggerType: 'severity_threshold',
      specificSeverity: 'high',
    });
  });

  it('rolls back and surfaces persist errors when saving fails', async () => {
    saveViolationRule.mockRejectedValueOnce(new Error('Network down'));
    const { onUpdateRules } = renderPanel();
    openNewRuleForm();

    fireEvent.click(screen.getByRole('button', { name: 'Save Rule' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Network down'));
    expect(onUpdateRules).toHaveBeenCalledTimes(2);
    expect(onUpdateRules).toHaveBeenLastCalledWith([]);
  });

  it('surfaces a generic message for non-Error persist failures', async () => {
    saveViolationRule.mockRejectedValueOnce('nope');
    renderPanel();
    openNewRuleForm();

    fireEvent.click(screen.getByRole('button', { name: 'Save Rule' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to save rule.'),
    );
  });
});
