import { useMemo, type ReactNode } from 'react';
import { MotionConfig, motion, useReducedMotion } from 'motion/react';
import { BarChart3, BookOpen, LogOut, Radio, UserRound } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthSession } from '../../features/auth/authSession';
import { SatMenu } from './ui/Menu';

type SatNavItem = {
  label: string;
  path: string;
  icon: typeof BookOpen;
};

function navForRole(role: string | undefined): SatNavItem[] {
  if (role === 'builder') return [{ label: 'Exam Library', path: '/sat/exams', icon: BookOpen }];
  if (role === 'grader') return [{ label: 'Results', path: '/sat/results', icon: BarChart3 }];
  if (role === 'proctor') {
    return [
      { label: 'Sessions', path: '/sat/sessions', icon: Radio },
      { label: 'Results', path: '/sat/results', icon: BarChart3 },
    ];
  }
  return [
    { label: 'Exam Library', path: '/sat/exams', icon: BookOpen },
    { label: 'Sessions', path: '/sat/sessions', icon: Radio },
    { label: 'Results', path: '/sat/results', icon: BarChart3 },
  ];
}

function ieltsLanding(role: string | undefined): string {
  if (role === 'grader') return '/admin/grading';
  if (role === 'proctor') return '/proctor';
  return '/admin/exams';
}

