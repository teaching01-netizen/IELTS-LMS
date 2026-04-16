import React, { useState } from 'react';
import {
  Settings,
  Plus,
  Trash2,
  AlertTriangle,
  Play,
  Pause,
  XCircle,
  Bell,
  X,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { ViolationRule, ViolationTriggerType, ViolationAutoAction, ViolationSeverity } from '../../types';
import { Badge } from '../ui/Badge';

interface ViolationRulePanelProps {
  rules: ViolationRule[];
  scheduleId: string;
  currentProctor: string;
  onUpdateRules: (rules: ViolationRule[]) => void;
  onClose: () => void;
}

export function ViolationRulePanel({ rules, scheduleId, currentProctor, onUpdateRules, onClose }: ViolationRulePanelProps) {
  const [showNewRule, setShowNewRule] = useState(false);
  const [newRule, setNewRule] = useState<Partial<ViolationRule>>({
    scheduleId,
    triggerType: 'violation_count',
    threshold: 3,
    action: 'warn',
    isEnabled: true,
    createdAt: new Date().toISOString(),
    createdBy: currentProctor
  });

  const actionIcons: Record<ViolationAutoAction, React.ElementType> = {
    warn: AlertTriangle,
    pause: Pause,
    notify_proctor: Bell,
    terminate: XCircle
  };

  const actionColors: Record<ViolationAutoAction, string> = {
    warn: 'bg-amber-100 text-amber-800 border-amber-200',
    pause: 'bg-blue-100 text-blue-800 border-blue-200',
    notify_proctor: 'bg-purple-100 text-purple-800 border-purple-200',
    terminate: 'bg-red-100 text-red-800 border-red-200'
  };

  const handleSaveRule = () => {
    if (!newRule.triggerType || !newRule.action || newRule.threshold === undefined) return;

    const rule: ViolationRule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      scheduleId,
      triggerType: newRule.triggerType,
      threshold: newRule.threshold,
      specificViolationType: newRule.specificViolationType,
      specificSeverity: newRule.specificSeverity,
      action: newRule.action,
      isEnabled: newRule.isEnabled ?? true,
      createdAt: new Date().toISOString(),
      createdBy: currentProctor
    };

    onUpdateRules([...rules, rule]);
    setShowNewRule(false);
    setNewRule({
      scheduleId,
      triggerType: 'violation_count',
      threshold: 3,
      action: 'warn',
      isEnabled: true,
      createdAt: new Date().toISOString(),
      createdBy: currentProctor
    });
  };

  const handleDeleteRule = (ruleId: string) => {
    const updatedRules = rules.filter(rule => rule.id !== ruleId);
    onUpdateRules(updatedRules);
  };

  const handleToggleRule = (ruleId: string) => {
    const updatedRules = rules.map(rule =>
      rule.id === ruleId ? { ...rule, isEnabled: !rule.isEnabled } : rule
    );
    onUpdateRules(updatedRules);
  };

  const getRuleDescription = (rule: ViolationRule) => {
    switch (rule.triggerType) {
      case 'violation_count':
        return `When violations reach ${rule.threshold}`;
      case 'specific_violation_type':
        return `When ${rule.specificViolationType} occurs ${rule.threshold} times`;
      case 'severity_threshold':
        return `When ${rule.specificSeverity} violations reach ${rule.threshold}`;
      default:
        return 'Unknown trigger';
    }
  };

  const activeRulesCount = rules.filter(r => r.isEnabled).length;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Auto-Response Rules</h2>
            <p className="text-sm text-gray-500 mt-1">
              {activeRulesCount} active of {rules.length} total rules
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-md transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <button
          onClick={() => setShowNewRule(!showNewRule)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          New Rule
        </button>
      </div>

      {/* New Rule Form */}
      {showNewRule && (
        <div className="p-4 bg-gray-50 border-b border-gray-200">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                Trigger Type
              </label>
              <select
                value={newRule.triggerType}
                onChange={(e) => setNewRule({ ...newRule, triggerType: e.target.value as ViolationTriggerType })}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="violation_count">Violation Count</option>
                <option value="specific_violation_type">Specific Violation Type</option>
                <option value="severity_threshold">Severity Threshold</option>
              </select>
            </div>

            {newRule.triggerType === 'specific_violation_type' && (
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Violation Type
                </label>
                <input
                  type="text"
                  value={newRule.specificViolationType || ''}
                  onChange={(e) => setNewRule({ ...newRule, specificViolationType: e.target.value })}
                  placeholder="e.g., SCREEN_CAPTURE, TAB_SWITCH"
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            {newRule.triggerType === 'severity_threshold' && (
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Severity Level
                </label>
                <select
                  value={newRule.specificSeverity || 'medium'}
                  onChange={(e) => setNewRule({ ...newRule, specificSeverity: e.target.value as ViolationSeverity })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                Threshold
              </label>
              <input
                type="number"
                min="1"
                value={newRule.threshold}
                onChange={(e) => setNewRule({ ...newRule, threshold: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                Action
              </label>
              <select
                value={newRule.action}
                onChange={(e) => setNewRule({ ...newRule, action: e.target.value as ViolationAutoAction })}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="warn">Warn Student</option>
                <option value="pause">Pause Session</option>
                <option value="notify_proctor">Notify Proctor</option>
                <option value="terminate">Terminate Session</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={newRule.isEnabled ?? true}
                onChange={(e) => setNewRule({ ...newRule, isEnabled: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label className="text-sm text-gray-700">Enable rule immediately</label>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNewRule(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRule}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Save Rule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rules List */}
      <div className="flex-1 overflow-y-auto">
        {rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <Settings size={48} className="mb-4 opacity-20" />
            <p className="text-lg font-medium">No rules configured</p>
            <p className="text-sm">Create rules to automatically respond to violations</p>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {rules.map(rule => {
              const ActionIcon = actionIcons[rule.action];
              return (
                <div
                  key={rule.id}
                  className={`p-4 rounded-lg border ${
                    rule.isEnabled ? 'bg-white border-gray-200 shadow-sm' : 'bg-gray-50 border-gray-200 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Badge className={actionColors[rule.action]}>
                        <div className="flex items-center gap-1">
                          <ActionIcon size={12} />
                          {rule.action.replace('_', ' ')}
                        </div>
                      </Badge>
                      {!rule.isEnabled && (
                        <span className="px-2 py-1 bg-gray-200 text-gray-600 text-xs font-bold rounded-full">
                          DISABLED
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleRule(rule.id)}
                        className={`p-1.5 rounded-md transition-colors ${
                          rule.isEnabled
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                        title={rule.isEnabled ? 'Disable rule' : 'Enable rule'}
                      >
                        {rule.isEnabled ? <Play size={16} /> : <Pause size={16} />}
                      </button>
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-1.5 text-gray-400 hover:bg-red-100 hover:text-red-700 rounded-md transition-colors"
                        title="Delete rule"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <p className="text-sm font-medium text-gray-900 mb-2">{getRuleDescription(rule)}</p>

                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center gap-3">
                      <span>Created by {rule.createdBy}</span>
                    </div>
                    <span>{new Date(rule.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
