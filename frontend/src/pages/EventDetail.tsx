import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Flag, Map as MapIcon, Printer } from 'lucide-react';
import { fetchEventDetail, fetchEventDetections } from '../services/api';
import type { EventDetail as EventDetailType, EventDetection } from '../types';
import { useTraceData } from '../data/TraceDataContext';
import { PageHeader, Section, DefRow, EmptyState, Skeleton } from '../components/ui';
import { RiskBadge, RiskReasons } from '../components/RiskBadge';
import { ModelAssessment } from '../components/ModelAssessment';
import { useMlPredictions } from '../hooks/useMlPredictions';
import { ConfidenceFilter } from '../components/ConfidenceFilter';
import { TimelineChart } from '../components/TimelineChart';
import { SatelliteStrip } from '../components/SatelliteStrip';
import { DetectionCharacter } from '../components/DetectionCharacter';
import { FootprintMap } from '../components/FootprintMap';
import { Term, GLOSSARY, HonestyNote } from '../components/Term';
import { assessRisk } from '../utils/risk';
import { analystNotes } from '../utils/analyst';
import { addFlag, isFlagged, removeFlag } from '../utils/flags';
import {
  displayFacilityName,
  fmtDateTime,
  fmtKm,
  facilityTypeLabel,
  formatConfidenceNote,
  isUnnamedFacility,
  landuseClassLabel,
  satLabel,
} from '../utils/format';