function SatRouteFade({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className="sat-route-fade" key={routeKey} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}

export function SatRoot() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, logout } = useAuthSession();
  const navItems = useMemo(() => navForRole(session?.user.role), [session?.user.role]);
  const displayName = session?.user.displayName?.trim() || session?.user.email || 'Staff';
  // Option 3 (refined): sidebar stays everywhere except exam-authoring
  // focus pages. Session room (/sat/sessions/:id), result detail
  // (/sat/results/:id) and access (/sat/exams/:id/access) keep the sidebar;
  // only /sat/exams/:examId + release/preview go full-bleed.
  const isDetailPage = /^\/sat\/exams\/[^/]+($|\/(release|preview)\/?$)/.test(location.pathname);

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.18 }}>
    <div className="sat-product min-h-screen bg-[var(--sat-staff-canvas,var(--sat-canvas))] text-[var(--sat-staff-text-primary,var(--sat-label))] md:flex">
      <a href="#sat-main" className="skip-link">Skip to main content</a>
      {isDetailPage ? null : (
      <aside className="hidden w-[244px] shrink-0 border-r border-[var(--sat-staff-border-nav,var(--sat-separator))] bg-[var(--sat-staff-surface-solid-fallback,#fff)] md:flex md:min-h-screen md:flex-col md:[background:var(--sat-staff-glass-sidebar)] md:[backdrop-filter:var(--sat-staff-blur-nav)] md:[-webkit-backdrop-filter:var(--sat-staff-blur-nav)]">
        <div className="px-3 pb-3 pt-3">
          <SatMenu
            label="Digital SAT"
            align="start"
            width={212}
            triggerContent={
              <>
                <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[var(--sat-staff-text-primary,var(--sat-label))] text-[11px] font-semibold tracking-[-0.02em] text-[var(--sat-staff-text-inverse,#fff)]">SAT</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold tracking-[-0.01em]">Digital SAT</span>
                  <span className="mt-0.5 block text-[10px] font-medium text-slate-400">Workspace</span>
                </span>
              </>
            }
            items={[
              { id: 'sat', label: 'Digital SAT', onSelect: () => {}, current: true },
              { id: 'ielts', label: 'IELTS', onSelect: () => navigate(ieltsLanding(session?.user.role)) },
            ]}
          />
        </div>

        <nav aria-label="Digital SAT" className="flex-1 px-3 py-4">
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-[13px] ${isActive ? 'font-semibold text-[var(--sat-staff-text-primary,var(--sat-label))]' : 'font-medium text-[var(--sat-staff-text-secondary,var(--sat-secondary-label))] hover:text-[var(--sat-staff-text-primary,var(--sat-label))]'}`}
                >
                  {({ isActive }) => (
                    <>
                      {isActive ? (
                        <motion.span
                          layoutId="sat-desktop-nav-pill"
                          aria-hidden="true"
                          className="absolute inset-0 rounded-xl bg-[var(--sat-staff-fill-hover,var(--sat-fill-hover))]"
                          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                        />
                      ) : (
                        <span aria-hidden="true" className="absolute inset-0 rounded-xl transition-colors hover:bg-[var(--sat-staff-fill-faint,rgba(120,120,128,0.06))]" />
                      )}
                      <span className="relative flex items-center gap-3">
                        <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                        {item.label}
                      </span>
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-[var(--sat-staff-border-hairline,var(--sat-separator))] p-3">
          <div className="flex min-h-12 items-center gap-2.5 rounded-xl px-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--sat-staff-fill-avatar,rgba(120,120,128,0.12))] text-[10px] font-semibold text-[var(--sat-staff-text-secondary,var(--sat-secondary-label))]">{displayName.slice(0, 2).toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-slate-800">{displayName}</p>
              <p className="mt-0.5 text-[11px] capitalize text-slate-400">{session?.user.role ?? 'staff'}</p>
            </div>
            <button type="button" onClick={() => void logout()} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-[var(--sat-staff-fill-chip,rgba(120,120,128,0.06))] hover:text-slate-700" aria-label="Sign Out">
              <LogOut size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
      )}

      <div className="min-w-0 flex-1">
        {isDetailPage ? null : (
        <header className="sticky top-0 z-40 flex min-h-14 items-center justify-between gap-2 border-b border-[var(--sat-staff-border-header,var(--sat-separator))] bg-[var(--sat-staff-surface-solid-fallback,#fff)] px-4 [backdrop-filter:var(--sat-staff-blur-nav)] [-webkit-backdrop-filter:var(--sat-staff-blur-nav)] [background:var(--sat-staff-glass-header)] [padding-top:env(safe-area-inset-top)] md:hidden">
          <SatMenu
            label="Digital SAT"
            align="start"
            width={208}
            triggerContent={
              <>
                <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[var(--sat-staff-text-primary,var(--sat-label))] text-[11px] text-[var(--sat-staff-text-inverse,#fff)]">SAT</span>
                <span className="text-[13px] font-semibold">Digital SAT</span>
              </>
            }
            items={[
              { id: 'sat', label: 'Digital SAT', onSelect: () => {}, current: true },
              { id: 'ielts', label: 'IELTS', onSelect: () => navigate(ieltsLanding(session?.user.role)) },
            ]}
          />
          <SatMenu
            label="Account"
            compact
            icon={UserRound}
            align="end"
            width={208}
            items={[
              { id: 'identity', label: `${displayName} \u00B7 ${session?.user.role ?? 'staff'}`, disabled: true, onSelect: () => {} },
              { id: 'signout', label: 'Sign Out', onSelect: () => void logout() },
            ]}
          />
        </header>
        )}

        <main id="sat-main" tabIndex={-1} className={`min-h-screen focus:outline-none ${isDetailPage ? '' : 'pb-20 md:pb-0'}`}>
          <SatRouteFade routeKey={location.pathname}>
            <Outlet />
          </SatRouteFade>
        </main>

        {isDetailPage ? null : (
        <nav aria-label="Digital SAT" className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--sat-staff-border-nav,var(--sat-separator))] bg-[var(--sat-staff-surface-solid-fallback,#fff)] px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5 [backdrop-filter:var(--sat-staff-blur-nav)] [-webkit-backdrop-filter:var(--sat-staff-blur-nav)] [background:var(--sat-staff-glass-bottomnav)] md:hidden">
          <div className="mx-auto flex max-w-md items-center justify-around">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.path} to={item.path} className={({ isActive }) => `relative flex min-h-12 min-w-[72px] flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold ${isActive ? 'text-[var(--sat-staff-accent,var(--sat-accent-core))]' : 'text-slate-400'}`}>
                  {({ isActive }) => (
                    <>
                      {isActive ? <span aria-hidden="true" className="sat-route-enter absolute inset-x-6 top-0 h-0.5 rounded-full bg-[var(--sat-staff-accent,var(--sat-accent-core))]" /> : null}
                      <Icon size={18} strokeWidth={1.9} />
                      <span>{item.label}</span>
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        </nav>
        )}
      </div>
    </div>
    </MotionConfig>
  );
}
