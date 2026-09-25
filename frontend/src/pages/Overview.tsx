import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { useTraceData } from '../data/TraceDataContext';
import { PageHeader, Section, Stat, EmptyState, ErrorState, Skeleton } from '../components/ui';
import { RiskBadge } from '../components/RiskBadge';
import { Term, GLOSSARY, HonestyNote } from '../components/Term';
import { ThermalMapView } from '../components/ThermalMapView';
import { RISK_META, RISK_TIERS } from '../utils/risk';
import { displayFacilityName, fmtDate, fmtDateTime, fmtInt, fmtKm } from '../utils/format';

const STEPS = [

  {
    n: '01',
    title: 'Detect',
    body: (
      <>
        <Term term="NASA FIRMS" definition={GLOSSARY.firms} /> identifies thermal
        anomalies from orbit, roughly every 3 hours.
      </>
    ),
  },
  {
    n: '02',
    title: 'Contextualize',
    body: (
      <>
        TRACE finds nearby industrial facilities from{' '}
        <Term term="OpenStreetMap" definition={GLOSSARY.osm} /> — distance and
        counts, never a verdict.
      </>
    ),
  },
  {
    n: '03',
    title: 'Analyze',
    body: 'Spatial and temporal patterns are evaluated: how many detections, over how many days, how close to industry.',
  },
  {
    n: '04',
    title: 'Investigate',
    body: 'Analysts inspect events, surrounding assets, and flag what needs a closer look.',
  },
];

