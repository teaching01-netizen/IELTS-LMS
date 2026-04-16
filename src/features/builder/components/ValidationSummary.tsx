import React from 'react';
import { CheckCircle2, AlertCircle, Circle, Info } from 'lucide-react';
import type { PublishReadiness } from '../../../types/domain';
import type { ValidationScope } from '../../../types';

interface ValidationSummaryProps {
  publishReadiness: PublishReadiness;
  validationScope?: ValidationScope;
  onScheduleClick?: () => void;
  onNavigateToConfig?: () => void;
  onNavigateToBuilder?: () => void;
}

export function ValidationSummary({ 
  publishReadiness, 
  validationScope,
  onScheduleClick,
  onNavigateToConfig,
  onNavigateToBuilder
}: ValidationSummaryProps) {
  const defaultValidationScope: ValidationScope = {
    checked: [
      'All questions have correct answers',
      'Scoring tables match IELTS band conversions',
      'Time allocations are within acceptable ranges',
      'Question types match module requirements',
      'Required fields are populated',
      'Module configurations are valid'
    ],
    notChecked: [
      'Content quality and appropriateness',
      'Passage difficulty level',
      'Distractor quality',
      'Alignment with learning objectives'
    ]
  };

  const scope = validationScope || defaultValidationScope;

  return (
    <div className="space-y-4" role="status" aria-live="polite">
      {/* Technical Validation Status */}
      <div className={`flex items-center gap-3 p-4 rounded-xl border ${
        publishReadiness.canPublish ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
      }`}>
        {publishReadiness.canPublish ? (
          <CheckCircle2 size={20} className="text-emerald-600" aria-hidden="true" />
        ) : (
          <AlertCircle size={20} className="text-amber-600" aria-hidden="true" />
        )}
        <div>
          <p className={`text-sm font-semibold ${
            publishReadiness.canPublish ? 'text-emerald-900' : 'text-amber-900'
          }`}>
            {publishReadiness.canPublish ? 'Technical Validation Passed' : 'Technical Validation Issues'}
          </p>
          <p className="text-xs text-slate-600">
            {publishReadiness.canPublish 
              ? 'All technical checks passed. Content review and scheduling still required.'
              : `${publishReadiness.errors.filter(e => e.severity === 'error').length} error(s) must be fixed before publishing.`
            }
          </p>
        </div>
      </div>

      {/* Validation Scope - Checked Items */}
      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200" title="Technical checks performed automatically">
        <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-600" aria-hidden="true" />
          Checked:
        </p>
        <ul className="space-y-1.5" role="list">
          {scope.checked.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2 text-xs text-slate-600">
              <CheckCircle2 size={12} className="text-emerald-500 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Validation Scope - Not Checked Items */}
      <div className="p-4 bg-blue-50 rounded-xl border border-blue-200" title="Items requiring manual review by content experts">
        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-2 flex items-center gap-2">
          <Circle size={14} className="text-blue-600" aria-hidden="true" />
          Not checked:
        </p>
        <ul className="space-y-1.5" role="list">
          {scope.notChecked.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2 text-xs text-slate-600">
              <Circle size={12} className="text-blue-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Next Steps Guidance */}
      <div className="flex items-start gap-2 p-3 bg-sky-50 rounded-lg border border-sky-100">
        <Info size={14} className="text-sky-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <p className="text-xs text-sky-900">
          <span className="font-semibold">Next steps:</span> Review content quality, then schedule and publish.
        </p>
      </div>

      {/* Errors Section */}
      {publishReadiness.errors.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-red-700 uppercase tracking-wider">Errors</p>
          {publishReadiness.errors.map((error, idx) => (
            <div key={idx} className="flex items-start gap-2 p-3 bg-red-50 rounded-lg border border-red-100">
              <AlertCircle size={14} className="text-red-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="text-xs font-medium text-red-900">{error.message}</p>
                <p className="text-[10px] text-red-600 capitalize">Field: {error.field}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Warnings Section */}
      {publishReadiness.warnings.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Warnings</p>
          {publishReadiness.warnings.map((warning, idx) => (
            <div key={idx} className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg border border-amber-100">
              <AlertCircle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="text-xs font-medium text-amber-900">{warning.message}</p>
                <p className="text-[10px] text-amber-600 capitalize">Field: {warning.field}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Content Summary */}
      <div className="pt-4 border-t border-slate-100">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Content Summary</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-3 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-lg font-bold text-slate-900">{publishReadiness.questionCounts.reading}</p>
            <p className="text-[10px] font-medium text-slate-500 uppercase">Reading</p>
          </div>
          <div className="text-center p-3 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-lg font-bold text-slate-900">{publishReadiness.questionCounts.listening}</p>
            <p className="text-[10px] font-medium text-slate-500 uppercase">Listening</p>
          </div>
          <div className="text-center p-3 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-lg font-bold text-slate-900">{publishReadiness.questionCounts.total}</p>
            <p className="text-[10px] font-medium text-slate-500 uppercase">Total</p>
          </div>
        </div>
      </div>
    </div>
  );
}
