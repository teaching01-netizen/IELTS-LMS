import React from 'react';

/**
 * Legacy / in-progress route.
 *
 * This file is intentionally not mounted in the active route tree until it owns
 * real route-specific behavior instead of placeholder content.
 */
export function SettingsRoute() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-gray-700 mb-2">Proctor Settings</h2>
        <p className="text-gray-500">This module is under construction.</p>
      </div>
    </div>
  );
}
