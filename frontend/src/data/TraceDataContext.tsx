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
  EventFilters,
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
  /** All thermal events — paged past the API's 1000-per-request cap. */
  events: EventSummary[];
  /** All industrial facilities (14,963) — paged once, then client-side. */
  facilities: FacilitySummary[];
  riskByCode: Map<string, RiskAssessment>;
  tierCounts: Record<RiskTier, number>;
  confidenceFilter: string[];
  setConfidenceFilter: (conf: string[]) => void;
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

const EVENT_PAGE = 1000;

/** Fetch every event across pages — the API caps a single request at 1000. */
const fetchEveryEvent = async (filters: EventFilters): Promise<EventSummary[]> => {
  const all: EventSummary[] = [];
  for (let offset = 0; ; offset += EVENT_PAGE) {
    const res = await fetchEvents(filters, EVENT_PAGE, offset);
    const batch = res.events || [];
    all.push(...batch);
    if (batch.length < EVENT_PAGE) break;
  }
  return all;
};

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
  const [confidenceFilter, setConfidenceFilterState] = useState<string[]>(['high', 'nominal', 'low']);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshJob, setRefreshJob] = useState<RefreshJobStatus | null>(null);

  const load = useCallback(async (confFilter = confidenceFilter) => {
    setLoading(true);
    setError(null);
    try {
      const [ok, s, ds, allEvents, facs] = await Promise.all([
        fetchHealth(),
        fetchStatistics(),
        fetchDataStatus(),
        fetchEveryEvent({ ...BASE_FILTERS, confidence: confFilter }),
        fetchAllFacilities(),
      ]);
      setHealthy(ok);
      setStats(s);
      setDataStatus(ds);
      setEvents(allEvents);
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
  }, [confidenceFilter]);

  const setConfidenceFilter = useCallback(async (nextConf: string[]) => {
    setConfidenceFilterState(nextConf);
    try {
      setEvents(await fetchEveryEvent({ ...BASE_FILTERS, confidence: nextConf }));
    } catch (e) {
      console.error('Failed to update events with confidence filter:', e);
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
      // Poll up to ~30 minutes: a full refresh (satellite fetch + OSM
      // land-cover tagging of new events) legitimately takes a while. The
      // RefreshBanner keeps showing live progress even after this gives up.
      for (let i = 0; i < 180; i++) {
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
  }, []);

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
    confidenceFilter,
    setConfidenceFilter,
    reload: load,
    refreshNow,
    refreshing,
    refreshError,
    refreshJob,
  };

  return <TraceDataContext.Provider value={value}>{children}</TraceDataContext.Provider>;
};

export { RISK_TIERS };
