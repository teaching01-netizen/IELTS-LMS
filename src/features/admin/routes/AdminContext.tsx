import React, { createContext, useContext } from 'react';
import { AdminProps } from '../contracts';

export interface AdminContextValue extends AdminProps {
  isInitialized: boolean;
  initError: string | null;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ children, value }: { children: React.ReactNode; value: AdminContextValue }) {
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdminContext() {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error('useAdminContext must be used within AdminProvider');
  }
  return context;
}
