import React from 'react';
import { Clock, AlertCircle } from 'lucide-react';
import { ProctorPresence } from '../../types/domain';

interface PresenceIndicatorProps {
  proctorPresence: ProctorPresence[];
  currentProctorId: string;
  currentProctorName: string;
  onJoin?: (() => void) | undefined;
}

export function PresenceIndicator({ proctorPresence, currentProctorId, currentProctorName, onJoin }: PresenceIndicatorProps) {
  void currentProctorName;
  const uniquePresence = (() => {
    const byProctorId = new Map<string, ProctorPresence>();
    for (const entry of proctorPresence) {
      const existing = byProctorId.get(entry.proctorId);
      if (!existing) {
        byProctorId.set(entry.proctorId, entry);
        continue;
      }

      const existingMs = new Date(existing.lastHeartbeat).getTime();
      const nextMs = new Date(entry.lastHeartbeat).getTime();
      if (Number.isFinite(nextMs) && (!Number.isFinite(existingMs) || nextMs > existingMs)) {
        byProctorId.set(entry.proctorId, entry);
      }
    }
    return [...byProctorId.values()].sort(
      (left, right) => new Date(right.lastHeartbeat).getTime() - new Date(left.lastHeartbeat).getTime(),
    );
  })();

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

  const activeProctors = uniquePresence.filter(p => {
    const lastHeartbeat = new Date(p.lastHeartbeat);
    const now = new Date();
    const diffMs = now.getTime() - lastHeartbeat.getTime();
    // Consider proctor active if heartbeat within 2 minutes
    return diffMs < 120000;
  });

  const isCurrentUserPresent = activeProctors.some(p => p.proctorId === currentProctorId);

  return null;
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