export const Overview: React.FC = () => {
  const { stats, dataStatus, events, riskByCode, tierCounts, loading, error, reload, refreshNow, refreshing, refreshError } = useTraceData();

  const highPriority = useMemo(() => {
    return [...events]
      .map((e) => ({ e, tier: riskByCode.get(e.event_code)?.tier ?? 'LOW' }))
      .sort(
        (a, b) =>
          RISK_META[b.tier].rank - RISK_META[a.tier].rank ||
          b.e.detection_count - a.e.detection_count
      )
      .slice(0, 6);
  }, [events, riskByCode]);

  const highCritical = tierCounts.HIGH + tierCounts.CRITICAL;

  /** The single most attention-worthy event, surfaced as the demo narrative. */
  const featured = highPriority[0]?.e ?? null;
  const featuredTier = featured ? riskByCode.get(featured.event_code) : undefined;
  const featuredSpanDays =
    featured?.first_detected && featured?.last_detected
      ? Math.max(
          1,
          Math.ceil(
            (new Date(featured.last_detected).getTime() -
              new Date(featured.first_detected).getTime()) /
              86400000
          )
        )
      : null;

  if (loading && !stats) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (error && !stats) {
    return <ErrorState message={error} onRetry={reload} />;
  }

  const maxTier = Math.max(1, ...RISK_TIERS.map((t) => tierCounts[t]));

  return (
    <div>
      <PageHeader
        title="TRACE Overview"
        description="Monitor thermal activity and investigate potential industrial exposure across India."
        actions={
          <div className="flex flex-col items-end gap-1.5">
            {dataStatus?.refreshed && dataStatus.refreshed_at && (
              <p className="text-xs text-muted">
                Updated from FIRMS · {fmtDateTime(dataStatus.refreshed_at)}
              </p>
            )}
            <button
              type="button"
              onClick={refreshNow}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-sm border border-hairline px-2.5 py-1.5 text-[13px] font-medium text-muted transition-quiet hover:text-ink disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh data'}
            </button>
            {refreshError && (
              <p className="text-xs text-ember max-w-[220px] text-right">{refreshError}</p>
            )}
          </div>
        }
      />

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-8 pb-8 border-b border-hairline">
        <Stat label="Active events" value={fmtInt(stats?.total_events)} sub="Thermal clusters, 5-day window" />
        <Stat
          label="High + critical"
          value={fmtInt(highCritical)}
          sub="Rule-based attention tiers"
        />
        <Stat
          label="Facilities monitored"
          value={fmtInt(stats?.total_facilities)}
          sub="Mapped industrial assets (OSM)"
        />
        <Stat
          label="Events near industry"
          value={fmtInt(stats?.events_within_5km_of_facility)}
          sub="Within 5 km of a facility"
        />
      </div>

      {/* Featured event — the guided entry point for a demo or investigation */}
      {featured && featuredTier && (
        <section
          aria-label="Featured event"
          className="mt-8 rounded-md border border-hairline bg-surface p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold tracking-[0.14em] text-muted">
              FEATURED EVENT
            </p>
            <RiskBadge assessment={featuredTier} />
          </div>
          <p className="mt-3 font-display text-2xl leading-snug text-ink">
            {fmtInt(featured.detection_count)} detections
            {featuredSpanDays != null &&
              ` across ${featuredSpanDays} day${featuredSpanDays === 1 ? '' : 's'}`}
            {(featured.nearest_facility_name || featured.nearest_facility_type) &&
              ` · ${fmtKm(featured.facility_distance_m)} from ${displayFacilityName(
                featured.nearest_facility_name,
                featured.nearest_facility_type
              )}`}
            .
          </p>
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-[13px] text-muted">
            <span>
              Peak{' '}
              <span className="font-semibold text-ink tabular-nums">
                {featured.max_frp != null ? `${featured.max_frp.toFixed(1)} MW` : '—'}
              </span>
            </span>
            <span>
              Seen by{' '}
              <span className="font-semibold text-ink tabular-nums">
                {featured.satellites.length} satellite{featured.satellites.length === 1 ? '' : 's'}
              </span>
            </span>
            <span>
              First seen{' '}
              <span className="font-semibold text-ink">
                {fmtDate(featured.first_detected)}
              </span>
            </span>
          </div>
          <Link
            to={`/events/${encodeURIComponent(featured.event_code)}`}
            className="transition-quiet mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-pine-deep hover:text-pine"
          >
            Investigate this event{' '}
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </section>
      )}

      <div className="grid lg:grid-cols-5 gap-8 mt-8">
        {/* High-priority events */}
        <div className="lg:col-span-3">
          <Section
            title="High-priority events"
            action={
              <Link
                to="/events"
                className="transition-quiet inline-flex items-center gap-1 text-xs font-medium text-pine-deep hover:text-pine"
              >
                All events <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            }
          >
            {highPriority.length === 0 ? (
              <EmptyState title="No events" hint="No thermal events in the current dataset." />
            ) : (
              <ul className="divide-y divide-hairline">
                {highPriority.map(({ e }) => (
                  <li key={e.event_code}>
                    <Link
                      to={`/events/${encodeURIComponent(e.event_code)}`}
                      className="transition-quiet flex items-center gap-3 py-3 hover:bg-wash/60 -mx-2 px-2 rounded-sm"
                    >
                      <RiskBadge assessment={riskByCode.get(e.event_code)!} />
                      <span className="font-mono text-[13px] font-semibold text-ink tabular-nums">
                        {e.event_code}
                      </span>
                      <span className="ml-auto text-xs text-muted tabular-nums text-right">
                        {e.detection_count} detections
                        <br />
                        <span className="text-faint">{fmtKm(e.facility_distance_m)} to industry</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4">
              <HonestyNote compact />
            </div>
          </Section>
        </div>

        {/* Risk distribution */}
        <div className="lg:col-span-2">
          <Section title="Attention tiers">
            <div className="space-y-3 pt-1">
              {RISK_TIERS.slice()
                .reverse()
                .map((t) => {
                  const count = tierCounts[t];
                  const pct = (count / maxTier) * 100;
                  return (
                    <div key={t}>
                      <div className="flex items-baseline justify-between text-xs mb-1">
                        <span className="font-semibold" style={{ color: RISK_META[t].color }}>
                          {t}
                        </span>
                        <span className="text-muted tabular-nums">{fmtInt(count)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-wash overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: RISK_META[t].color }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted">
              Tiers are a fixed, explainable rule over detection count and
              industrial proximity — not an AI prediction. See{' '}
              <Link to="/about" className="text-pine-deep underline underline-offset-2">
                Data Sources
              </Link>{' '}
              for the exact rule.
            </p>
          </Section>
        </div>
      </div>

      {/* Summary map */}
      <div className="mt-8">
        <Section
          title="India at a glance"
          action={
            <Link
              to="/map"
              className="transition-quiet inline-flex items-center gap-1 text-xs font-medium text-pine-deep hover:text-pine"
            >
              Open live map <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          }
        >
          <div className="h-72 rounded-md overflow-hidden border border-hairline">
            <ThermalMapView
              events={events}
              riskByCode={riskByCode}
              interactive={false}
              showLegend={false}
            />
          </div>
          <p className="mt-2 text-xs text-faint">
            {fmtInt(events.length)} events · {stats?.date_range.from ? fmtDate(stats.date_range.from) : ''} –{' '}
            {stats?.date_range.to ? fmtDate(stats.date_range.to) : ''}
          </p>
        </Section>
      </div>

      {/* How TRACE works */}
      <div className="mt-8">
        <Section title="How TRACE works">
          <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {STEPS.map((s) => (
              <li key={s.n} className="border-t-2 border-pine pt-3">
                <p className="font-mono text-xs text-faint">{s.n}</p>
                <p className="mt-1 font-display font-semibold text-lg text-ink">{s.title}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-[13px] text-muted max-w-prose">
            <Term term="FRP" definition={GLOSSARY.frp} /> (Fire Radiative Power)
            measures how intensely a heat source radiates energy.{' '}
            <Term term="Persistence" definition={GLOSSARY.persistence} /> across
            satellite overpasses is what separates an ongoing source from a
            one-off flash.
          </p>
        </Section>
      </div>
    </div>
  );
};

export default Overview;
