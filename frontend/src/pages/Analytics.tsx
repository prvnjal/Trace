import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTraceData } from '../data/TraceDataContext';
import { PageHeader, Section, EmptyState, ErrorState, Skeleton } from '../components/ui';
import { RISK_META, RISK_TIERS } from '../utils/risk';
import { fmtDate, fmtInt, satLabel } from '../utils/format';

const AXIS_TICK = { fontSize: 11, fill: '#6E675C', fontFamily: 'Inter, sans-serif' };

const ChartTip: React.FC<{ active?: boolean; payload?: { value: number }[]; label?: string }> = ({
  active,
  payload,
  label,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-sm border border-hairline bg-surface px-2.5 py-1.5 text-xs shadow-restrained">
      <span className="font-semibold text-ink tabular-nums">{payload[0].value}</span>
      {label && <span className="text-muted"> · {label}</span>}
    </div>
  );
};

const ChartCard: React.FC<{ question: string; children: React.ReactNode; note?: string }> = ({
  question,
  children,
  note,
}) => (
  <div className="rounded-md border border-hairline bg-surface p-5">
    <h3 className="font-display font-semibold text-[17px] tracking-tight text-ink">
      {question}
    </h3>
    <div className="mt-4 h-60">{children}</div>
    {note && <p className="mt-3 text-xs leading-relaxed text-muted">{note}</p>}
  </div>
);

const HIST_BINS = [
  { label: '1', test: (n: number) => n === 1 },
  { label: '2–4', test: (n: number) => n >= 2 && n <= 4 },
  { label: '5–9', test: (n: number) => n >= 5 && n <= 9 },
  { label: '10–24', test: (n: number) => n >= 10 && n <= 24 },
  { label: '25+', test: (n: number) => n >= 25 },
];

export const Analytics: React.FC = () => {
  const { events, tierCounts, loading, error, reload } = useTraceData();

  const daily = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) {
      if (!e.first_detected) continue;
      const day = e.first_detected.slice(0, 10);
      m.set(day, (m.get(day) ?? 0) + 1);
    }
    return [...m.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([day, count]) => ({ day: fmtDate(`${day}T00:00:00`), count }));
  }, [events]);

  const tierData = useMemo(
    () => RISK_TIERS.map((t) => ({ tier: t, count: tierCounts[t], fill: RISK_META[t].color })),
    [tierCounts]
  );

  const histData = useMemo(
    () =>
      HIST_BINS.map((b) => ({
        bin: b.label,
        count: events.filter((e) => b.test(e.detection_count)).length,
      })),
    [events]
  );

  const proximityData = useMemo(() => {
    const buckets = [
      { label: '≤ 1 km', count: 0 },
      { label: '1–5 km', count: 0 },
      { label: '> 5 km', count: 0 },
      { label: 'None mapped', count: 0 },
    ];
    for (const e of events) {
      const d = e.facility_distance_m;
      if (d == null) buckets[3].count += 1;
      else if (d <= 1000) buckets[0].count += 1;
      else if (d <= 5000) buckets[1].count += 1;
      else buckets[2].count += 1;
    }
    return buckets;
  }, [events]);

  const satelliteData = useMemo(() => {
    const sats = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'MODIS_NRT'];
    return sats.map((s) => ({
      sat: satLabel(s),
      count: events.filter((e) => e.satellites.includes(s)).length,
    }));
  }, [events]);

  if (loading && events.length === 0) {
    return (
      <div>
        <PageHeader title="Analytics" description="Thermal activity across regions, facilities, and time." />
        <div className="grid md:grid-cols-2 gap-6">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      </div>
    );
  }
  if (error && events.length === 0) {
    return <ErrorState message={error} onRetry={reload} />;
  }
  if (events.length === 0) {
    return <EmptyState title="No data" hint="No events in the current dataset." />;
  }

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Thermal activity across regions, facilities, and time."
      />
      <p className="text-xs text-faint tabular-nums mb-6">
        Computed from {fmtInt(events.length)} real events — no modeled values.
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        <ChartCard
          question="Are thermal events increasing or decreasing?"
          note="New event clusters by the date of their first satellite detection."
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E9E2D5" vertical={false} />
              <XAxis dataKey="day" tick={AXIS_TICK} interval="preserveStartEnd" />
              <YAxis tick={AXIS_TICK} allowDecimals={false} />
              <Tooltip content={<ChartTip />} cursor={{ fill: '#F3EFE6' }} />
              <Bar dataKey="count" fill="#1D4A38" radius={[4, 4, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          question="Where does attention concentrate?"
          note="Rule-based attention tiers — detection count and industrial proximity, not an AI score."
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={tierData} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E9E2D5" vertical={false} />
              <XAxis dataKey="tier" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} allowDecimals={false} />
              <Tooltip content={<ChartTip />} cursor={{ fill: '#F3EFE6' }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={64}>
                {tierData.map((d) => (
                  <Cell key={d.tier} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          question="How intense are the detections?"
          note="Distribution of detection counts per event. Most events are single detections; a few persist."
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={histData} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E9E2D5" vertical={false} />
              <XAxis dataKey="bin" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} allowDecimals={false} />
              <Tooltip content={<ChartTip />} cursor={{ fill: '#F3EFE6' }} />
              <Bar dataKey="count" fill="#C2521E" radius={[4, 4, 0, 0]} maxBarSize={64} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          question="How close are events to industry?"
          note="Distance from each event centroid to the nearest mapped industrial facility."
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={proximityData} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E9E2D5" vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} allowDecimals={false} />
              <Tooltip content={<ChartTip />} cursor={{ fill: '#F3EFE6' }} />
              <Bar dataKey="count" fill="#1D4A38" radius={[4, 4, 0, 0]} maxBarSize={64} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          question="Which satellites observe the events?"
          note="An event can be observed by more than one satellite, so these counts overlap."
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={satelliteData} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E9E2D5" vertical={false} />
              <XAxis dataKey="sat" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} allowDecimals={false} />
              <Tooltip content={<ChartTip />} cursor={{ fill: '#F3EFE6' }} />
              <Bar dataKey="count" fill="#1D4A38" radius={[4, 4, 0, 0]} maxBarSize={64} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="rounded-md border border-hairline bg-surface p-5">
          <h3 className="font-display font-semibold text-[17px] tracking-tight text-ink">
            Reading these charts honestly
          </h3>
          <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-muted list-disc pl-5">
            <li>Every bar is counted from the live API — nothing is modeled or smoothed.</li>
            <li>The window is five days (20–24 Sept 2026); trends need a longer series.</li>
            <li>Proximity to industry is context for analysts, not evidence of causation.</li>
            <li>Attention tiers are a fixed rule, documented under Data Sources.</li>
          </ul>
        </div>
      </div>

      <div className="mt-8">
        <Section title="Dataset totals">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              ['Events', fmtInt(events.length)],
              ['Detections', fmtInt(events.reduce((a, e) => a + e.detection_count, 0))],
              ['Max FRP observed', `${Math.max(...events.map((e) => e.max_frp ?? 0)).toFixed(1)} MW`],
              ['Satellites', '3'],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="micro-label">{label}</p>
                <p className="mt-1.5 font-display font-semibold text-[28px] leading-none tabular-nums text-ink">
                  {value}
                </p>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
};

export default Analytics;
