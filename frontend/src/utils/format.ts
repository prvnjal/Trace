/** Shared formatting helpers — dates, distances, labels. */

export const fmtDate = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—';

export const fmtDateTime = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

export const fmtKm = (meters: number | null): string =>
  meters == null ? '—' : `${(meters / 1000).toFixed(1)} km`;

export const fmtInt = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('en-IN');

const SAT_LABELS: Record<string, string> = {
  VIIRS_SNPP_NRT: 'VIIRS SNPP',
  VIIRS_NOAA20_NRT: 'VIIRS NOAA-20',
  MODIS_NRT: 'MODIS',
};

export const satLabel = (s: string): string => SAT_LABELS[s] ?? s;

const FACILITY_TYPE_LABELS: Record<string, string> = {
  works: 'Works',
  power_plant: 'Power plant',
  industrial_site: 'Industrial site',
  petroleum_well: 'Petroleum well',
};

const LANDUSE_CLASS_LABELS: Record<string, string> = {
  farmland: 'Farmland',
  forest: 'Forest',
  scrub_grass: 'Scrub / grassland',
  industrial_urban: 'Industrial / urban',
  wetland: 'Wetland',
  unknown: 'Unknown',
};

/** Human label for an OSM land-use class, e.g. "scrub_grass" -> "Scrub / grassland". */
export const landuseClassLabel = (c: string | null | undefined): string => {
  if (!c) return 'Unknown';
  return LANDUSE_CLASS_LABELS[c] ?? c.replace(/_/g, ' ');
};

export const facilityTypeLabel = (t: string | null): string => {
  if (!t) return '—';
  return FACILITY_TYPE_LABELS[t] ?? t.replace(/_/g, ' ');
};

export const humanFacilityType = (type: string | null | undefined): string => {
  if (!type) return 'industrial site';
  const label = FACILITY_TYPE_LABELS[type] ?? type.replace(/_/g, ' ');
  return label.toLowerCase();
};

export function isUnnamedFacility(
  name: string | null | undefined,
  type: string | null | undefined
): boolean {
  if (!name || !name.trim()) return true;
  const trimmed = name.trim();
  if (type) {
    const typeRegex = new RegExp(`^${type.trim()}\\s+#[nwr]?\\d+$`, 'i');
    if (typeRegex.test(trimmed)) return true;
  }
  return /^[a-z0-9_]+\s+#[nwr]?\d+$/i.test(trimmed) || /^#[nwr]?\d+$/i.test(trimmed);
}

export function displayFacilityName(
  name: string | null | undefined,
  type: string | null | undefined
): string {
  if (!isUnnamedFacility(name, type)) {
    return name!.trim();
  }
  const hType = humanFacilityType(type);
  return `an unnamed ${hType}`;
}


/** Great-circle distance in km. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Small muted note from confidence_counts, e.g. "12 high-conf.". Omitted when event has no low/nominal detections. */
export function formatConfidenceNote(counts?: { high: number; nominal: number; low: number }): string | null {
  if (!counts) return null;
  const high = counts.high || 0;
  const nominal = counts.nominal || 0;
  const low = counts.low || 0;
  const total = high + nominal + low;
  if (total === 0) return null;
  if (nominal === 0 && low === 0) return null;
  return `${high} high-conf.`;
}
