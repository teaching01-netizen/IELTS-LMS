import React from "react";
import { Info } from "lucide-react";
import { DEFAULT_ACT_EXAM_SUMMARY } from "../../../constants/examDefaults";
import type { ExamConfig, ExamType } from "../../../types";

interface BasicInfoTabProps {
  config: ExamConfig;
  onChange: (config: ExamConfig) => void;
}

export function BasicInfoTab({ config, onChange }: BasicInfoTabProps) {
  const updateConfig = (
    section: keyof ExamConfig,
    value: Partial<ExamConfig[keyof ExamConfig]>
  ) => {
    onChange({
      ...config,
      [section]: {
        ...config[section],
        ...value,
      },
    });
  };

  const updateExamType = (type: ExamType) => {
    if (type === "ACT") {
      const hasGeneratedDefaultSummary =
        config.general.summary === `Standard IELTS ${config.general.type} Exam` ||
        config.general.summary === "ACT Science Practice Test";

      onChange({
        ...config,
        general: {
          ...config.general,
          type,
          preset: "ACT Science",
          ieltsMode: false,
          ...(hasGeneratedDefaultSummary ? { summary: DEFAULT_ACT_EXAM_SUMMARY } : {}),
        },
        sections: {
          ...config.sections,
          listening: { ...config.sections.listening, enabled: false },
          reading: { ...config.sections.reading, enabled: false },
          writing: { ...config.sections.writing, enabled: false },
          speaking: { ...config.sections.speaking, enabled: false },
          science: { ...config.sections.science, enabled: true },
        },
      });
      return;
    }

    onChange({
      ...config,
      general: {
        ...config.general,
        type,
        preset: type,
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
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                Preset
              </label>
              <input
                type="text"
                value={config.general.preset}
                readOnly
                className="w-full px-3 py-2 bg-gray-100 border border-gray-200 rounded text-sm text-gray-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label
                htmlFor="exam-type"
                className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1"
              >
                Exam Type
              </label>
              <select
                id="exam-type"
                value={config.general.type}
                onChange={(e) => updateExamType(e.target.value as ExamType)}
                className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="Academic">Academic</option>
                <option value="General Training">General Training</option>
                <option value="ACT">ACT</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
              Exam Title
            </label>
            <input
              type="text"
              value={config.general.title}
              onChange={(e) => updateConfig("general", { title: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none font-medium"
              placeholder="e.g. Academic Practice Test 5"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
              Exam Summary
            </label>
            <textarea
              value={config.general.summary}
              onChange={(e) => updateConfig("general", { summary: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              rows={3}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
              Candidate Instructions
            </label>
            <textarea
              value={config.general.instructions}
              onChange={(e) => updateConfig("general", { instructions: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none h-40"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
