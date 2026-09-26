import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, SlidersHorizontal, X } from 'lucide-react';
import { useTraceData } from '../data/TraceDataContext';
import { ThermalMapView } from '../components/ThermalMapView';
import { RiskBadge, RiskReasons } from '../components/RiskBadge';
import { ConfidenceFilter } from '../components/ConfidenceFilter';
import { HonestyNote } from '../components/Term';
import { EmptyState, ErrorState } from '../components/ui';
import { RISK_TIERS, RiskTier } from '../utils/risk';
import { displayFacilityName, fmtDateTime, fmtKm, formatConfidenceNote, satLabel } from '../utils/format';

const SATELLITES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'MODIS_NRT'];

interface MapFilters {
  tiers: Set<RiskTier>;
  satellite: string;
  minDetections: number;
  nearIndustry: boolean;
  dateFrom: string;
  dateTo: string;
}

const DEFAULT_FILTERS: MapFilters = {
  tiers: new Set(),
  satellite: '',
  minDetections: 1,
  nearIndustry: false,
  dateFrom: '',
  dateTo: '',
};

const FilterDrawer: React.FC<{
  filters: MapFilters;
  onChange: (f: MapFilters) => void;
  onClose: () => void;
  resultCount: number;
  confidenceFilter: string[];
  setConfidenceFilter: (conf: string[]) => void;
}> = ({ filters, onChange, onClose, resultCount, confidenceFilter, setConfidenceFilter }) => {
  const set = (patch: Partial<MapFilters>) => onChange({ ...filters, ...patch });
  const toggleTier = (t: RiskTier) => {
    const next = new Set(filters.tiers);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    set({ tiers: next });
  };

  return (
    <div
      className="absolute top-3 left-3 bottom-3 z-[1001] w-72 max-w-[85vw] rounded-md border border-hairline bg-surface shadow-restrained flex flex-col"
      role="dialog"
      aria-label="Map filters"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
        <p className="micro-label">Filters</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filters"
          className="transition-quiet p-1 rounded-sm text-muted hover:text-ink hover:bg-wash"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        <fieldset>
          <legend className="micro-label mb-2">Attention tier</legend>
          <div className="flex flex-wrap gap-1.5">
            {RISK_TIERS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleTier(t)}
                aria-pressed={filters.tiers.has(t)}
                className={`transition-quiet rounded-sm border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                  filters.tiers.has(t)
                    ? 'border-pine bg-pine-soft text-pine-deep'
                    : 'border-hairline text-muted hover:text-ink'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="micro-label mb-2 block">Confidence</label>
          <ConfidenceFilter value={confidenceFilter} onChange={setConfidenceFilter} className="w-full" />
        </div>

        <div>
          <label htmlFor="map-sat" className="micro-label mb-2 block">
            Satellite
          </label>
          <select
            id="map-sat"
            value={filters.satellite}
            onChange={(e) => set({ satellite: e.target.value })}
            className="w-full rounded-sm border border-hairline bg-surface px-2.5 py-1.5 text-[13px] text-ink"
          >
            <option value="">All satellites</option>
            {SATELLITES.map((s) => (
              <option key={s} value={s}>
                {satLabel(s)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="map-mindet" className="micro-label mb-2 block">
            Minimum detections
          </label>
          <select
            id="map-mindet"
            value={filters.minDetections}
            onChange={(e) => set({ minDetections: Number(e.target.value) })}
            className="w-full rounded-sm border border-hairline bg-surface px-2.5 py-1.5 text-[13px] text-ink"
          >
            {[1, 3, 5, 10, 25].map((n) => (
              <option key={n} value={n}>
                ≥ {n}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => set({ nearIndustry: !filters.nearIndustry })}
          aria-pressed={filters.nearIndustry}
          className={`transition-quiet w-full rounded-sm border px-2.5 py-1.5 text-[13px] font-medium text-left ${
            filters.nearIndustry
              ? 'border-pine bg-pine-soft text-pine-deep'
              : 'border-hairline text-muted hover:text-ink'
          }`}
        >
          Within 5 km of industry
        </button>

        <details className="rounded-sm border border-hairline">
          <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-ink">
            Advanced · date range
          </summary>
          <div className="px-3 pb-3 space-y-3">
            <div>
              <label htmlFor="map-from" className="micro-label mb-1.5 block">
                From
              </label>
              <input
                id="map-from"
                type="date"
                value={filters.dateFrom}
                min="2026-09-20"
                max="2026-09-24"
                onChange={(e) => set({ dateFrom: e.target.value })}
                className="w-full rounded-sm border border-hairline bg-surface px-2.5 py-1.5 text-[13px] text-ink"
              />
            </div>
            <div>
              <label htmlFor="map-to" className="micro-label mb-1.5 block">
                To
              </label>
              <input
                id="map-to"
                type="date"
                value={filters.dateTo}
                min="2026-09-20"
                max="2026-09-24"
                onChange={(e) => set({ dateTo: e.target.value })}
                className="w-full rounded-sm border border-hairline bg-surface px-2.5 py-1.5 text-[13px] text-ink"
              />
            </div>
          </div>
        </details>
      </div>

      <div className="px-4 py-3 border-t border-hairline flex items-center justify-between">
        <p className="text-xs text-muted tabular-nums">{resultCount} events</p>
        <button
          type="button"
          onClick={() => {
            onChange(DEFAULT_FILTERS);
            setConfidenceFilter(['high', 'nominal', 'low']);
          }}
          className="transition-quiet text-xs font-medium text-pine-deep hover:text-pine"
        >
          Reset
        </button>
      </div>
    </div>
  );
};

export const LiveMap: React.FC = () => {
  const { events, riskByCode, confidenceFilter, setConfidenceFilter, loading, error, reload } = useTraceData();
  const [searchParams] = useSearchParams();
  const focusCode = searchParams.get('event');

  const [filters, setFilters] = useState<MapFilters>(DEFAULT_FILTERS);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(focusCode);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  const handleSelectEvent = (code: string) => {
    setSelectedCode(code);
    setPanelCollapsed(false);
  };

  const filtered = useMemo(() => {
    return events.filter((e) => {
      const risk = riskByCode.get(e.event_code);
      if (filters.tiers.size > 0 && (!risk || !filters.tiers.has(risk.tier))) return false;
      if (filters.satellite && !e.satellites.includes(filters.satellite)) return false;
      if (e.detection_count < filters.minDetections) return false;
      if (
        filters.nearIndustry &&
        !(e.facility_distance_m != null && e.facility_distance_m <= 5000)
      )
        return false;
      if (filters.dateFrom && e.last_detected && e.last_detected < filters.dateFrom)
        return false;
      if (filters.dateTo && e.first_detected && e.first_detected > `${filters.dateTo}T23:59:59`)
        return false;
      return true;
    });
  }, [events, riskByCode, filters]);

  const selected = selectedCode
    ? events.find((e) => e.event_code === selectedCode) ?? null
    : null;
  const selectedRisk = selectedCode ? riskByCode.get(selectedCode) ?? null : null;

  if (loading && events.length === 0) {
    return (
      <div className="h-[70vh] rounded-md border border-hairline bg-wash animate-pulse" aria-label="Loading map" />
    );
  }
  if (error && events.length === 0) {
    return <ErrorState message={error} onRetry={reload} />;
  }

  const filterButton = !drawerOpen ? (
    <button
      type="button"
      onClick={() => setDrawerOpen(true)}
      className="transition-quiet inline-flex items-center gap-1.5 rounded-sm border border-[#2A332F] bg-[#111715]/90 px-2.5 py-1.5 text-[11px] font-medium text-[#9AA39C] hover:text-[#E8E4D8]"
    >
      <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
      Filters
      {filtered.length !== events.length && (
        <span className="tabular-nums">· {filtered.length}</span>
      )}
    </button>
  ) : null;

  return (
    <div className="relative h-[calc(100vh-220px)] min-h-[480px] rounded-md overflow-hidden border border-hairline">
      <ThermalMapView
        events={filtered}
        riskByCode={riskByCode}
        dark
        enableFacilityLayer
        selectedCode={selectedCode}
        onSelectEvent={handleSelectEvent}
        focusCode={focusCode}
        topLeftControls={filterButton}
      />

      {drawerOpen && (
        <FilterDrawer
          filters={filters}
          onChange={setFilters}
          onClose={() => setDrawerOpen(false)}
          resultCount={filtered.length}
          confidenceFilter={confidenceFilter}
          setConfidenceFilter={setConfidenceFilter}
        />
      )}

      {/* Floating collapsed chip when panel is collapsed */}
      {selected && selectedRisk && panelCollapsed && (
        <button
          type="button"
          onClick={() => setPanelCollapsed(false)}
          aria-label={`Reopen panel for ${selected.event_code}`}
          className="transition-quiet absolute z-[1000] bottom-3 right-3 lg:top-4 lg:right-4 lg:bottom-auto inline-flex items-center gap-2 rounded-md border border-[#2A332F] bg-[#111715]/97 px-3 py-2 text-xs font-semibold text-[#E8E4D8] shadow-restrained hover:border-pine hover:bg-[#1A201D]"
        >
          <span className="font-mono tabular-nums text-pine-soft">{selected.event_code}</span>
          <span className="text-[#9AA39C] text-[11px] font-normal">(click to expand)</span>
        </button>
      )}

      {/* Event slide-in panel */}
      {selected && selectedRisk && !panelCollapsed && (
        <aside
          aria-label="Selected event"
          className="absolute z-[1000] inset-x-3 bottom-3 lg:inset-x-auto lg:right-4 lg:top-4 lg:bottom-4 lg:w-80 max-h-[46%] lg:max-h-none overflow-y-auto rounded-md border border-[#2A332F] bg-[#111715]/97 text-[#E8E4D8] shadow-restrained"
        >
          <div className="px-4 py-3 border-b border-[#2A332F] flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="micro-label text-[#9AA39C]">Thermal event</p>
              <p className="mt-0.5 font-mono font-semibold text-[15px] tabular-nums truncate">
                {selected.event_code}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPanelCollapsed(true)}
              aria-label="Collapse panel"
              className="transition-quiet p-1 rounded-sm text-[#9AA39C] hover:text-[#E8E4D8] hover:bg-[#1A201D]"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
          <div className="px-4 py-3 space-y-3">
            <RiskBadge assessment={selectedRisk} size="md" />
            <dl className="text-[13px] space-y-1.5">
              <div className="flex justify-between gap-3">
                <dt className="text-[#9AA39C]">Detected</dt>
                <dd className="tabular-nums">{fmtDateTime(selected.last_detected)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#9AA39C]">Location</dt>
                <dd className="font-mono tabular-nums">
                  {selected.latitude.toFixed(4)}, {selected.longitude.toFixed(4)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#9AA39C]">Detections</dt>
                <dd className="tabular-nums text-right">
                  <span className="font-semibold">{selected.detection_count}</span>
                  {formatConfidenceNote(selected.confidence_counts) && (
                    <span className="block text-[11px] text-[#9AA39C]">
                      {formatConfidenceNote(selected.confidence_counts)}
                    </span>
                  )}
                </dd>
              </div>
              {selected.max_frp != null && (
                <div className="flex justify-between gap-3">
                  <dt className="text-[#9AA39C]">Max FRP</dt>
                  <dd className="tabular-nums font-semibold">
                    {selected.max_frp.toFixed(1)} MW
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-[#9AA39C]">Nearest industry</dt>
                <dd className="tabular-nums text-right">
                  {selected.nearest_facility_name || selected.nearest_facility_type
                    ? displayFacilityName(selected.nearest_facility_name, selected.nearest_facility_type)
                    : '—'}
                  <br />
                  <span className="text-[#9AA39C]">{fmtKm(selected.facility_distance_m)}</span>
                </dd>
              </div>
            </dl>
            <div className="border-t border-[#2A332F] pt-3">
              <p className="micro-label text-[#9AA39C] mb-2">Why this matters</p>
              <div className="[&_li]:text-[#E8E4D8]">
                <RiskReasons assessment={selectedRisk} />
              </div>
            </div>
            <div className="pt-1">
              <HonestyNote compact />
            </div>
            <Link
              to={`/events/${encodeURIComponent(selected.event_code)}`}
              className="transition-quiet flex items-center justify-center gap-1.5 rounded-sm bg-pine px-3 py-2 text-[13px] font-semibold text-white hover:bg-pine-deep"
            >
              View full event <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          </div>
        </aside>
      )}

      {filtered.length === 0 && (
        <div className="absolute inset-0 z-[999] flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto rounded-md border border-[#2A332F] bg-[#111715]/95 px-6 py-4">
            <EmptyState
              title="No events match"
              hint="Try widening the date range or clearing filters."
              action={
                <button
                  type="button"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  className="transition-quiet rounded-sm bg-pine px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-pine-deep"
                >
                  Reset filters
                </button>
              }
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveMap;
