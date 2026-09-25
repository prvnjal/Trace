import React from 'react';
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Database,
  Factory,
  Flag,
  LayoutDashboard,
  Map as MapIcon,
  RefreshCw,
} from 'lucide-react';
import { TraceMark } from './TraceMark';
import { RefreshBanner } from './RefreshBanner';
import { useTraceData } from '../data/TraceDataContext';
import { fmtDate } from '../utils/format';

export const ROUTE_META: Record<string, { title: string; description: string }> = {
  '/overview': {
    title: 'Overview',
    description: 'What is happening across India right now.',
  },
  '/map': {
    title: 'Live Map',
    description: 'Satellite thermal detections and nearby industrial facilities.',
  },
  '/events': {
    title: 'Thermal Events',
    description: 'Investigate detected thermal anomalies.',
  },
  '/facilities': {
    title: 'Industrial Facilities',
    description: 'Explore facilities near detected thermal activity.',
  },
  '/analytics': {
    title: 'Analytics',
    description: 'Thermal activity across regions, facilities, and time.',
  },
  '/alerts': {
    title: 'Investigation Flags',
    description: 'Events you flagged for follow-up, stored in this browser.',
  },
  '/about': {
    title: 'Data Sources',
    description: 'Where TRACE data comes from and what it does not claim.',
  },
};

const NAV = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/map', label: 'Live Map', icon: MapIcon },
  { to: '/events', label: 'Events', icon: Activity },
  { to: '/facilities', label: 'Facilities', icon: Factory },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/alerts', label: 'Alerts', icon: Flag },
];

const SECONDARY_NAV = [{ to: '/about', label: 'Data Sources', icon: Database }];

/** Compact date range, e.g. "20–24 Sept 2026". */
const fmtRange = (from: string | null, to: string | null): string => {
  if (!from || !to) return '';
  const f = new Date(from);
  const t = new Date(to);
  const sameMonth = f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear();
  const monthYear = t.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  return sameMonth
    ? `${f.getDate()}–${t.getDate()} ${monthYear}`
    : `${fmtDate(from)} – ${fmtDate(to)}`;
};

const StatusPill: React.FC = () => {
  const { healthy, loading } = useTraceData();
  if (loading) return <span className="text-[11px] text-faint">Checking…</span>;
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        healthy
          ? 'border-[#2F7D4F] text-[#2F7D4F]'
          : 'border-[#B3372A] text-[#B3372A]'
      }`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: healthy ? '#2F7D4F' : '#B3372A' }}
        aria-hidden="true"
      />
      {healthy ? 'API live' : 'API offline'}
    </span>
  );
};

const BrandLockup: React.FC<{ compact?: boolean }> = ({ compact }) => (
  <div className="flex items-center gap-2.5 min-w-0">
    <TraceMark size={compact ? 26 : 30} />
    <div className="min-w-0 leading-none">
      <p className="font-display font-semibold text-[17px] tracking-tight text-ink">
        TRACE
      </p>
      {!compact && (
        <p className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-faint">
          Thermal intelligence · India
        </p>
      )}
    </div>
  </div>
);

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `transition-quiet relative flex items-center gap-2.5 rounded-sm px-3 py-2 text-[13px] font-medium ${
    isActive ? 'bg-pine-soft text-pine-deep' : 'text-muted hover:text-ink hover:bg-wash'
  }`;

export const AppShell: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { stats, reload, loading } = useTraceData();

  // Match nested routes (e.g. /events/EVT-1 → /events meta)
  const basePath = '/' + (location.pathname.split('/')[1] || 'overview');
  const meta = ROUTE_META[basePath] ?? ROUTE_META['/overview'];
  const dateRange = fmtRange(stats?.date_range.from ?? null, stats?.date_range.to ?? null);

  const goHome = () => navigate('/overview');

  return (
    <div className="min-h-screen bg-paper text-ink font-sans flex">
      {/* Desktop sidebar */}
      <aside className="no-print hidden lg:flex w-60 shrink-0 flex-col bg-surface border-r border-hairline">
        <button
          type="button"
          onClick={goHome}
          className="px-5 pt-5 pb-4 text-left"
          aria-label="TRACE home"
        >
          <BrandLockup />
        </button>

        <nav aria-label="Primary" className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClass}>
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-pine"
                      aria-hidden="true"
                    />
                  )}
                  <item.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
          <div className="my-3 border-t border-hairline" role="separator" />
          {SECONDARY_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClass}>
              <item.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-hairline space-y-2">
          <StatusPill />
          <p className="text-[11px] leading-relaxed text-faint">
            Snapshot{dateRange ? ` · ${dateRange}` : ''}. Proximity is context,
            not causation.
          </p>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-surface border-b border-hairline sticky top-0 z-40">
          <button type="button" onClick={goHome} aria-label="TRACE home">
            <BrandLockup compact />
          </button>
          <StatusPill />
        </div>

        {/* Desktop header */}
        <header className="no-print hidden lg:flex items-center justify-between gap-4 px-8 py-4 border-b border-hairline bg-paper sticky top-0 z-40">
          <div className="min-w-0">
            <h1 className="font-display font-semibold text-xl tracking-tight text-ink">
              {meta.title}
            </h1>
            <p className="text-[13px] text-muted">{meta.description}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {dateRange && (
              <span className="text-xs text-faint tabular-nums" title="Data date range">
                Data · {dateRange}
              </span>
            )}
            <StatusPill />
            <button
              type="button"
              onClick={reload}
              disabled={loading}
              aria-label="Refresh data"
              title="Refresh data"
              className="transition-quiet p-2 rounded-sm border border-hairline text-muted hover:text-ink hover:border-[#D8D0BE] disabled:opacity-50"
            >
              <RefreshCw
                className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
            </button>
          </div>
        </header>

        <main className="flex-1 min-w-0 px-4 py-5 lg:px-8 lg:py-7 pb-24 lg:pb-10">
          <RefreshBanner />
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav
        aria-label="Primary"
        className="no-print lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-hairline"
      >
        <div className="grid grid-cols-6">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `transition-quiet flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium ${
                  isActive ? 'text-pine-deep' : 'text-faint'
                }`
              }
            >
              <item.icon className="w-5 h-5" aria-hidden="true" />
              {item.label === 'Live Map' ? 'Map' : item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
};

export default AppShell;
