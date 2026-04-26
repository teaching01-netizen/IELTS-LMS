import React from 'react';
import { X, Contrast } from 'lucide-react';
import { Button } from '../ui/Button';
import {
  getStudentFontSizeLabel,
  getStudentTypographyScale,
  type StudentFontSize,
} from './accessibilityScale';

interface AccessibilitySettingsProps {
  isOpen: boolean;
  onClose: () => void;
  fontSize: StudentFontSize;
  highContrast: boolean;
  onFontSizeChange: (size: StudentFontSize) => void;
  onHighContrastToggle: () => void;
}

export function AccessibilitySettings({ 
  isOpen, 
  onClose,
  fontSize,
  highContrast,
  onFontSizeChange, 
  onHighContrastToggle,
}: AccessibilitySettingsProps) {
  if (!isOpen) return null;

  const fontSizes = [
    {
      value: 'small' as const,
      label: getStudentFontSizeLabel('small'),
      preview: getStudentTypographyScale('small').previewFontSize,
      description: 'Compact for a fuller page view',
    },
    {
      value: 'normal' as const,
      label: getStudentFontSizeLabel('normal'),
      preview: getStudentTypographyScale('normal').previewFontSize,
      description: 'Balanced for most screens',
    },
    {
      value: 'large' as const,
      label: getStudentFontSizeLabel('large'),
      preview: getStudentTypographyScale('large').previewFontSize,
      description: 'Easier to read on iPad and desktop',
    },
  ];

  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="p-1.5 md:p-2 bg-purple-100 rounded-lg">
              <Contrast size={20} className="text-purple-600" />
            </div>
            <h2 className="text-lg md:text-xl font-bold text-gray-900">Accessibility</h2>
          </div>
          <button onClick={onClose} className="p-1.5 md:p-2 text-gray-500 hover:bg-gray-100 rounded-md transition-colors">
            <X size={18} />
          </button>
        </div>
        
        <div className="p-4 sm:p-6 space-y-4 md:space-y-6">
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">Font Size</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {fontSizes.map((size) => (
                <button
                  key={size.value}
                  onClick={() => onFontSizeChange(size.value)}
                  aria-pressed={fontSize === size.value}
                  data-testid={`font-size-option-${size.value}`}
                  className={`rounded-xl border-2 p-4 text-left transition-all ${
                    fontSize === size.value
                      ? 'bg-blue-50 border-blue-500 text-blue-900 shadow-sm ring-1 ring-blue-200'
                      : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                  style={{ fontSize: size.preview }}
                >
                  <span className="block text-[0.72rem] font-black uppercase tracking-[0.22em] text-gray-500">
                    {size.label}
                  </span>
                  <span
                    data-testid={`font-size-preview-${size.value}`}
                    className="mt-2 block font-serif text-gray-900"
                    style={{ fontSize: size.preview, lineHeight: 1.35 }}
                  >
                    The quick brown fox reads the passage comfortably.
                  </span>
                  <span className="mt-2 block text-[0.75rem] font-medium text-gray-600">
                    {size.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 mb-3">Display</h3>
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div>
                <div className="font-medium text-gray-900">High Contrast Mode</div>
                <div className="text-sm text-gray-600">Increase color contrast for better readability</div>
              </div>
              <button
                onClick={onHighContrastToggle}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  highContrast ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    highContrast ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-sm text-blue-800">
              These settings only affect your current session and will reset when you exit the exam.
            </p>
          </div>
        </div>

        <div className="p-4 sm:p-6 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <Button
            onClick={onClose}
            className="w-full text-sm md:text-base"
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
