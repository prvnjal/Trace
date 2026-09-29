import axios from 'axios';
import {
  EventSummary,
  EventDetail,
  EventDetection,
  FacilitySummary,
  SystemStatistics,
  EventFilters,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

export const fetchHealth = async (): Promise<boolean> => {
  try {
    const res = await api.get('/health');
    return res.data?.status === 'ok' && res.data?.db === 'ok';
  } catch {
    return false;
  }
};

export const fetchStatistics = async (): Promise<SystemStatistics> => {
  const res = await api.get('/statistics');
  return res.data;
};

export interface EventsResponse {
  total: number;
  limit: number;
  offset: number;
  events: EventSummary[];
}

export const fetchEvents = async (
  filters: EventFilters,
  limit = 500,
  offset = 0
): Promise<EventsResponse> => {
  const params: Record<string, string | number> = {
    min_detections: filters.min_detections,
    sort: filters.sort,
    limit,
    offset,
  };
  if (filters.satellite) params.satellite = filters.satellite;
  if (filters.near_facility) params.near_facility_km = 5;
  if (filters.confidence && filters.confidence.length > 0) {
    params.confidence = filters.confidence.join(',');
  }
  const res = await api.get('/events', { params });
  return res.data;
};

export const fetchEventDetail = async (eventCode: string): Promise<EventDetail> => {
  const res = await api.get(`/events/${encodeURIComponent(eventCode)}`);
  return res.data;
};

export const fetchEventDetections = async (
  eventCode: string,
  confidence?: string[]
): Promise<EventDetection[]> => {
  const params: Record<string, string> = {};
  if (confidence && confidence.length > 0) {
    params.confidence = confidence.join(',');
  }
  const res = await api.get(`/events/${encodeURIComponent(eventCode)}/detections`, { params });
  return res.data.detections || [];
};

export interface FacilitiesResponse {
  total: number;
  limit: number;
  offset: number;
  facilities: FacilitySummary[];
}

export interface FacilityQuery {
  kind?: string;
  limit?: number;
  offset?: number;
  bounds?: { min_lon: number; min_lat: number; max_lon: number; max_lat: number };
}

export const fetchFacilities = async (
  query: FacilityQuery = {}
): Promise<FacilitiesResponse> => {
  const params: Record<string, string | number> = {
    limit: query.limit ?? 500,
    offset: query.offset ?? 0,
  };
  if (query.kind) params.kind = query.kind;
  if (query.bounds) Object.assign(params, query.bounds);
  const res = await api.get('/facilities', { params });
  return res.data;
};

export interface FacilityClusterItem {
  count: number;
  latitude: number;
  longitude: number;
  facility?: {
    id: number;
    name: string;
    type: string;
    operator: string | null;
  };
}

export interface FacilityClustersResponse {
  total: number;
  clusters: FacilityClusterItem[];
}

export interface FacilityClustersQuery {
  min_lon: number;
  min_lat: number;
  max_lon: number;
  max_lat: number;
  zoom: number;
  kind?: string;
}

export const fetchFacilityClusters = async (
  query: FacilityClustersQuery
): Promise<FacilityClustersResponse> => {
  const params: Record<string, string | number> = {
    min_lon: query.min_lon,
    min_lat: query.min_lat,
    max_lon: query.max_lon,
    max_lat: query.max_lat,
    zoom: query.zoom,
  };
  if (query.kind) params.kind = query.kind;
  const res = await api.get('/facilities/clusters', { params });
  return res.data;
};

export interface DataStatus {
  refreshed: boolean;
  source?: string;
  refreshed_at?: string;
  days?: number;
  detections_fetched?: number;
  detections_new?: number;
  events_built?: number;
}

export interface RefreshJobStatus {
  state: 'idle' | 'running' | 'done' | 'failed';
  detail: string | null;
  summary: Record<string, unknown> | null;
  /** ISO start time of the current/last run; null when never run. */
  started_at?: string | null;
  /** True when a "running" job exceeded the server's stuck threshold. */
  stale?: boolean;
}

/** Exact "updated from FIRMS" timestamp for honest current-ish labeling. */
export const fetchDataStatus = async (): Promise<DataStatus> => {
  const res = await api.get('/data-status');
  return res.data;
};

export const triggerRefresh = async (
  days?: number
): Promise<{ status: string; days: number }> => {
  const res = await api.post('/admin/refresh', null, {
    params: days ? { days } : {},
  });
  return res.data;
};

export const fetchRefreshStatus = async (): Promise<RefreshJobStatus> => {
  const res = await api.get('/admin/refresh/status');
  return res.data;
};

/** Force-clear a wedged refresh state (a "running" job that will never finish). */
export const resetRefresh = async (): Promise<{ status: string }> => {
  const res = await api.post('/admin/refresh/reset');
  return res.data;
};

export interface ChangeDigestEvent {
  event_code: string;
  previous_count?: number;
  current_count: number;
  delta?: number;
  tier: import('../utils/risk').RiskTier;
  nearest_facility_name: string | null;
  nearest_facility_type: string | null;
  facility_distance_m: number | null;
  event_summary?: EventSummary;
}

export interface ChangesDigestResponse {
  since: string | null;
  note?: string | null;
  new_events: EventSummary[];
  grown_events: ChangeDigestEvent[];
  new_near_industry: EventSummary[];
  cooled_off_count: number;
  counts: {
    new_events_count: number;
    grown_events_count: number;
    new_near_industry_count: number;
  };
}

export const fetchChangesSinceLastRefresh = async (): Promise<ChangesDigestResponse> => {
  const res = await api.get('/changes/since-last-refresh');
  return res.data;
};

/**
 * Loads every facility (14,963) via sequential paged requests.
 * Used once at startup so facility search/filter/pagination is instant
 * and client-side. ~3 requests at limit=5000.
 */
export const fetchAllFacilities = async (): Promise<FacilitySummary[]> => {
  const all: FacilitySummary[] = [];
  const limit = 5000;
  let offset = 0;
  for (;;) {
    const page = await fetchFacilities({ limit, offset });
    all.push(...(page.facilities || []));
    if (all.length >= page.total || (page.facilities || []).length === 0) break;
    offset += limit;
  }
  return all;
};

export interface MlPrediction {
  event_code: string;
  predicted_label: string;
  confidence: number | null;
  model_version: string;
  predicted_at: string | null;
}

/**
 * Every scored model prediction (compact: top confidence only, no per-class
 * vectors). Fetched once per page load and shared via useMlPredictions.
 * Resolves to [] when predictions were never loaded into the database
 * (ml_poc/predict.py --to-db not run yet) — callers degrade quietly.
 */
let mlPredictionsCache: Promise<MlPrediction[]> | null = null;
export const fetchMlPredictions = (): Promise<MlPrediction[]> => {
  if (!mlPredictionsCache) {
    mlPredictionsCache = api
      .get('/ml-predictions')
      .then((res) => (res.data?.predictions ?? []) as MlPrediction[])
      .catch(() => []);
  }
  return mlPredictionsCache;
};
