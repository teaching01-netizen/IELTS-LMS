import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Bell, Menu, Search, ShieldCheck } from 'lucide-react';
import { ErrorSurface, LoadingSurface } from '@components/ui';
import { useAdminRootController } from '@admin/hooks/useAdminRootController';
import { AdminProvider } from './AdminContext';

/**
 * AdminRoot Route
 *
 * Route-driven admin layout. Bootstrap and mutation orchestration live in
 * `useAdminRootController`, leaving this file as layout and outlet composition.
 */
export function AdminRoot() {
  const navigate = useNavigate();
  const {
    contextValue,
    currentView,
    initError,
    isInitialized,
    navItems,
    notificationCount,
    reload,
    sidebarOpen,
    setSidebarOpen,
  } = useAdminRootController();

  if (!isInitialized) {
    return <LoadingSurface label="Loading Admin..." />;
  }

  if (initError) {
    return (
      <ErrorSurface
        title="Loading Error"
        description={initError}
        actionLabel="Retry"
        onAction={() => {
          void reload();
        }}
      />
    );
  }

  return (
    <AdminProvider value={contextValue}>
      <div className="flex h-screen w-full bg-gray-50 text-gray-900 font-sans overflow-hidden">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <aside
          className={`flex flex-col bg-blue-900 text-blue-100 transition-all duration-300 ${
            sidebarOpen ? 'w-64' : 'w-16'
          } shadow-xl z-20`}
          role="navigation"
          aria-label="Admin navigation"
        >
          <div className="h-14 flex items-center justify-between px-4 border-b border-blue-800 bg-blue-900/50">
            {sidebarOpen ? (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-white text-blue-900 rounded-sm flex items-center justify-center font-bold text-xs">
                  IP
                </div>
                <span className="font-bold text-white tracking-tight">IELTS Platform</span>
              </div>
            ) : null}
            <button
              onClick={() => setSidebarOpen((open) => !open)}
              className="p-1 hover:bg-blue-800 rounded-sm text-blue-300 transition-colors"
              aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <Menu size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-6">
            <nav className="space-y-1 px-3" aria-label="Main navigation">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.path)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all ${
                      isActive
                        ? 'bg-blue-800 text-white shadow-sm'
                        : 'hover:bg-blue-800/50 hover:text-white text-blue-200'
                    }`}
                    title={!sidebarOpen ? item.label : undefined}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon size={18} className={isActive ? 'text-white' : 'text-blue-300'} />
                    {sidebarOpen ? <span className="text-sm font-medium">{item.label}</span> : null}
                  </button>
                );
              })}

              <div className="pt-6 pb-2 px-1">
                <div className={`h-px bg-blue-800 mb-6 ${!sidebarOpen ? 'mx-auto w-8' : ''}`}></div>
                <button
                  onClick={() => navigate('/proctor')}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-md bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-all border border-amber-500/20 shadow-sm"
                  title={!sidebarOpen ? 'Live Proctoring' : undefined}
                >
                  <ShieldCheck size={18} />
                  {sidebarOpen ? (
                    <span className="text-xs font-bold uppercase tracking-widest">
                      Live Proctoring
                    </span>
                  ) : null}
                </button>
              </div>
            </nav>
          </div>

          <div className="p-4 border-t border-blue-800 bg-blue-950/30">
            <button
              onClick={() => navigate('/')}
              className="w-full flex items-center justify-center gap-2 bg-blue-800/50 hover:bg-blue-800 text-white py-2 rounded-md text-sm font-medium transition-all border border-blue-700/30"
            >
              {sidebarOpen ? 'Exit Admin' : 'Exit'}
            </button>
          </div>
        </aside>

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <header
            className="h-14 bg-white border-b border-gray-100 flex items-center justify-between px-6 flex-shrink-0 z-10 shadow-sm"
            role="banner"
          >
            <div className="flex items-center gap-4 flex-1">
              <div className="relative w-72">
                <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Search resources, students, exams..."
                  className="w-full pl-10 pr-4 py-1.5 bg-gray-50 border border-gray-100 rounded-sm text-sm focus:bg-white focus:border-blue-700 focus:ring-2 focus:ring-blue-100 outline-none transition-all placeholder:text-gray-400"
                  aria-label="Search resources, students, exams"
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button
                className="relative p-2 text-gray-500 hover:bg-gray-100 rounded-md transition-colors"
                aria-label="Notifications"
              >
                <Bell size={20} />
                {notificationCount > 0 ? (
                  <span className="absolute top-1 right-1 w-5 h-5 bg-red-600 text-white text-xs font-bold rounded-full flex items-center justify-center border-2 border-white">
                    {notificationCount}
                  </span>
                ) : null}
              </button>
              <div className="h-8 w-px bg-gray-100 mx-1"></div>
              <div className="flex items-center gap-3 pl-2 group cursor-pointer">
                <div className="text-right hidden md:block">
                  <p className="text-sm font-semibold text-gray-900 leading-none">Sarah Chen</p>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mt-1 tracking-widest">
                    Administrator
                  </p>
                </div>
                <div className="w-8 h-8 bg-blue-100 text-blue-800 rounded-md flex items-center justify-center font-bold text-xs shadow-sm ring-2 ring-transparent group-hover:ring-blue-100 transition-all cursor-pointer">
                  SC
                </div>
              </div>
            </div>
          </header>

          <main id="main-content" className="flex-1 overflow-y-auto bg-gray-50 p-6" role="main">
            <Outlet />
          </main>
        </div>
      </div>
    </AdminProvider>
  );
}
