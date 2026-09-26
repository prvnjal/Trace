import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet';
import type { EventDetection, FacilityDetail } from '../types';

const SAT_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const REF_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const SAT_ATTRIBUTION =
  '© Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

/**
 * Detection footprint: every detection plotted on satellite imagery around
 * the event centroid, with nearby mapped facilities. A tight cluster reads
 * as a point source (stack, furnace); a spread-out line reads as a moving
 * front. The map describes measured geometry — never what caused the heat.
 */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(points, { padding: [36, 36] });
    } else if (points.length === 1) {
      map.setView(points[0], 12);
    }
  }, [map, points]);
  return null;
}

interface Props {
  detections: EventDetection[];
  center: { lat: number; lon: number };
  facility: FacilityDetail | null;
}

export const FootprintMap: React.FC<Props> = ({ detections, center, facility }) => {
  const points = useMemo<[number, number][]>(
    () =>
      detections
        .filter((d) => d.latitude != null && d.longitude != null)
        .map((d) => [d.latitude as number, d.longitude as number]),
    [detections]
  );

  const hasFacility =
    facility != null && facility.latitude != null && facility.longitude != null;

  return (
    <div className="overflow-hidden rounded-md border border-hairline">
      <MapContainer
        center={[center.lat, center.lon]}
        zoom={12}
        scrollWheelZoom={false}
        attributionControl={true}
        style={{ height: 300, width: '100%' }}
      >
        <TileLayer url={SAT_TILES} maxZoom={19} />
        <TileLayer
          url={REF_TILES}
          maxZoom={19}
          attribution={SAT_ATTRIBUTION}
        />
        <FitBounds points={points} />
        {points.map(([lat, lon], i) => (
          <CircleMarker
            key={i}
            center={[lat, lon]}
            radius={4}
            pathOptions={{
              color: '#C2521E',
              weight: 1,
              fillColor: '#C2521E',
              fillOpacity: 0.75,
            }}
          />
        ))}
        {/* event centroid */}
        <CircleMarker
          center={[center.lat, center.lon]}
          radius={7}
          pathOptions={{
            color: '#1C1915',
            weight: 2,
            fillColor: '#1C1915',
            fillOpacity: 1,
          }}
        />
        {hasFacility && (
          <CircleMarker
            center={[facility.latitude, facility.longitude]}
            radius={8}
            pathOptions={{
              color: '#1C1915',
              weight: 2,
              fillColor: '#FFFFFF',
              fillOpacity: 1,
            }}
          />
        )}
      </MapContainer>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-hairline bg-surface px-4 py-2.5 text-xs text-muted">
        <span>
          <span
            className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-baseline"
            style={{ background: '#C2521E' }}
          />
          Detection ({points.length})
        </span>
        <span>
          <span
            className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-baseline"
            style={{ background: '#1C1915' }}
          />
          Event centroid
        </span>
        {hasFacility && (
          <span>
            <span
              className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-baseline"
              style={{ background: '#fff', border: '2px solid #1C1915' }}
            />
            Mapped facility
          </span>
        )}
      </div>
    </div>
  );
};
