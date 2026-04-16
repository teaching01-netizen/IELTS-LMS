import React from 'react';
import { Users, Clock, AlertCircle } from 'lucide-react';
import { ProctorPresence } from '../../types/domain';

interface PresenceIndicatorProps {
  proctorPresence: ProctorPresence[];
  currentProctorId: string;
  currentProctorName: string;
}

export function PresenceIndicator({ proctorPresence, currentProctorId, currentProctorName }: PresenceIndicatorProps) {
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMs / 3600000);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const activeProctors = proctorPresence.filter(p => {
    const lastHeartbeat = new Date(p.lastHeartbeat);
    const now = new Date();
    const diffMs = now.getTime() - lastHeartbeat.getTime();
    // Consider proctor active if heartbeat within 2 minutes
    return diffMs < 120000;
  });

  const isCurrentUserPresent = activeProctors.some(p => p.proctorId === currentProctorId);

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Users size={14} />
        <span className="font-medium">{activeProctors.length}</span>
        <span>active proctor{activeProctors.length !== 1 ? 's' : ''}</span>
      </div>

      {activeProctors.length > 0 && (
        <div className="flex -space-x-2">
          {activeProctors.slice(0, 5).map(proctor => (
            <div
              key={proctor.proctorId}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                proctor.proctorId === currentProctorId
                  ? 'bg-blue-600 text-white border-white'
                  : 'bg-gray-200 text-gray-700 border-white'
              }`}
              title={`${proctor.proctorName} - Last seen ${formatTime(proctor.lastHeartbeat)}`}
            >
              {getInitials(proctor.proctorName)}
            </div>
          ))}
          {activeProctors.length > 5 && (
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold bg-gray-300 text-gray-700 border-2 border-white">
              +{activeProctors.length - 5}
            </div>
          )}
        </div>
      )}

      {!isCurrentUserPresent && (
        <button
          className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs font-medium hover:bg-blue-200 transition-colors"
          title="Join session"
        >
          Join
        </button>
      )}
    </div>
  );
}

interface CollisionWarningProps {
  otherProctorName: string;
  onProceed: () => void;
  onCancel: () => void;
}

export function CollisionWarning({ otherProctorName, onProceed, onCancel }: CollisionWarningProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-amber-100 rounded-full">
            <AlertCircle size={24} className="text-amber-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Potential Conflict</h3>
            <p className="text-sm text-gray-600 mb-4">
              <span className="font-semibold">{otherProctorName}</span> is also viewing this student. 
              To avoid duplicate actions, please coordinate with them before proceeding.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={onCancel}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onProceed}
                className="px-4 py-2 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700 transition-colors"
              >
                Proceed Anyway
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
