import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import Supercluster from 'supercluster';
import { Factory, Layers, List } from 'lucide-react';
import type { EventSummary, FacilitySummary } from '../types';
import type { RiskAssessment } from '../utils/risk';
import { fetchFacilities } from '../services/api';
import { displayFacilityName } from '../utils/format';
import { RiskBadge } from './RiskBadge';


const INDIA_CENTER: [number, number] = [23.5, 80.0];

const DARK_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const LIGHT_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const ATTRIBUTION =
  '&copy; <a href="https://www.esri.com/">Esri</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Detection-count color steps. Low step adapts to the basemap. */
const markerColor = (count: number, dark: boolean): string => {
  if (count >= 25) return '#B3372A';
  if (count >= 10) return '#C2521E';
  if (count >= 3) return '#C98A2D';
  return dark ? '#D9A441' : '#1D4A38';
};

const LEGEND_STEPS = [
  { min: 25, label: '≥ 25 detections' },
  { min: 10, label: '10–24 detections' },
  { min: 3, label: '3–9 detections' },
  { min: 0, label: '< 3 detections' },
];

const createEventIcon = (color: string, isSelected: boolean, dark: boolean) => {
  const size = isSelected ? 22 : 15;
  const ringColor = dark ? '#FAFAF7' : '#1A1712';
  const ring = isSelected
    ? `<circle cx="12" cy="12" r="10.5" fill="none" stroke="${ringColor}" stroke-width="1.5"/>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}"><circle cx="12" cy="12" r="8" fill="${color}" stroke="#FFFFFF" stroke-width="2"/>${ring}</svg>`;
  return L.divIcon({
    html: svg,
    className: 'custom-thermal-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

const facilityIcon = (dark: boolean) =>
  L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11"><rect x="6" y="6" width="12" height="12" rx="2" fill="${
      dark ? '#7FA08C' : '#1D4A38'
    }" stroke="${dark ? '#0B0F0E' : '#FFFFFF'}" stroke-width="2"/></svg>`,
    className: 'facility-marker',
    iconSize: [11, 11],
    iconAnchor: [5.5, 5.5],
  });

const clusterIcon = (count: number) =>
  L.divIcon({
    html: `<div class="cluster-badge">${count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count}</div>`,
    className: 'facility-cluster',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

const reduceMotion =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Flies to the focused event when it changes. */
const FocusController: React.FC<{ code: string | null; events: EventSummary[] }> = ({
  code,
  events,
}) => {
  const map = useMap();
  useEffect(() => {
    if (!code) return;
    const e = events.find((x) => x.event_code === code);
    if (!e) return;
    const target: [number, number] = [e.latitude, e.longitude];
    const z = Math.max(map.getZoom(), 9);
    if (reduceMotion) map.setView(target, z);
    else map.flyTo(target, z, { duration: 0.8 });
  }, [code, events, map]);
  return null;
};

/** Loads facilities for the current viewport (only at zoom >= 7). */
const FacilityLoader: React.FC<{
  enabled: boolean;
  onLoad: (f: FacilitySummary[]) => void;
}> = ({ enabled, onLoad }) => {
  const map = useMap();
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled) {
      onLoad([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      if (map.getZoom() < 7) {
        if (!cancelled) onLoad([]);
        return;
      }
      const b = map.getBounds();
      try {
        const res = await fetchFacilities({
          bounds: {
            min_lon: b.getWest(),
            min_lat: b.getSouth(),
            max_lon: b.getEast(),
            max_lat: b.getNorth(),
          },
          limit: 2000,
        });
        if (!cancelled) onLoad(res.facilities || []);
      } catch {
        /* keep previous facilities on error */
      }
    };
    load();
    const debounced = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(load, 500);
    };
    map.on('moveend', debounced);
    return () => {
      cancelled = true;
      map.off('moveend', debounced);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [enabled, map, onLoad]);
  return null;
};

type FacilityPoint = {
  type: 'Feature';
  properties: { facility: FacilitySummary };
  geometry: { type: 'Point'; coordinates: [number, number] };
};

/** Renders facilities as supercluster clusters / points for the viewport. */
const FacilityClusters: React.FC<{ facilities: FacilitySummary[]; dark: boolean }> = ({
  facilities,
  dark,
}) => {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  const [bbox, setBbox] = useState<[number, number, number, number]>(() => {
    const b = map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  });

  useEffect(() => {
    const sync = () => {
      setZoom(map.getZoom());
      const b = map.getBounds();
      setBbox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    map.on('moveend', sync);
    return () => {
      map.off('moveend', sync);
    };
  }, [map]);

  const index = useMemo(() => {
    const idx = new Supercluster<{ facility: FacilitySummary }, Record<string, never>>({
      radius: 48,
      maxZoom: 16,
    });
    idx.load(
      facilities.map(
        (f): FacilityPoint => ({
          type: 'Feature',
          properties: { facility: f },
          geometry: { type: 'Point', coordinates: [f.longitude, f.latitude] },
        })
      )
    );
    return idx;
  }, [facilities]);

  const clusters = useMemo(
    () => index.getClusters(bbox, Math.round(zoom)),
    [index, bbox, zoom]
  );

  return (
    <>
      {clusters.map((c) => {
        const [lng, lat] = c.geometry.coordinates;
        if ('cluster' in c.properties && c.properties.cluster) {
          const clusterId = (c.properties as { cluster_id: number }).cluster_id;
          const count = (c.properties as { point_count: number }).point_count;
          return (
            <Marker
              key={`c-${clusterId}`}
              position={[lat, lng]}
              icon={clusterIcon(count)}
              eventHandlers={{
                click: () => {
                  const z = index.getClusterExpansionZoom(clusterId);
                  if (reduceMotion) map.setView([lat, lng], z);
                  else map.flyTo([lat, lng], z, { duration: 0.6 });
                },
              }}
            />
          );
        }
        const f = (c.properties as { facility: FacilitySummary }).facility;
        return (
          <Marker
            key={`f-${f.id}`}
            position={[f.latitude, f.longitude]}
            icon={facilityIcon(dark)}
          >
            <Popup>
              <div className="text-xs space-y-0.5">
                <div className="font-semibold">{displayFacilityName(f.name, f.type)}</div>
                <div className="opacity-70 capitalize">{f.type.replace(/_/g, ' ')}</div>
                {f.operator && <div className="opacity-60">{f.operator}</div>}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
};

export interface HighlightPoint {
  latitude: number;
  longitude: number;
  label: string;
}

const highlightIcon = (dark: boolean) =>
  L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><rect x="4" y="4" width="16" height="16" rx="3" fill="${
      dark ? '#E8E4D8' : '#1D4A38'
    }" stroke="${dark ? '#1D4A38' : '#FFFFFF'}" stroke-width="2.5"/></svg>`,
    className: 'facility-marker',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

export interface ThermalMapViewProps {
  events: EventSummary[];
  riskByCode: Map<string, RiskAssessment>;
  selectedCode?: string | null;
  onSelectEvent?: (code: string) => void;
  /** Dark muted basemap (Live Map) vs light editorial (mini maps). */
  dark?: boolean;
  /** Show the facilities layer toggle. Facilities load at zoom >= 7 only. */
  enableFacilityLayer?: boolean;
  interactive?: boolean;
  showLegend?: boolean;
  /** Event code to fly to when it changes. */
  focusCode?: string | null;
  /** Extra pine-square markers (e.g. the subject facility on a detail page). */
  highlightPoints?: HighlightPoint[];
  className?: string;
  /** Additional controls to render in the top-left chrome container (e.g. Filters button). */
  topLeftControls?: React.ReactNode;
}

export const ThermalMapView: React.FC<ThermalMapViewProps> = ({
  events,
  riskByCode,
  selectedCode = null,
  onSelectEvent,
  dark = false,
  enableFacilityLayer = false,
  interactive = true,
  showLegend = true,
  focusCode = null,
  highlightPoints = [],
  className = '',
  topLeftControls,
}) => {
  const [facilitiesOn, setFacilitiesOn] = useState(false);
  const [facilities, setFacilities] = useState<FacilitySummary[]>([]);
  const [legendOn, setLegendOn] = useState(showLegend);
  const [zoom, setZoom] = useState(5);

  useEffect(() => {
    if (selectedCode) {
      setLegendOn(false);
    }
  }, [selectedCode]);

  return (
    <div className={`relative w-full h-full ${dark ? 'map-dark' : ''} ${className}`}>
      {interactive && (
        <div className="absolute top-3 left-3 z-[1000] flex flex-col gap-1.5 items-start pointer-events-auto">
          <div className="flex gap-1.5">
            {enableFacilityLayer && (
              <button
                type="button"
                onClick={() => setFacilitiesOn((v) => !v)}
                aria-pressed={facilitiesOn}
                title="Toggle industrial facilities"
                className={`transition-quiet inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] font-medium ${
                  dark
                    ? facilitiesOn
                      ? 'border-[#3A443F] bg-[#1A201D] text-[#E8E4D8]'
                      : 'border-[#2A332F] bg-[#111715]/90 text-[#9AA39C] hover:text-[#E8E4D8]'
                    : facilitiesOn
                      ? 'border-pine bg-pine-soft text-pine-deep'
                      : 'border-hairline bg-surface text-muted hover:text-ink'
                }`}
              >
                <Factory className="w-3.5 h-3.5" aria-hidden="true" />
                Facilities
              </button>
            )}
            <button
              type="button"
              onClick={() => setLegendOn((v) => !v)}
              aria-pressed={legendOn}
              title="Toggle legend"
              className={`transition-quiet inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] font-medium ${
                dark
                  ? 'border-[#2A332F] bg-[#111715]/90 text-[#9AA39C] hover:text-[#E8E4D8]'
                  : 'border-hairline bg-surface text-muted hover:text-ink'
              }`}
            >
              <List className="w-3.5 h-3.5" aria-hidden="true" />
              Legend
            </button>
          </div>
          {topLeftControls}
        </div>
      )}

      {legendOn && (
        <div
          className={`absolute top-3 right-3 z-[1000] w-44 rounded-md border p-3 space-y-2.5 ${
            dark
              ? 'border-[#2A332F] bg-[#111715]/95 text-[#E8E4D8]'
              : 'border-hairline bg-surface text-ink shadow-restrained'
          }`}
        >
          <div>
            <p className={`micro-label mb-1.5 ${dark ? 'text-[#9AA39C]' : ''}`}>
              Detections
            </p>
            <ul className="space-y-1">
              {LEGEND_STEPS.map((s) => (
                <li key={s.label} className="flex items-center gap-2 text-xs">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: markerColor(s.min, dark) }}
                    aria-hidden="true"
                  />
                  {s.label}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span
              className="w-2.5 h-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: dark ? '#7FA08C' : '#1D4A38' }}
              aria-hidden="true"
            />
            Industrial facility
          </div>
        </div>
      )}

      {enableFacilityLayer && facilitiesOn && zoom < 7 && (
        <div
          className={`absolute bottom-3 left-3 z-[1000] rounded-sm border px-2.5 py-1.5 text-[11px] ${
            dark
              ? 'border-[#2A332F] bg-[#111715]/95 text-[#9AA39C]'
              : 'border-hairline bg-surface text-muted shadow-restrained'
          }`}
        >
          <Layers className="w-3 h-3 inline mr-1" aria-hidden="true" />
          Zoom in to load facilities
        </div>
      )}

      <MapContainer
        center={INDIA_CENTER}
        zoom={5}
        scrollWheelZoom={interactive}
        dragging={interactive}
        doubleClickZoom={interactive}
        zoomControl={false}
        attributionControl={true}
        className="w-full h-full"
      >
        {interactive && <ZoomControl position="bottomright" />}
        <TileLayer
          attribution={ATTRIBUTION}
          url={dark ? DARK_TILES : LIGHT_TILES}
          maxZoom={19}
        />
        <ViewportSync onZoom={setZoom} />
        <FacilityLoader enabled={enableFacilityLayer && facilitiesOn} onLoad={setFacilities} />
        {facilitiesOn && zoom >= 7 && (
          <FacilityClusters facilities={facilities} dark={dark} />
        )}
        {focusCode && <FocusController code={focusCode} events={events} />}

        {events.map((event) => {
          const isSelected = event.event_code === selectedCode;
          const color = markerColor(event.detection_count, dark);
          const risk = riskByCode.get(event.event_code);
          return (
            <React.Fragment key={event.event_code}>
              {isSelected && (
                <Circle
                  center={[event.latitude, event.longitude]}
                  radius={5000}
                  pathOptions={{
                    color: dark ? '#E8E4D8' : '#1D4A38',
                    weight: 1,
                    dashArray: '4 4',
                    fillColor: dark ? '#E8E4D8' : '#1D4A38',
                    fillOpacity: 0.06,
                  }}
                />
              )}
              <Marker
                position={[event.latitude, event.longitude]}
                icon={createEventIcon(color, isSelected, dark)}
                eventHandlers={
                  onSelectEvent
                    ? { click: () => onSelectEvent(event.event_code) }
                    : undefined
                }
              >
                <Popup>
                  <div className="min-w-[190px] text-xs">
                    <div className="font-mono font-semibold tabular-nums border-b border-hairline pb-1.5 mb-1.5">
                      {event.event_code}
                    </div>
                    {risk && (
                      <div className="mb-1.5">
                        <RiskBadge assessment={risk} />
                      </div>
                    )}
                    <dl className="space-y-1">
                      <div className="flex justify-between gap-3">
                        <dt className="opacity-70">Detections</dt>
                        <dd className="font-semibold tabular-nums">
                          {event.detection_count}
                        </dd>
                      </div>
                      {event.max_frp != null && (
                        <div className="flex justify-between gap-3">
                          <dt className="opacity-70">Max FRP</dt>
                          <dd className="font-semibold tabular-nums">
                            {event.max_frp.toFixed(1)} MW
                          </dd>
                        </div>
                      )}
                    </dl>
                    <Link
                      to={`/events/${encodeURIComponent(event.event_code)}`}
                      className="transition-quiet mt-2 block text-center rounded-sm bg-pine py-1.5 text-[11px] font-semibold text-white hover:bg-pine-deep"
                    >
                      Open event
                    </Link>
                  </div>
                </Popup>
              </Marker>
            </React.Fragment>
          );
        })}
        {highlightPoints.map((p, i) => (
          <Marker
            key={`hp-${i}`}
            position={[p.latitude, p.longitude]}
            icon={highlightIcon(dark)}
            zIndexOffset={1000}
          >
            <Popup>
              <div className="text-xs font-semibold">{p.label}</div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

const ViewportSync: React.FC<{ onZoom: (z: number) => void }> = ({ onZoom }) => {
  const map = useMap();
  useEffect(() => {
    const sync = () => onZoom(map.getZoom());
    map.on('zoomend', sync);
    return () => {
      map.off('zoomend', sync);
    };
  }, [map, onZoom]);
  return null;
};

export default ThermalMapView;
