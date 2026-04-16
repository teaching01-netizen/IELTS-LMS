import React from 'react';
import { Info, Layers, SlidersHorizontal, Clock, Shield } from 'lucide-react';

export type ConfigTab = 'basic' | 'modules' | 'standards' | 'timing' | 'security';

interface ExamConfigTabsProps {
  activeTab: ConfigTab;
  onTabChange: (tab: ConfigTab) => void;
}

export function ExamConfigTabs({ activeTab, onTabChange }: ExamConfigTabsProps) {
  const tabs = [
    { id: 'basic' as ConfigTab, label: 'Basic Info', icon: Info },
    { id: 'modules' as ConfigTab, label: 'Modules', icon: Layers },
    { id: 'standards' as ConfigTab, label: 'Standards', icon: SlidersHorizontal },
    { id: 'timing' as ConfigTab, label: 'Timing', icon: Clock },
    { id: 'security' as ConfigTab, label: 'Security', icon: Shield },
  ];

  return (
    <div className="flex border-b border-slate-100 bg-white/50 backdrop-blur-sm">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 flex flex-col items-center py-3 gap-1.5 border-b-2 transition-all duration-200 ${
              isActive 
                ? 'border-blue-600 text-blue-700 bg-blue-50/50 font-semibold' 
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Icon size={18} />
            <span className="text-xs font-medium tracking-wide">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
