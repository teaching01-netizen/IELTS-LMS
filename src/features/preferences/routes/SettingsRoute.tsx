import React from 'react';
import { AdminSettings } from '@components/admin/AdminSettings';
import { useAdminContext } from '../../admin/routes/AdminContext';

/**
 * Settings Route
 *
 * Handles admin configuration settings.
 */
export function SettingsRoute() {
  const { defaults, setDefaults } = useAdminContext();
  return <AdminSettings config={defaults} onChange={setDefaults} />;
}
