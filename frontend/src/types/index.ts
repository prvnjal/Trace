export interface EventSummary {
  event_code: string;
  latitude: number;
  longitude: number;
  detection_count: number;
  max_frp: number | null;
  mean_frp: number | null;
  total_frp: number | null;
  first_detected: string | null;
  last_detected: string | null;
  duration_hours: number;
  satellites: string[];
  nearest_facility_name: string | null;
  nearest_facility_type: string | null;
  facility_distance_m: number | null;
  facilities_within_1km: number;
  facilities_within_5km: number;
  confidence_counts?: { high: number; nominal: number; low: number };
}

export interface FacilityDetail {
  name: string;
  type: string;
  operator: string | null;
  latitude: number;
  longitude: number;
}

export interface EventDetail extends EventSummary {
  max_brightness: number | null;
  mean_brightness: number | null;
  nearest_facility: FacilityDetail | null;
}

/** One satellite pass belonging to an event — for the heat-over-time chart. */
export interface EventDetection {
  timestamp: string | null;
  frp: number | null;
  satellite: string | null;
  brightness: number | null;
  daynight: string | null;
  confidence?: string | null;
}

export interface FacilitySummary {
  id: number;
  name: string;
  type: string;
  operator: string | null;
  latitude: number;
  longitude: number;
}

export interface SystemStatistics {
  total_events: number;
  total_detections: number;
  total_facilities: number;
  events_within_1km_of_facility: number;
  events_within_5km_of_facility: number;
  facilities_by_type: Record<string, number>;
  date_range: { from: string | null; to: string | null };
  proximity_note: string;
}

export interface EventFilters {
  min_detections: number;
  satellite: string;
  near_facility: boolean;
  sort: 'detections' | 'frp' | 'recent';
  confidence?: string[];
}
