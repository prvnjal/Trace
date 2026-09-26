import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useTraceData } from '../data/TraceDataContext';
import { PageHeader, EmptyState, ErrorState, SkeletonRows } from '../components/ui';
import { RiskBadge } from '../components/RiskBadge';
import { ConfidenceFilter } from '../components/ConfidenceFilter';
import { RISK_META, RISK_TIERS, RiskTier } from '../utils/risk';
import { displayFacilityName, fmtDate, fmtKm, formatConfidenceNote, satLabel } from '../utils/format';

type SortKey = 'tier' | 'detections' | 'frp' | 'recent';


const SORTS: { key: SortKey; label: string }[] = [
  { key: 'tier', label: 'Attention tier' },
  { key: 'detections', label: 'Detections' },
  { key: 'frp', label: 'Max FRP' },
  { key: 'recent', label: 'Most recent' },
];

const SATELLITES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'MODIS_NRT'];
const PAGE_SIZE = 50;

export const Events: React.FC = () => {
  const { events, riskByCode, confidenceFilter, setConfidenceFilter, loading, error, reload } = useTraceData();
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState<RiskTier | ''>('');
  const [satellite, setSatellite] = useState('');
  const [minDetections, setMinDetections] = useState(1);
  const [nearIndustry, setNearIndustry] = useState(false);
  const [sort, setSort] = useState<SortKey>('tier');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = events.filter((e) => {
      const risk = riskByCode.get(e.event_code);
      if (tier && risk?.tier !== tier) return false;
      if (satellite && !e.satellites.includes(satellite)) return false;
      if (e.detection_count < minDetections) return false;
      if (nearIndustry && !(e.facility_distance_m != null && e.facility_distance_m <= 5000))
        return false;
      if (q) {
        const hay = [
          e.event_code,
          e.nearest_facility_name ?? '',
          displayFacilityName(e.nearest_facility_name, e.nearest_facility_type),
          `${e.latitude.toFixed(4)},${e.longitude.toFixed(4)}`,
          `${e.latitude.toFixed(4)} ${e.longitude.toFixed(4)}`,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const rank = (code: string) => RISK_META[riskByCode.get(code)?.tier ?? 'LOW'].rank;
    rows.sort((a, b) => {
      switch (sort) {
        case 'tier':
          return rank(b.event_code) - rank(a.event_code) || b.detection_count - a.detection_count;
        case 'detections':
          return b.detection_count - a.detection_count;
        case 'frp':
          return (b.max_frp ?? 0) - (a.max_frp ?? 0);
        case 'recent':
          return (
            new Date(b.last_detected ?? 0).getTime() - new Date(a.last_detected ?? 0).getTime()
          );
      }
    });
    return rows;
  }, [events, riskByCode, query, tier, satellite, minDetections, nearIndustry, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  if (loading && events.length === 0) {
    return (
      <div>
        <PageHeader title="Thermal Events" description="Investigate detected thermal anomalies." />
        <SkeletonRows rows={8} />
      </div>
    );
  }
  if (error && events.length === 0) {
    return <ErrorState message={error} onRetry={reload} />;
  }

  return (
    <div>
      <PageHeader
        title="Thermal Events"
        description="Investigate detected thermal anomalies."
      />

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2.5 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search
            className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Search event ID, facility, coordinates…"
            aria-label="Search events"
            className="w-full rounded-sm border border-hairline bg-surface pl-9 pr-3 py-2 text-[13px] text-ink placeholder:text-faint"
          />
        </div>
        <select
          value={tier}
          onChange={(e) => {
            setTier(e.target.value as RiskTier | '');
            setPage(0);
          }}
          aria-label="Filter by attention tier"
          className="rounded-sm border border-hairline bg-surface px-2.5 py-2 text-[13px] text-ink"
        >
          <option value="">All attention tiers</option>
          {RISK_TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <ConfidenceFilter
          value={confidenceFilter}
          onChange={(c) => {
            setConfidenceFilter(c);
            setPage(0);
          }}
        />
        <select
          value={satellite}
          onChange={(e) => {
            setSatellite(e.target.value);
            setPage(0);
          }}
          aria-label="Filter by satellite"
          className="rounded-sm border border-hairline bg-surface px-2.5 py-2 text-[13px] text-ink"
        >
          <option value="">All satellites</option>
          {SATELLITES.map((s) => (
            <option key={s} value={s}>
              {satLabel(s)}
            </option>
          ))}
        </select>
        <select
          value={minDetections}
          onChange={(e) => {
            setMinDetections(Number(e.target.value));
            setPage(0);
          }}
          aria-label="Minimum detections"
          className="rounded-sm border border-hairline bg-surface px-2.5 py-2 text-[13px] text-ink"
        >
          {[1, 3, 5, 10, 25].map((n) => (
            <option key={n} value={n}>
              ≥ {n} detections
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            setNearIndustry((v) => !v);
            setPage(0);
          }}
          aria-pressed={nearIndustry}
          className={`transition-quiet rounded-sm border px-2.5 py-2 text-[13px] font-medium ${
            nearIndustry
              ? 'border-pine bg-pine-soft text-pine-deep'
              : 'border-hairline text-muted hover:text-ink'
          }`}
        >
          ≤ 5 km of industry
        </button>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort events"
          className="rounded-sm border border-hairline bg-surface px-2.5 py-2 text-[13px] text-ink"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-faint tabular-nums mb-2">
        {filtered.length} of {events.length} events
      </p>

      {pageRows.length === 0 ? (
        <EmptyState
          title="No events found"
          hint="Try changing the search or clearing the filters."
          action={
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setTier('');
                setSatellite('');
                setMinDetections(1);
                setNearIndustry(false);
                setConfidenceFilter(['high', 'nominal', 'low']);
                setPage(0);
              }}
              className="transition-quiet rounded-sm border border-hairline bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:border-pine"
            >
              Reset filters
            </button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-hairline bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-hairline bg-wash/50">
                {['Event', 'Attention', 'Location', 'Detected', 'Detections', 'Max FRP', 'Nearest industry'].map(
                  (h) => (
                    <th
                      key={h}
                      scope="col"
                      className="micro-label px-3 py-2.5 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {pageRows.map((e) => {
                const risk = riskByCode.get(e.event_code);
                const confNote = formatConfidenceNote(e.confidence_counts);
                return (
                  <tr key={e.event_code} className="transition-quiet hover:bg-wash/50">
                    <td className="px-3 py-2.5">
                      <Link
                        to={`/events/${encodeURIComponent(e.event_code)}`}
                        className="font-mono font-semibold text-pine-deep hover:text-pine tabular-nums"
                      >
                        {e.event_code}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      {risk && <RiskBadge assessment={risk} />}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted tabular-nums whitespace-nowrap">
                      {e.latitude.toFixed(3)}, {e.longitude.toFixed(3)}
                    </td>
                    <td className="px-3 py-2.5 text-muted whitespace-nowrap">
                      {fmtDate(e.last_detected)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      <span className="font-semibold">{e.detection_count}</span>
                      {confNote && (
                        <div className="text-[11px] text-faint whitespace-nowrap">
                          {confNote}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-ember-deep font-medium">
                      {e.max_frp != null ? `${e.max_frp.toFixed(1)} MW` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-muted">
                      {e.nearest_facility_name || e.nearest_facility_type ? (
                        <>
                          <span className="text-ink font-medium">
                            {displayFacilityName(e.nearest_facility_name, e.nearest_facility_type)}
                          </span>
                          <span className="text-faint"> · {fmtKm(e.facility_distance_m)}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-faint tabular-nums">
            Page {safePage + 1} of {pageCount}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage((p) => p - 1)}
              className="transition-quiet rounded-sm border border-hairline bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:border-pine disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => p + 1)}
              className="transition-quiet rounded-sm border border-hairline bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:border-pine disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Events;
