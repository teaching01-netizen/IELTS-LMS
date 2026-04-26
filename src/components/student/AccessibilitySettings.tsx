import React from 'react';
import { X, Contrast } from 'lucide-react';
import { Button } from '../ui/Button';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface AccessibilitySettingsProps {
  isOpen: boolean;
  onClose: () => void;
  fontSize: 'small' | 'normal' | 'large';
  highContrast: boolean;
  onFontSizeChange: (size: 'small' | 'normal' | 'large') => void;
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
  const dialogRef = useFocusTrap(isOpen, onClose);

  if (!isOpen) return null;

  const fontSizes = [
    { value: 'small' as const, label: 'Small', size: '14px' },
    { value: 'normal' as const, label: 'Normal', size: '16px' },
    { value: 'large' as const, label: 'Large', size: '18px' },
  ];

  return (
    <div
      ref={dialogRef as React.RefObject<HTMLDivElement>}
      className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="accessibility-settings-title"
      tabIndex={-1}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="p-1.5 md:p-2 bg-purple-100 rounded-lg">
              <Contrast size={20} className="text-purple-600" />
            </div>
            <h2 id="accessibility-settings-title" className="text-lg md:text-xl font-bold text-gray-900">Accessibility</h2>
          </div>
          <button
            onClick={onClose}
            className="min-h-11 min-w-11 p-1.5 md:p-2 text-gray-500 hover:bg-gray-100 rounded-md transition-colors"
            aria-label="Close accessibility settings"
          >
            <X size={18} />
          </button>
        </div>
        
        <div className="p-4 sm:p-6 space-y-4 md:space-y-6">
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">Font Size</h3>
            <div className="flex items-center gap-3">
              {fontSizes.map((size) => (
                <button
                  key={size.value}
                  onClick={() => onFontSizeChange(size.value)}
                  aria-pressed={fontSize === size.value}
                  className={`flex-1 min-h-11 px-4 py-3 rounded-lg border-2 font-medium transition-all ${
                    fontSize === size.value
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
                  }`}
                  style={{ fontSize: size.size }}
                >
                  {size.label}
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
                role="switch"
                aria-checked={highContrast}
                aria-label="High Contrast Mode"
                className={`relative min-h-11 min-w-11 w-12 h-6 rounded-full transition-colors ${
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
