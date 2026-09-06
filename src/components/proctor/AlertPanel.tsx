import React, { useState, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Filter,
  ArrowUpDown,
  Search,
  Clock,
  User,
  CheckSquare,
  Square,
  X
} from 'lucide-react';
import { ProctorAlert, ViolationSeverity } from '../../types';
import { Badge } from '../ui/Badge';
import { VIRTUAL_LIST_HEIGHTS } from '../../constants/uiConstants';

interface AlertPanelProps {
  alerts: ProctorAlert[];
  onUpdateAlerts: (alerts: ProctorAlert[]) => void;
  onClose: () => void;
}

type AlertFilter = {
  severity: ViolationSeverity | 'all';
  acknowledged: boolean | 'all';
  type: string;
  student: string;
};

type SortOption = 'timestamp' | 'severity' | 'student';

export function AlertPanel({ alerts, onUpdateAlerts, onClose }: AlertPanelProps) {
  const [filter, setFilter] = useState<AlertFilter>({
    severity: 'all',
    acknowledged: 'all',
    type: '',
    student: ''
  });
  const [sortBy, setSortBy] = useState<SortOption>('timestamp');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedAlertIds, setSelectedAlertIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  // Null guards: malformed alert rows (missing type/message/studentName,
  // bad timestamps) render as 'Unknown' instead of crashing the panel.
  const safeAlertText = (alert: ProctorAlert): string =>
    `${alert.type ?? 'unknown'} ${alert.message ?? ''} ${alert.studentName ?? ''}`.toLowerCase();
  const filteredAlerts = useMemo(() => {
    return alerts
      .filter(alert => {
        if (!alert || typeof alert !== 'object') return false;
        if (filter.severity !== 'all' && alert.severity !== filter.severity) return false;
        if (filter.acknowledged !== 'all' && alert.isAcknowledged !== filter.acknowledged) return false;
        if (filter.type) {
          const normalized = filter.type.toLowerCase();
          if (!safeAlertText(alert).includes(normalized)) return false;
        }
        if (filter.student && !(alert.studentName ?? '').toLowerCase().includes(filter.student.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => {
        let comparison = 0;
        if (sortBy === 'timestamp') {
          const aMs = new Date(a.timestamp ?? '').getTime();
          const bMs = new Date(b.timestamp ?? '').getTime();
          comparison = (Number.isFinite(aMs) ? aMs : 0) - (Number.isFinite(bMs) ? bMs : 0);
        } else if (sortBy === 'severity') {
          const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
          comparison = (severityOrder[a.severity] ?? 0) - (severityOrder[b.severity] ?? 0);
        } else if (sortBy === 'student') {
          comparison = (a.studentName ?? '').localeCompare(b.studentName ?? '');
        }
        return sortOrder === 'asc' ? comparison : -comparison;
      });
  }, [alerts, filter, sortBy, sortOrder]);

  const severityColors = {
    critical: 'bg-red-100 text-red-800 border-red-200',
    high: 'bg-orange-100 text-orange-800 border-orange-200',
    medium: 'bg-amber-100 text-amber-800 border-amber-200',
    low: 'bg-blue-100 text-blue-800 border-blue-200'
  };

  const handleSort = (newSortBy: SortOption) => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSortBy);
      setSortOrder('desc');
    }
  };

  // S3-C4: stamp updatedAt on local ack so mergeById treats the local edit as
  // newer than the last server snapshot (server rows carry no updatedAt and
  // would otherwise overwrite the ack on the next detail poll).
  const handleToggleAcknowledge = (alertId: string) => {
    const now = new Date().toISOString();
    const updatedAlerts = alerts.map(alert =>
      alert.id === alertId ? { ...alert, isAcknowledged: !alert.isAcknowledged, updatedAt: now } : alert
    );
    onUpdateAlerts(updatedAlerts);
  };

  const handleBulkAcknowledge = (acknowledge: boolean) => {
    const now = new Date().toISOString();
    const updatedAlerts = alerts.map(alert =>
      selectedAlertIds.has(alert.id) ? { ...alert, isAcknowledged: acknowledge, updatedAt: now } : alert
    );
    onUpdateAlerts(updatedAlerts);
    setSelectedAlertIds(new Set());
  };

  const toggleAlertSelection = (alertId: string) => {
    const newSelection = new Set(selectedAlertIds);
    if (newSelection.has(alertId)) {
      newSelection.delete(alertId);
    } else {
      newSelection.add(alertId);
    }
    setSelectedAlertIds(newSelection);
  };

  const selectAllFiltered = () => {
    const allFilteredIds = new Set(filteredAlerts.map(alert => alert.id));
    setSelectedAlertIds(allFilteredIds);
  };

  const clearSelection = () => {
    setSelectedAlertIds(new Set());
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Alert Management</h2>
            <p className="text-sm text-gray-500 mt-1" aria-live="polite" aria-atomic="true">
              {alerts.filter(a => !a.isAcknowledged).length} unacknowledged of {alerts.length} total
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close alert management"
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Search and Filter Controls */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} aria-hidden="true" />
            <input
              type="text"
              placeholder="Search alerts..."
              value={filter.type}
              onChange={(e) => setFilter({ ...filter, type: e.target.value })}
              aria-label="Search alerts"
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              showFilters ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Filter size={16} aria-hidden="true" />
            Filters
          </button>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="mt-4 p-4 bg-gray-50 rounded-md border border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Severity
                </label>
                <select
                  value={filter.severity}
                  onChange={(e) => setFilter({ ...filter, severity: e.target.value as ViolationSeverity | 'all' })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Severities</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Status
                </label>
                <select
                  value={filter.acknowledged === 'all' ? 'all' : String(filter.acknowledged)}
                  onChange={(e) =>
                    setFilter({
                      ...filter,
                      acknowledged:
                        e.target.value === 'all'
                          ? 'all'
                          : e.target.value === 'true',
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Status</option>
                  <option value="false">Unacknowledged</option>
                  <option value="true">Acknowledged</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Student
                </label>
                <input
                  type="text"
                  placeholder="Filter by student..."
                  value={filter.student}
                  onChange={(e) => setFilter({ ...filter, student: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => setFilter({ severity: 'all', acknowledged: 'all', type: '', student: '' })}
                  className="w-full px-3 py-2 bg-gray-200 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-300 transition-colors"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Action Bar */}
      {selectedAlertIds.size > 0 && (
        <div className="px-6 py-3 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm font-bold text-blue-900">{selectedAlertIds.size} selected</span>
            <button
              onClick={selectAllFiltered}
              className="text-sm text-blue-700 hover:text-blue-900 font-medium"
            >
              Select All Filtered
            </button>
            <button
              onClick={clearSelection}
              className="text-sm text-blue-700 hover:text-blue-900 font-medium"
            >
              Clear Selection
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleBulkAcknowledge(true)}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 transition-colors"
            >
              <CheckCircle size={16} />
              Acknowledge All
            </button>
            <button
              onClick={() => handleBulkAcknowledge(false)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-md text-sm font-medium hover:bg-gray-700 transition-colors"
            >
              <XCircle size={16} />
              Unacknowledge All
            </button>
          </div>
        </div>
      )}

      {/* Table Header */}
      <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 grid grid-cols-12 gap-4 items-center text-xs font-bold text-gray-500 uppercase tracking-wider">
        <div className="col-span-1">
          <input
            type="checkbox"
            checked={selectedAlertIds.size === filteredAlerts.length && filteredAlerts.length > 0}
            onChange={(e) => {
              if (e.target.checked) {
                selectAllFiltered();
              } else {
                clearSelection();
              }
            }}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
        </div>
        <div
          className="col-span-3 flex items-center gap-1 cursor-pointer hover:text-gray-700"
          onClick={() => handleSort('student')}
        >
          Student
          <ArrowUpDown size={14} className={sortBy === 'student' ? (sortOrder === 'asc' ? 'rotate-180' : '') : 'opacity-30'} />
        </div>
        <div
          className="col-span-3 flex items-center gap-1 cursor-pointer hover:text-gray-700"
          onClick={() => handleSort('severity')}
        >
          Severity
          <ArrowUpDown size={14} className={sortBy === 'severity' ? (sortOrder === 'asc' ? 'rotate-180' : '') : 'opacity-30'} />
        </div>
        <div className="col-span-2">Type</div>
        <div
          className="col-span-2 flex items-center gap-1 cursor-pointer hover:text-gray-700"
          onClick={() => handleSort('timestamp')}
        >
          Time
          <ArrowUpDown size={14} className={sortBy === 'timestamp' ? (sortOrder === 'asc' ? 'rotate-180' : '') : 'opacity-30'} />
        </div>
        <div className="col-span-1">Status</div>
      </div>

      {/* Alert List */}
      <div className="flex-1 overflow-hidden">
        {filteredAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <AlertTriangle size={48} className="mb-4 opacity-20" />
            <p className="text-lg font-medium">No alerts found</p>
            <p className="text-sm">Try adjusting your filters</p>
          </div>
        ) : (
          <Virtuoso
            style={{ height: VIRTUAL_LIST_HEIGHTS.ALERT_PANEL }}
            data={filteredAlerts}
            itemContent={(index, alert) => (
              <div
                key={alert.id}
                className={`px-6 py-4 border-b border-gray-100 grid grid-cols-12 gap-4 items-center hover:bg-gray-50 transition-colors ${
                  !alert.isAcknowledged ? 'bg-blue-50/30' : ''
                } ${selectedAlertIds.has(alert.id) ? 'bg-blue-50' : ''}`}
              >
                <div className="col-span-1">
                  <input
                    type="checkbox"
                    checked={selectedAlertIds.has(alert.id)}
                    onChange={() => toggleAlertSelection(alert.id)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </div>
                <div className="col-span-3">
                  <div className="flex items-center gap-2">
                    <User size={14} className="text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{alert.studentName}</p>
                      <p className="text-xs text-gray-500">{alert.studentId}</p>
                    </div>
                  </div>
                </div>
                <div className="col-span-3">
                  <Badge className={severityColors[alert.severity]}>
                    {alert.severity}
                  </Badge>
                </div>
                <div className="col-span-2">
                  <p className="text-sm text-gray-900">{alert.type}</p>
                  <p className="text-xs text-gray-500 truncate">{alert.message}</p>
                </div>
                <div className="col-span-2">
                  <div className="flex items-center gap-1 text-gray-500">
                    <Clock size={14} />
                    <span className="text-sm">{formatTime(alert.timestamp)}</span>
                  </div>
                </div>
                <div className="col-span-1">
                  <button
                    onClick={() => handleToggleAcknowledge(alert.id)}
                    className={`p-1.5 rounded-md transition-colors ${
                      alert.isAcknowledged
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                    title={alert.isAcknowledged ? 'Mark as unacknowledged' : 'Acknowledge alert'}
                  >
                    {alert.isAcknowledged ? <CheckCircle size={16} /> : <Square size={16} />}
                  </button>
                </div>
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
}
