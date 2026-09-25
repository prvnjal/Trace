import type { EventDetail, EventDetection } from '../types';
import { displayFacilityName, fmtDateTime, fmtKm, isUnnamedFacility } from './format';

/**
 * Analyst notes: plain-language readings of an event's data.
 *
 * These are NOT classifications, predictions, or diagnoses. Each note states
 * facts about the record and juxtaposes them with public context (what the
 * nearby facility type is, how satellites corroborate). The analyst — or the
 * judge — draws their own conclusion. Deliberately avoids causal language:
 * no "likely", "probably", "suggests a fire".
 */

const FACILITY_CONTEXT: Record<string, string> = {
  power_plant:
    'Power plants produce heat as part of normal electricity generation.',
  works:
    'Industrial works often involve furnaces, kilns, or other high-temperature processes.',
  industrial:
    'Industrial sites can run hot during normal operations.',
  petroleum_well:
    'Petroleum sites sometimes burn off excess gas in flares.',
};

export function analystNotes(
  event: EventDetail,
  detections: EventDetection[]
): string[] {
  const notes: string[] = [];
  const n = detections.length;

  // ---- Temporal pattern ----
  if (n <= 1) {
    notes.push(
      'A single thermal detection — one satellite pass caught heat here once. ' +
        'A lone detection can be a brief event or a sensor artifact; there is no track record to read.'
    );
  } else {
    const times = detections
      .map((d) => (d.timestamp ? new Date(d.timestamp).getTime() : NaN))
      .filter((t) => !Number.isNaN(t));
    if (times.length >= 2) {
      const spanDays = (Math.max(...times) - Math.min(...times)) / 86400000;
      const perDay = spanDays > 0 ? n / spanDays : n;
      if (spanDays < 1) {
        notes.push(
          `${n} detections within a single day. A tight cluster of passes with no recurrence yet — too early to call it ongoing.`
        );
      } else {
        notes.push(
          `Heat recurred across ${spanDays < 1.5 ? 'about a day' : `${Math.round(spanDays)} days`} ` +
            `(${n} detections, roughly ${perDay.toFixed(1)} per day). Recurrence points to an ongoing or repeated heat source rather than a one-off.`
        );
      }
    }
    // Spike check: one reading far above the event's own average.
    const frps = detections
      .map((d) => d.frp)
      .filter((f): f is number => f != null && f > 0);
    if (frps.length >= 3) {
      const mean = frps.reduce((a, b) => a + b, 0) / frps.length;
      const max = Math.max(...frps);
      if (mean > 0 && max >= 3 * mean) {
        const peak = detections.find((d) => d.frp === max);
        notes.push(
          `One reading reached ${max.toFixed(1)} MW — about ${(max / mean).toFixed(0)}× this event's own average` +
            (peak?.timestamp ? ` (on ${fmtDateTime(peak.timestamp)})` : '') +
            `. A sharp spike inside an otherwise steadier record stands out against the site's own baseline.`
        );
      }
    }
  }

  // ---- Satellite corroboration ----
  const sats = [...new Set(detections.map((d) => d.satellite).filter(Boolean))];
  if (sats.length > 1) {
    notes.push(
      `Seen independently by ${sats.length} satellites. Independent passes make a sensor artifact less plausible.`
    );
  } else if (sats.length === 1 && n > 1) {
    notes.push(
      `All detections so far come from a single satellite. Corroboration from a second sensor would strengthen the record.`
    );
  }

  // ---- Industrial context ----
  const fac = event.nearest_facility;
  const distM = event.facility_distance_m;
  if (fac && distM != null) {
    const distKm = distM / 1000;
    const unnamed = isUnnamedFacility(fac.name, fac.type);
    const displayName = displayFacilityName(fac.name, fac.type);
    const typeLabel = fac.type.replace(/_/g, ' ').toLowerCase();

    if (distKm <= 1) {
      const ctx = FACILITY_CONTEXT[fac.type];
      const facilityDesc = unnamed
        ? `${displayName} mapped in OpenStreetMap`
        : `${displayName}, a mapped ${typeLabel} in OpenStreetMap`;
      notes.push(
        `The event centroid is ${fmtKm(distM)} from ${facilityDesc}.` +
          (ctx ? ` ${ctx}` : '')
      );
    } else if (distKm <= 5) {
      const namePart = !unnamed ? ` (${displayName})` : '';
      notes.push(
        `The nearest mapped industrial facility is ${fmtKm(distM)} away${namePart}. ${
          event.facilities_within_5km
        } mapped ${
          event.facilities_within_5km === 1 ? 'facility sits' : 'facilities sit'
        } within 5 km — industrial context exists, but at a distance.`
      );
    } else {
      notes.push(
        `No mapped industrial facility within 5 km. The heat has no obvious industrial context in OpenStreetMap — but OSM mapping is incomplete, so absence on the map is not proof of absence on the ground.`
      );
    }
  } else {
    notes.push(
      `No mapped industrial facility within 5 km. The heat has no obvious industrial context in OpenStreetMap — but OSM mapping is incomplete, so absence on the map is not proof of absence on the ground.`
    );
  }

  return notes;
}

