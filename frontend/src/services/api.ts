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
  const res = await api.get('/events', { params });
  return res.data;
};

export const fetchEventDetail = async (eventCode: string): Promise<EventDetail> => {
  const res = await api.get(`/events/${encodeURIComponent(eventCode)}`);
  return res.data;
};

export const fetchEventDetections = async (
  eventCode: string
): Promise<EventDetection[]> => {
  const res = await api.get(`/events/${encodeURIComponent(eventCode)}/detections`);
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
