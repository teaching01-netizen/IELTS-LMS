import React from 'react';
import { Info } from 'lucide-react';
import type { ExamConfig } from '../../../types';

interface BasicInfoTabProps {
  config: ExamConfig;
  onChange: (config: ExamConfig) => void;
}

export function BasicInfoTab({ config, onChange }: BasicInfoTabProps) {
  const updateConfig = (section: keyof ExamConfig, value: Partial<ExamConfig[keyof ExamConfig]>) => {
    onChange({
      ...config,
      [section]: {
        ...config[section],
        ...value,
      },
    });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
          <Info size={16} className="text-blue-500" /> Basic Information
        </h3>
        <div className="grid grid-cols-1 gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Preset</label>
              <input
                type="text"
                value={config.general.preset}
                readOnly
                className="w-full px-3 py-2 bg-gray-100 border border-gray-200 rounded text-sm text-gray-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Standard Type</label>
              <select
                value={config.general.type}
                onChange={(e) => updateConfig('general', { type: e.target.value as 'Academic' | 'General Training' })}
                className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="Academic">Academic</option>
                <option value="General Training">General Training</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Exam Title</label>
            <input
              type="text"
              value={config.general.title}
              onChange={(e) => updateConfig('general', { title: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none font-medium"
              placeholder="e.g. Academic Practice Test 5"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Exam Summary</label>
            <textarea
              value={config.general.summary}
              onChange={(e) => updateConfig('general', { summary: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              rows={3}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Candidate Instructions</label>
            <textarea
              value={config.general.instructions}
              onChange={(e) => updateConfig('general', { instructions: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none h-40"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
