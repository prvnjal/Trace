import React, { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTraceData } from '../data/TraceDataContext';
import { PageHeader, Section, DefRow, EmptyState, Skeleton } from '../components/ui';
import { RiskBadge } from '../components/RiskBadge';
import { HonestyNote } from '../components/Term';
import { ThermalMapView } from '../components/ThermalMapView';
import { facilityTypeLabel, haversineKm } from '../utils/format';

export const FacilityDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { facilities, events, riskByCode, loading } = useTraceData();

  const facility = useMemo(
    () => facilities.find((f) => String(f.id) === id) ?? null,
    [facilities, id]
  );

  const nearbyEvents = useMemo(() => {
    if (!facility) return [];
    return events
      .map((e) => ({
        e,
        km: haversineKm(facility.latitude, facility.longitude, e.latitude, e.longitude),
      }))
      .filter((x) => x.km <= 25)
      .sort((a, b) => a.km - b.km);
  }, [facility, events]);

  if (loading && facilities.length === 0) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!facility) {
    return (
      <EmptyState
        title="Facility not found"
        hint="The facility may not be in the current dataset."
        action={
          <Link
            to="/facilities"
            className="transition-quiet rounded-sm bg-pine px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-pine-deep"
          >
            Back to facilities
          </Link>
        }
      />
    );
  }

  return (
    <div className="max-w-4xl">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="transition-quiet mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back
      </button>

      <PageHeader
        title={facility.name}
        description={`${facilityTypeLabel(facility.type)}${facility.operator ? ` · ${facility.operator}` : ''}`}
      />

      <dl className="mb-6 divide-y divide-hairline rounded-md border border-hairline bg-surface px-4 max-w-xl">
        <DefRow label="Location">
          <span className="font-mono">
            {facility.latitude.toFixed(4)}, {facility.longitude.toFixed(4)}
          </span>
        </DefRow>
        <DefRow label="Thermal events ≤ 25 km">{nearbyEvents.length}</DefRow>
      </dl>

      <Section title="Facility map">
        <div className="h-80 rounded-md overflow-hidden border border-hairline">
          <ThermalMapView
            events={nearbyEvents.map((x) => x.e)}
            riskByCode={riskByCode}
            highlightPoints={[
              {
                latitude: facility.latitude,
                longitude: facility.longitude,
                label: facility.name,
              },
            ]}
            focusCode={nearbyEvents[0]?.e.event_code ?? null}
            showLegend={false}
          />
        </div>
        <p className="mt-2 text-xs text-faint">
          Facility and thermal events within 25 km. Distances are straight-line.
        </p>
      </Section>

      <div className="mt-8">
        <Section title={`Nearby thermal events (${nearbyEvents.length})`}>
          {nearbyEvents.length === 0 ? (
            <EmptyState
              title="No thermal events nearby"
              hint="No detected thermal events within 25 km of this facility in the current snapshot."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border border-hairline bg-surface">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-hairline bg-wash/50">
                    {['Event', 'Attention', 'Detections', 'Distance'].map((h) => (
                      <th key={h} scope="col" className="micro-label px-3 py-2.5 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {nearbyEvents.map(({ e, km }) => {
                    const risk = riskByCode.get(e.event_code);
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
                        <td className="px-3 py-2.5">{risk && <RiskBadge assessment={risk} />}</td>
                        <td className="px-3 py-2.5 tabular-nums font-semibold">
                          {e.detection_count}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-muted">
                          {km.toFixed(1)} km
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3">
            <HonestyNote compact />
          </div>
        </Section>
      </div>
    </div>
  );
};

export default FacilityDetail;
