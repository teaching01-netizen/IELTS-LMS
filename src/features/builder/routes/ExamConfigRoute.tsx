import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { BasicInfoTab } from '../components/BasicInfoTab';
import { ExamConfigTabs } from '../components/ExamConfigTabs';
import { ModulesTab } from '../components/ModulesTab';
import { SecurityTab } from '../components/SecurityTab';
import { StandardsTab } from '../components/StandardsTab';
import { TimingTab } from '../components/TimingTab';
import type { ConfigTab } from '../components/ExamConfigTabs';
import { useConfigRouteController } from '../hooks/useConfigRouteController';

export function ExamConfigRoute() {
  const { examId } = useParams<{ examId: string }>();
  const controller = useConfigRouteController(examId);
  const [activeTab, setActiveTab] = useState<ConfigTab>('basic');

  if (controller.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading exam configuration...</div>
      </div>
    );
  }

  if (controller.error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-red-600">Error: {controller.error}</div>
      </div>
    );
  }

  if (!controller.config) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">No configuration found</div>
      </div>
    );
  }

  const config = controller.config;

  const renderTab = () => {
    switch (activeTab) {
      case 'basic':
        return <BasicInfoTab config={config} onChange={controller.handleUpdateConfig} />;
      case 'modules':
        return <ModulesTab config={config} onChange={controller.handleUpdateConfig} />;
      case 'standards':
        return <StandardsTab config={config} onChange={controller.handleUpdateConfig} />;
      case 'timing':
        return <TimingTab config={config} onChange={controller.handleUpdateConfig} />;
      case 'security':
        return <SecurityTab config={config} onChange={controller.handleUpdateConfig} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-10">
          <div className="px-8 py-5">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Exam Configuration</h1>
                <p className="text-sm text-slate-500 mt-1">{controller.exam?.title || 'Untitled Exam'}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                  Draft
                </span>
              </div>
            </div>
          </div>
          <ExamConfigTabs activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        <div className="p-8">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm ring-1 ring-slate-900/5">
            <div className="p-8">{renderTab()}</div>
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-sm border-t border-slate-200 px-8 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <button
              onClick={controller.handleCancel}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              Cancel
            </button>
            <div className="flex gap-3">
              <button
                onClick={controller.handleSaveConfig}
                className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-all duration-200"
                title="Saves your current work. You can continue editing."
              >
                Save Draft
              </button>
              <button
                onClick={controller.handleNavigateToBuilder}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-all duration-200 shadow-sm hover:shadow-md"
                title="Proceed to the builder phase to add exam content."
              >
                Start Building →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