export const EventDetail: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { confidenceFilter, setConfidenceFilter, stats } = useTraceData();
  const { byCode: mlByCode, loading: mlLoading } = useMlPredictions();
  const [event, setEvent] = useState<EventDetailType | null>(null);
  const [detections, setDetections] = useState<EventDetection[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [flagged, setFlagged] = useState(false);

  useEffect(() => {
    if (!code) return;
    setFlagged(isFlagged(code));
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setNotFound(false);
      try {
        const [detail, dets] = await Promise.all([
          fetchEventDetail(code),
          fetchEventDetections(code, confidenceFilter).catch(() => [] as EventDetection[]),
        ]);
        if (!cancelled) {
          setEvent(detail);
          setDetections(dets);
        }
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [code, confidenceFilter]);

  if (loading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (notFound || !event) {
    return (
      <EmptyState
        title="Event not found"
        hint="The event code may be mistyped, or the dataset may have changed."
        action={
          <Link
            to="/events"
            className="transition-quiet rounded-sm bg-pine px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-pine-deep"
          >
            Back to events
          </Link>
        }
      />
    );
  }

  // Assessed from this page's own fresh detail payload — never from the
  // events-list context, which can disagree after a refresh re-clusters an
  // event between the two fetches (stale "102" vs fresh "100" style drift).
  const assessment = assessRisk(event);
  const spanDays =
    event.first_detected && event.last_detected
      ? (new Date(event.last_detected).getTime() - new Date(event.first_detected).getTime()) /
        86400000
      : null;
  const perDay =
    spanDays != null && spanDays > 0
      ? event.detection_count / spanDays
      : event.detection_count;
  const notes = analystNotes(event, detections);

  const toggleFlag = () => {
    if (flagged) {
      removeFlag(event.event_code);
      setFlagged(false);
    } else {
      addFlag(event.event_code);
      setFlagged(true);
    }
  };

  const confNote = formatConfidenceNote(event.confidence_counts);

  // EO Browser deep link: Sentinel-2 true color around the event's first
  // detection day, for visual inspection (smoke plume, infrastructure,
  // burn scar). Browsing needs no login.
  const eoBrowserUrl = (() => {
    const lat = event.latitude.toFixed(4);
    const lon = event.longitude.toFixed(4);
    const d = event.first_detected ? new Date(event.first_detected) : new Date();
    const iso = (dt: Date) => dt.toISOString().slice(0, 10);
    const from = new Date(d);
    from.setDate(from.getDate() - 1);
    const to = new Date(d);
    to.setDate(to.getDate() + 1);
    return (
      'https://apps.sentinel-hub.com/eo-browser/?zoom=12' +
      `&lat=${lat}&lng=${lon}&themeId=DEFAULT-THEME&datasetId=S2L2A` +
      `&fromTime=${iso(from)}T00%3A00%3A00.000Z&toTime=${iso(to)}T23%3A59%3A59.999Z`
    );
  })();

  return (
    <div className="max-w-3xl">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="no-print transition-quiet mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back
      </button>

      <p className="print-only mb-2 text-xs text-muted">
        TRACE analyst brief · generated {new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · source: NASA FIRMS
      </p>
      <PageHeader
        title={event.event_code}
        description={`Detected ${fmtDateTime(event.last_detected)} · ${event.latitude.toFixed(4)}, ${event.longitude.toFixed(4)}`}
        actions={
          <div className="no-print flex gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="transition-quiet inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface px-3 py-1.5 text-[13px] font-medium text-muted hover:text-ink"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" /> Print brief
            </button>
            <Link
              to={`/map?event=${encodeURIComponent(event.event_code)}`}
              className="transition-quiet inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:border-pine"
            >
              <MapIcon className="w-3.5 h-3.5" aria-hidden="true" /> Open on map
            </Link>
            <button
              type="button"
              onClick={toggleFlag}
              aria-pressed={flagged}
              className={`transition-quiet inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-[13px] font-medium ${
                flagged
                  ? 'border-pine bg-pine-soft text-pine-deep'
                  : 'border-hairline bg-surface text-muted hover:text-ink'
              }`}
            >
              <Flag className="w-3.5 h-3.5" aria-hidden="true" />
              {flagged ? 'Flagged' : 'Flag for investigation'}
            </button>
          </div>
        }
      />

      {!mlLoading && mlByCode.size > 0 && (
        <div className="mb-5">
          <ModelAssessment prediction={mlByCode.get(event.event_code) ?? null} />
        </div>
      )}

      <div className="mb-8 flex items-center gap-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
          Triage attention
        </span>
        <RiskBadge assessment={assessment} />
      </div>

      <div className="space-y-8">
        <Section title="Thermal activity">
          <dl className="divide-y divide-hairline rounded-md border border-hairline bg-surface px-4">
            <DefRow label="Detections">
              <span>{event.detection_count}</span>
              {confNote && (
                <span className="ml-2 text-xs font-normal text-muted">({confNote})</span>
              )}
            </DefRow>
            <DefRow label="Max FRP">
              <span className="text-ember-deep">
                {event.max_frp != null ? `${event.max_frp.toFixed(1)} MW` : '—'}
              </span>
            </DefRow>
            <DefRow label="Mean FRP">
              {event.mean_frp != null ? `${event.mean_frp.toFixed(1)} MW` : '—'}
            </DefRow>
            <DefRow label="Total FRP">
              {event.total_frp != null ? `${event.total_frp.toFixed(1)} MW` : '—'}
            </DefRow>
            <DefRow label="Max brightness">
              {event.max_brightness != null ? `${event.max_brightness.toFixed(0)} K` : '—'}
            </DefRow>
            <DefRow label="Mean brightness">
              {event.mean_brightness != null ? `${event.mean_brightness.toFixed(0)} K` : '—'}
            </DefRow>
            <DefRow label="Satellites">
              <span className="font-medium">
                {event.satellites.map(satLabel).join(' · ') || '—'}
              </span>
            </DefRow>
          </dl>
          <p className="mt-2 text-xs text-muted">
            <Term term="FRP" definition={GLOSSARY.frp} /> ·{' '}
            <Term term="Brightness" definition={GLOSSARY.brightness} />
          </p>
        </Section>

        <Section
          title="Heat over time"
          action={<ConfidenceFilter value={confidenceFilter} onChange={setConfidenceFilter} align="right" />}
        >
          {detections.length > 0 ? (
            <div className="rounded-md border border-hairline bg-surface px-4 py-3">
              <TimelineChart detections={detections} />
            </div>
          ) : (
            <p className="text-sm text-muted">
              No detections match the selected confidence level for this event.
            </p>
          )}
        </Section>

        <Section title="Satellite corroboration">
          {detections.length > 0 ? (
            <div className="rounded-md border border-hairline bg-surface px-4 py-3">
              <SatelliteStrip detections={detections} />
            </div>
          ) : (
            <p className="text-sm text-muted">
              No detections match the selected confidence level for this event.
            </p>
          )}
          <p className="mt-2 text-xs text-muted">
            One tick per detection, on the event's own time axis. Heat caught
            independently by several instruments on different orbits is much
            harder to dismiss as a sensor artifact.
          </p>
        </Section>

        <Section title="Detection footprint">
          {detections.length > 0 ? (
            <FootprintMap
              detections={detections}
              center={{ lat: event.latitude, lon: event.longitude }}
              facility={event.nearest_facility}
            />
          ) : (
            <p className="text-sm text-muted">
              No detections match the selected confidence level for this event.
            </p>
          )}
          <p className="mt-2 text-xs text-muted">
            Measured geometry only. A tight cluster suggests a point source
            (stack, furnace); a spread-out line suggests a moving front. This
            does not diagnose what caused the heat.
          </p>
        </Section>

        <Section title="Detection character">
          {detections.length > 0 ? (
            <div className="rounded-md border border-hairline bg-surface px-4 py-3">
              <DetectionCharacter detections={detections} />
            </div>
          ) : (
            <p className="text-sm text-muted">
              No detections match the selected confidence level for this event.
            </p>
          )}
        </Section>

        <Section title="Analyst notes">
          <ul className="space-y-2.5 rounded-md border border-hairline bg-surface px-4 py-3">
            {notes.map((note, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink">
                <span
                  aria-hidden="true"
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ember"
                />
                <span>{note}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            These notes describe the recorded data. They do not diagnose what
            caused the heat — that judgment belongs to the analyst.
          </p>
        </Section>

        <Section title="Persistence">
          <dl className="divide-y divide-hairline rounded-md border border-hairline bg-surface px-4">
            <DefRow label="First seen">{fmtDateTime(event.first_detected)}</DefRow>
            <DefRow label="Last seen">{fmtDateTime(event.last_detected)}</DefRow>
            <DefRow label="Duration">
              {event.duration_hours != null ? `≈ ${event.duration_hours.toFixed(1)} hours` : '—'}
            </DefRow>
            <DefRow label="Detection rate">
              ≈ {perDay.toFixed(1)} per day
            </DefRow>
          </dl>
          <p className="mt-2 text-xs text-muted">
            <Term term="Persistence" definition={GLOSSARY.persistence} /> Repeated
            detections over days suggest an ongoing heat source.
          </p>
        </Section>

        <Section title="Industrial context">
          {event.nearest_facility ? (
            <div className="rounded-md border border-hairline bg-surface px-4 py-3">
              <p className="text-[15px] font-semibold text-ink">
                {displayFacilityName(event.nearest_facility.name, event.nearest_facility.type)}
              </p>
              <p className="text-xs text-muted capitalize">
                {facilityTypeLabel(event.nearest_facility.type)}
                {event.nearest_facility.operator &&
                  ` · ${event.nearest_facility.operator}`}
              </p>
              <dl className="mt-2 divide-y divide-hairline">
                <DefRow label="Distance">
                  <span className="text-pine-deep">{fmtKm(event.facility_distance_m)}</span>
                </DefRow>
                <DefRow label="Facilities ≤ 1 km">{event.facilities_within_1km}</DefRow>
                <DefRow label="Facilities ≤ 5 km">{event.facilities_within_5km}</DefRow>
                <DefRow label="Surrounding land">
                  {event.landuse_class && event.landuse_class !== 'unknown' ? (
                    <>
                      {landuseClassLabel(event.landuse_class)}
                      {event.landuse_inside === false && event.landuse_distance_m != null && (
                        <span className="text-faint"> · {fmtKm(event.landuse_distance_m)} away</span>
                      )}
                      <span className="text-faint"> (OSM)</span>
                    </>
                  ) : (
                    <span className="text-faint">Not yet looked up</span>
                  )}
                </DefRow>
              </dl>
              {!isUnnamedFacility(event.nearest_facility.name, event.nearest_facility.type) && (
                <Link
                  to={`/facilities?q=${encodeURIComponent(event.nearest_facility.name!)}`}
                  className="transition-quiet mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-pine-deep hover:text-pine"
                >
                  View in facilities →
                </Link>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm text-muted">
                No mapped facility nearby in OpenStreetMap.
              </p>
              {event.landuse_class && event.landuse_class !== 'unknown' && (
                <p className="mt-2 text-sm text-muted">
                  Surrounding land:{' '}
                  <span className="font-medium text-ink">{landuseClassLabel(event.landuse_class)}</span>
                  <span className="text-faint"> (OSM)</span>
                </p>
              )}
            </>
          )}
          <div className="mt-3">
            <HonestyNote compact />
          </div>
        </Section>

        <Section title="Satellite imagery">
          <div className="rounded-md border border-hairline bg-surface px-4 py-3">
            <p className="text-sm leading-relaxed text-ink">
              Sentinel-2 true color, around the first detection day — for
              visual inspection of the site.
            </p>
            <a
              href={eoBrowserUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-quiet mt-3 inline-flex items-center gap-1.5 rounded-sm bg-ink px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-black"
            >
              Open in EO Browser →
            </a>
            <p className="mt-3 text-xs text-muted">
              Imagery is context for the analyst's own eyes — it is not a
              detection source and doesn't change any value on this page.
            </p>
          </div>
          <dl className="mt-3 divide-y divide-hairline rounded-md border border-hairline bg-surface px-4">
            <DefRow label="VIIRS Nightfire">
              <span className="text-faint">No licensed data loaded</span>
            </DefRow>
          </dl>
        </Section>

        <Section title="Why this matters · rule-based assessment">
          <div className="rounded-md border border-hairline bg-surface px-4 py-3">
            <RiskReasons assessment={assessment} />
            <p className="mt-3 text-xs text-muted border-t border-hairline pt-3">
              This tier comes from a fixed, explainable rule — detection count
              and distance to mapped industry — not from an AI model. It tells
              you where to look first, not what caused the heat.
            </p>
          </div>
        </Section>

        {stats?.proximity_note && (
          <div className="rounded-md bg-wash/60 px-4 py-3">
            <HonestyNote />
          </div>
        )}
      </div>
    </div>
  );
};

export default EventDetail;
