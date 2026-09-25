import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  fetchAllFacilities,
  fetchDataStatus,
  fetchEvents,
  fetchHealth,
  fetchRefreshStatus,
  fetchStatistics,
  triggerRefresh,
} from '../services/api';
import type { DataStatus, RefreshJobStatus } from '../services/api';
import type {
  EventSummary,
  FacilitySummary,
  SystemStatistics,
} from '../types';
import { assessRisk, RiskAssessment, RISK_TIERS, RiskTier } from '../utils/risk';

interface TraceData {
  healthy: boolean;
  loading: boolean;
  error: string | null;
  stats: SystemStatistics | null;
  /** Exact "updated from FIRMS" timestamp + last refresh summary. */
  dataStatus: DataStatus | null;
  /** All thermal events (708) — one request, limit 1000. */
  events: EventSummary[];
  /** All industrial facilities (14,963) — paged once, then client-side. */
  facilities: FacilitySummary[];
  riskByCode: Map<string, RiskAssessment>;
  tierCounts: Record<RiskTier, number>;
  reload: () => void;
  /** Trigger a FIRMS refresh now; polls until done, then reloads. */
  refreshNow: () => Promise<void>;
  refreshing: boolean;
  refreshError: string | null;
  /** Last known refresh job state (covers scheduled runs, not just manual). */
  refreshJob: RefreshJobStatus | null;
}

const TraceDataContext = createContext<TraceData | null>(null);

export const useTraceData = (): TraceData => {
  const ctx = useContext(TraceDataContext);
  if (!ctx) throw new Error('useTraceData must be used inside TraceDataProvider');
  return ctx;
};

const BASE_FILTERS = { min_detections: 1, satellite: '', near_facility: false, sort: 'detections' as const };

export const TraceDataProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [healthy, setHealthy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<SystemStatistics | null>(null);
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [facilities, setFacilities] = useState<FacilitySummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshJob, setRefreshJob] = useState<RefreshJobStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ok, s, ds, evRes, facs] = await Promise.all([
        fetchHealth(),
        fetchStatistics(),
        fetchDataStatus(),
        fetchEvents(BASE_FILTERS, 1000, 0),
        fetchAllFacilities(),
      ]);
      setHealthy(ok);
      setStats(s);
      setDataStatus(ds);
      setEvents(evRes.events || []);
      setFacilities(facs);
      // Refresh job state is best-effort: older backends may not expose it.
      try {
        setRefreshJob(await fetchRefreshStatus());
      } catch {
        setRefreshJob(null);
      }
      if (!ok) {
        setError('The API is reachable but the database did not report healthy.');
      }
    } catch (e) {
      setError(
        'Could not reach the TRACE API at localhost:8000. Make sure the Docker stack is running (`docker compose up -d`).'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  /** Trigger a FIRMS refresh and reload once it finishes (or fails). */
  const refreshNow = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      try {
        await triggerRefresh();
      } catch (e: unknown) {
        // 409 = a refresh is already running (e.g. the automatic schedule).
        // Don't error — just poll the running job below.
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status !== 409) throw e;
      }
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 10000));
        const st = await fetchRefreshStatus();
        if (st.state === 'done') break;
        if (st.state === 'failed') {
          throw new Error(st.detail || 'The refresh failed on the server.');
        }
      }
      await load();
    } catch (e) {
      setRefreshError(
        e instanceof Error ? e.message : 'Could not refresh FIRMS data.'
      );
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  const riskByCode = useMemo(() => {
    const m = new Map<string, RiskAssessment>();
    for (const e of events) m.set(e.event_code, assessRisk(e));
    return m;
  }, [events]);

  const tierCounts = useMemo(() => {
    const counts: Record<RiskTier, number> = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      CRITICAL: 0,
    };
    for (const e of events) {
      const t = riskByCode.get(e.event_code)?.tier ?? 'LOW';
      counts[t] += 1;
    }
    return counts;
  }, [events, riskByCode]);

  const value: TraceData = {
    healthy,
    loading,
    error,
    stats,
    dataStatus,
    events,
    facilities,
    riskByCode,
    tierCounts,
    reload: load,
    refreshNow,
    refreshing,
    refreshError,
    refreshJob,
  };

  return <TraceDataContext.Provider value={value}>{children}</TraceDataContext.Provider>;
};

export { RISK_TIERS };
