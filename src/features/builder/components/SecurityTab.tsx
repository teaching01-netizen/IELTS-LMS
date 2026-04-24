import React from 'react';
import { Shield, Settings, Lock, Info, AlertTriangle } from 'lucide-react';
import type { ExamConfig } from '../../../types';

interface SecurityTabProps {
  config: ExamConfig;
  onChange: (config: ExamConfig) => void;
}

export function SecurityTab({ config, onChange }: SecurityTabProps) {
  const updateConfig = (section: keyof ExamConfig, value: Partial<ExamConfig[keyof ExamConfig]>) => {
    onChange({
      ...config,
      [section]: {
        ...config[section],
        ...value
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Security Warning Banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-semibold text-amber-900 mb-1">Browser-Based Security Limitations</h4>
          <p className="text-xs text-amber-800 leading-relaxed">
            These measures provide deterrence and auditability but cannot guarantee complete security. 
            Browser JavaScript can be bypassed by technical users. For high-stakes exams, consider hybrid 
            approaches combining client-side monitoring with server-side validation and human proctor oversight. 
            See the security model documentation for details.
          </p>
        </div>
      </div>

      <section className="space-y-4">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
          <Shield size={16} className="text-blue-500" /> Proctoring Control
        </h3>
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
          <label className="p-4 border-b border-gray-50 flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-semibold text-gray-900">Fullscreen Warning</p>
              <p className="text-[10px] text-gray-500">Require fullscreen and warn if candidates exit it</p>
            </div>
            <input 
              type="checkbox" 
              aria-label="Fullscreen Warning"
              checked={config.security.requireFullscreen}
              onChange={(e) => updateConfig('security', { requireFullscreen: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </label>
          <div className="p-4 border-b border-gray-50 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Tab Switch Rule</p>
              <p className="text-[10px] text-gray-500">Behavior when candidate leaves the tab</p>
            </div>
            <select 
              value={config.security.tabSwitchRule}
              onChange={(e) => updateConfig('security', { tabSwitchRule: e.target.value as 'none' | 'warn' | 'terminate' })}
              className="text-xs border border-gray-200 rounded px-2 py-1 outline-none font-medium"
            >
              <option value="none">Allow Switches</option>
              <option value="warn">Warn (3 Threshold)</option>
              <option value="terminate">Immediate Terminate</option>
            </select>
          </div>
          <div className="p-4 border-b border-gray-50 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Auto Re-enter Fullscreen</p>
              <p className="text-[10px] text-gray-500">Automatically re-enter fullscreen on exit</p>
            </div>
            <input 
              type="checkbox" 
              checked={config.security.fullscreenAutoReentry}
              onChange={(e) => updateConfig('security', { fullscreenAutoReentry: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </div>
          <div className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Max Fullscreen Violations</p>
              <p className="text-[10px] text-gray-500">Terminate after this many violations</p>
            </div>
            <input 
              type="number" 
              min={1}
              max={10}
              value={config.security.fullscreenMaxViolations}
              onChange={(e) => updateConfig('security', { fullscreenMaxViolations: parseInt(e.target.value) })}
              className="w-16 px-2 py-1 border border-gray-200 rounded text-sm text-right outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>
      </section>

      <section className="space-y-4 pt-4 border-t border-gray-100">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
          <Settings size={16} className="text-blue-500" /> Screen Detection
        </h3>
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-gray-50 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Detect Secondary Screens</p>
              <p className="text-[10px] text-gray-500">Chrome 111+ only, requires user permission</p>
            </div>
            <input 
              type="checkbox" 
              checked={config.security.detectSecondaryScreen}
              onChange={(e) => updateConfig('security', { detectSecondaryScreen: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </div>
        </div>
      </section>

      <section className="space-y-4 pt-4 border-t border-gray-100">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
          <Lock size={16} className="text-blue-500" /> Input Field Protection
        </h3>
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-gray-50 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Prevent Autofill</p>
              <p className="text-[10px] text-gray-500">Disable browser autofill on all inputs</p>
            </div>
            <input 
              type="checkbox" 
              checked={config.security.preventAutofill}
              onChange={(e) => updateConfig('security', { preventAutofill: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </div>
          <div className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Prevent Autocorrect</p>
              <p className="text-[10px] text-gray-500">Disable autocorrect and autocapitalize</p>
            </div>
            <input 
              type="checkbox" 
              checked={config.security.preventAutocorrect}
              onChange={(e) => updateConfig('security', { preventAutocorrect: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </div>
          <label className="p-4 border-t border-gray-50 flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-semibold text-gray-900">Translation Warning</p>
              <p className="text-[10px] text-gray-500">Block page translation markers and warn when translation is detected</p>
            </div>
            <input 
              type="checkbox" 
              aria-label="Translation Warning"
              checked={config.security.preventTranslation !== false}
              onChange={(e) => updateConfig('security', { preventTranslation: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </label>
        </div>
      </section>

      <section className="space-y-4 pt-4 border-t border-gray-100">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
          <Settings size={16} className="text-blue-500" /> Device Access
        </h3>
        <div className="grid grid-cols-1 gap-3">
          {[
            { key: 'webcam', label: 'Webcam Monitoring', icon: Info },
            { key: 'audio', label: 'Continuous Audio Recording', icon: Info },
            { key: 'screen', label: 'Remote Screen Monitoring', icon: Info },
          ].map((flag) => (
            <div key={flag.key} className="bg-white border border-gray-100 p-4 rounded-xl shadow-sm flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">{flag.label}</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={config.security.proctoringFlags[flag.key as keyof typeof config.security.proctoringFlags] || false}
                  onChange={(e) => {
                    const newFlags = { ...config.security.proctoringFlags, [flag.key]: e.target.checked };
                    updateConfig('security', { proctoringFlags: newFlags });
                  }}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
