import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useTraceData } from '../data/TraceDataContext';
import { PageHeader, EmptyState, ErrorState, SkeletonRows } from '../components/ui';
import { HonestyNote } from '../components/Term';
import { fmtInt, facilityTypeLabel, haversineKm } from '../utils/format';
import type { EventSummary, FacilitySummary } from '../types';

const FACILITY_TYPES = ['works', 'power_plant', 'industrial_site', 'petroleum_well'];
const PAGE_SIZE = 25;

interface NearbyInfo {
  within5km: number;
  nearestKm: number | null;
  nearestEvent: EventSummary | null;
}

function nearbyInfo(f: FacilitySummary, events: EventSummary[]): NearbyInfo {
  let within5km = 0;
  let nearestKm: number | null = null;
  let nearestEvent: EventSummary | null = null;
  for (const e of events) {
    const d = haversineKm(f.latitude, f.longitude, e.latitude, e.longitude);
    if (d <= 5) within5km += 1;
    if (nearestKm == null || d < nearestKm) {
      nearestKm = d;
      nearestEvent = e;
    }
  }
  return { within5km, nearestKm, nearestEvent };
}

export const Facilities: React.FC = () => {
  const { facilities, events, loading, error, reload } = useTraceData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [type, setType] = useState('');
  const [page, setPage] = useState(0);

  const query = searchParams.get('q') ?? '';
  const setQuery = (q: string) => {
    setSearchParams(q ? { q } : {});
    setPage(0);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return facilities.filter((f) => {
      if (type && f.type !== type) return false;
      if (q) {
        const hay = `${f.name} ${f.operator ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [facilities, query, type]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const nearbyById = useMemo(() => {
    const m = new Map<number, NearbyInfo>();
    for (const f of pageRows) m.set(f.id, nearbyInfo(f, events));
    return m;
  }, [pageRows, events]);

  if (loading && facilities.length === 0) {
    return (
      <div>
        <PageHeader title="Industrial Facilities" description="Explore facilities near detected thermal activity." />
        <SkeletonRows rows={8} />
      </div>
    );
  }
  if (error && facilities.length === 0) {
    return <ErrorState message={error} onRetry={reload} />;
  }

  return (
    <div>
      <PageHeader
        title="Industrial Facilities"
        description="Explore facilities near detected thermal activity."
      />

      <div className="flex flex-wrap items-center gap-2.5 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search
            className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search facility name or operator…"
            aria-label="Search facilities"
            className="w-full rounded-sm border border-hairline bg-surface pl-9 pr-3 py-2 text-[13px] text-ink placeholder:text-faint"
          />
        </div>
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(0);
          }}
          aria-label="Filter by facility type"
          className="rounded-sm border border-hairline bg-surface px-2.5 py-2 text-[13px] text-ink"
        >
          <option value="">All types</option>
          {FACILITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {facilityTypeLabel(t)}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-faint tabular-nums mb-2">
        {fmtInt(filtered.length)} of {fmtInt(facilities.length)} facilities
      </p>

      {pageRows.length === 0 ? (
        <EmptyState
          title="No facilities found"
          hint="Try a different search term or facility type."
          action={
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setType('');
                setPage(0);
              }}
              className="transition-quiet rounded-sm border border-hairline bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:border-pine"
            >
              Reset
            </button>
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-hairline bg-surface">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-hairline bg-wash/50">
                  {['Facility', 'Type', 'Location', 'Events ≤ 5 km', 'Nearest event'].map((h) => (
                    <th key={h} scope="col" className="micro-label px-3 py-2.5 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {pageRows.map((f) => {
                  const nb = nearbyById.get(f.id);
                  return (
                    <tr key={f.id} className="transition-quiet hover:bg-wash/50">
                      <td className="px-3 py-2.5">
                        <Link
                          to={`/facilities/${f.id}`}
                          className="font-semibold text-pine-deep hover:text-pine"
                        >
                          {f.name}
                        </Link>
                        {f.operator && (
                          <span className="block text-xs text-faint">{f.operator}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted whitespace-nowrap">
                        {facilityTypeLabel(f.type)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted tabular-nums whitespace-nowrap">
                        {f.latitude.toFixed(3)}, {f.longitude.toFixed(3)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums font-semibold">
                        {nb?.within5km ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 text-muted">
                        {nb?.nearestEvent && nb.nearestKm != null ? (
                          <>
                            <Link
                              to={`/events/${encodeURIComponent(nb.nearestEvent.event_code)}`}
                              className="font-mono text-pine-deep hover:text-pine tabular-nums"
                            >
                              {nb.nearestEvent.event_code}
                            </Link>
                            <span className="text-faint"> · {nb.nearestKm.toFixed(1)} km</span>
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
          <div className="mt-3">
            <HonestyNote compact />
          </div>
        </>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-faint tabular-nums">
            Page {safePage + 1} of {fmtInt(pageCount)}
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

export default Facilities;
