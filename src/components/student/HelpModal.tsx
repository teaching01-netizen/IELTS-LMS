import React from 'react';
import { X, Keyboard, ArrowRight, ArrowLeft, Flag, ChevronDown } from 'lucide-react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="p-1.5 md:p-2 bg-blue-100 rounded-lg">
              <Keyboard size={20} className="text-blue-600" />
            </div>
            <h2 className="text-lg md:text-xl font-bold text-gray-900">Keyboard Shortcuts</h2>
          </div>
          <button onClick={onClose} className="p-1.5 md:p-2 text-gray-500 hover:bg-gray-100 rounded-md transition-colors">
            <X size={18} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Navigation</h3>
              <div className="space-y-2">
                <ShortcutItem keyName="N" description="Go to next question" icon={<ArrowRight size={16} />} />
                <ShortcutItem keyName="P" description="Go to previous question" icon={<ArrowLeft size={16} />} />
                <ShortcutItem keyName="1-9" description="Jump to question number" />
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Question Actions</h3>
              <div className="space-y-2">
                <ShortcutItem keyName="F" description="Flag/unflag current question" icon={<Flag size={16} />} />
                <ShortcutItem keyName="Enter" description="Submit current answer" />
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Interface</h3>
              <div className="space-y-2">
                <ShortcutItem keyName="H" description="Open this help modal" icon={<Keyboard size={16} />} />
                <ShortcutItem keyName="Esc" description="Close modal or navigator" />
                <ShortcutItem keyName="Q" description="Toggle question palette" icon={<ChevronDown size={16} />} />
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Section</h3>
              <div className="space-y-2">
                <ShortcutItem keyName="Ctrl/Cmd + Enter" description="Submit section (with confirmation)" />
              </div>
            </div>
          </div>

          <div className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-sm text-blue-800">
              <strong>Tip:</strong> Use keyboard shortcuts to navigate faster and save time during the exam. All shortcuts can be used without modifier keys.
            </p>
          </div>
        </div>

        <div className="p-4 sm:p-6 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 md:py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium transition-colors text-sm md:text-base"
          >
            Got it, thanks!
          </button>
        </div>
      </div>
    </div>
  );
}

function ShortcutItem({ keyName, description, icon }: { keyName: string; description: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 md:gap-4">
      <kbd className="px-2 md:px-3 py-1 md:py-1.5 bg-gray-100 border border-gray-300 rounded-md text-xs md:text-sm font-mono font-semibold text-gray-700 min-w-[60px] md:min-w-[80px] text-center">
        {keyName}
      </kbd>
      <div className="flex items-center gap-2 text-gray-700 text-sm md:text-base">
        {icon && <span className="text-gray-400">{icon}</span>}
        <span>{description}</span>
      </div>
    </div>
  );
}
