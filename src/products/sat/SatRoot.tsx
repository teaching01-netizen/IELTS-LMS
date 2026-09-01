import { useMemo } from 'react';
import { BarChart3, BookOpen, LogOut, Radio } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
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

export function SatRoot() {
  const navigate = useNavigate();
  const { session, logout } = useAuthSession();
  const navItems = useMemo(() => navForRole(session?.user.role), [session?.user.role]);
  const displayName = session?.user.displayName?.trim() || session?.user.email || 'Staff';

  return (
    <div className="sat-product min-h-screen bg-[#f5f5f7] text-slate-950 md:flex">
      <a href="#sat-main" className="skip-link">Skip to main content</a>
      <aside className="hidden w-[244px] shrink-0 border-r border-black/[0.07] bg-white/82 backdrop-blur-2xl md:flex md:min-h-screen md:flex-col">
        <div className="px-3 pb-3 pt-3">
          <SatMenu
            label="Digital SAT"
            align="start"
            width={212}
            triggerContent={
              <>
                <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-slate-950 text-[11px] font-semibold tracking-[-0.02em] text-white">SAT</span>
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
                  className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-xl px-3 text-[13px] transition-colors ${isActive ? 'bg-black/[0.065] font-semibold text-slate-950' : 'font-medium text-slate-500 hover:bg-black/[0.035] hover:text-slate-900'}`}
                >
                  <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-black/[0.06] p-3">
          <div className="flex min-h-12 items-center gap-2.5 rounded-xl px-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-[10px] font-semibold text-slate-600">{displayName.slice(0, 2).toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-slate-800">{displayName}</p>
              <p className="mt-0.5 text-[9px] capitalize text-slate-400">{session?.user.role ?? 'staff'}</p>
            </div>
            <button type="button" onClick={() => void logout()} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-black/[0.04] hover:text-slate-700" aria-label="Sign out">
              <LogOut size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-40 flex min-h-14 items-center justify-between border-b border-black/[0.06] bg-white/88 px-4 backdrop-blur-2xl md:hidden">
          <SatMenu
            label="Digital SAT"
            align="start"
            width={208}
            triggerContent={
              <>
                <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-slate-950 text-[9px] text-white">SAT</span>
                <span className="text-[13px] font-semibold">Digital SAT</span>
              </>
            }
            items={[
              { id: 'sat', label: 'Digital SAT', onSelect: () => {}, current: true },
              { id: 'ielts', label: 'IELTS', onSelect: () => navigate(ieltsLanding(session?.user.role)) },
            ]}
          />
        </header>

        <main id="sat-main" className="min-h-screen pb-20 md:pb-0">
          <Outlet />
        </main>

        <nav aria-label="Digital SAT" className="fixed inset-x-0 bottom-0 z-40 border-t border-black/[0.07] bg-white/92 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5 backdrop-blur-2xl md:hidden">
          <div className="mx-auto flex max-w-md items-center justify-around">
            {navItems.map((item) => {
              const Icon = item.icon;
              return <NavLink key={item.path} to={item.path} className={({ isActive }) => `flex min-h-12 min-w-[72px] flex-col items-center justify-center gap-1 rounded-xl text-[9px] font-semibold ${isActive ? 'text-[#0071e3]' : 'text-slate-400'}`}><Icon size={18} strokeWidth={1.9} /><span>{item.label}</span></NavLink>;
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
