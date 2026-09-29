import React from 'react';
import { PageHeader, Section } from '../components/ui';
import { Term, GLOSSARY, HonestyNote } from '../components/Term';
import { useTraceData } from '../data/TraceDataContext';
import { fmtDate, fmtInt } from '../utils/format';

const PIPELINE = (stats: {
  total_detections?: number | null;
  total_events?: number | null;
} | null) => [
  {
    n: '01',
    title: 'Ingest',
    body: `NASA FIRMS thermal anomaly CSVs (VIIRS SNPP, VIIRS NOAA-20, MODIS) for the India region are downloaded and normalized — ${fmtInt(stats?.total_detections ?? 0)} unique detections in this snapshot.`,
  },
  {
    n: '02',
    title: 'Cluster',
    body: `Detections are grouped into events with haversine DBSCAN (5 km radius, min_samples=1); clusters split when consecutive detections are more than 24 hours apart — ${fmtInt(stats?.total_events ?? 0)} events.`,
  },
  {
    n: '03',
    title: 'Contextualize',
    body: 'Each event is cross-matched against 14,963 OpenStreetMap industrial facilities (works, power plants, industrial sites, petroleum wells): nearest facility, distance, and counts within 1 and 5 km.',
  },
  {
    n: '04',
    title: 'Assess',
    body: 'A thermal model assigns each event an analyst category — candidate industrial fire, routine flare, persistent thermal source, likely wildfire, or likely agricultural burning — with a confidence score. The model assesses; the analyst decides.',
  },
  {
    n: '05',
    title: 'Serve',
    body: 'Events and facilities live in PostGIS and are served by a FastAPI backend. This dashboard reads them live — every number on screen comes from that API.',
  },
];

export const About: React.FC = () => {
  const { stats } = useTraceData();
  const from = stats?.date_range.from ? fmtDate(stats.date_range.from) : null;
  const to = stats?.date_range.to ? fmtDate(stats.date_range.to) : null;
  const pipeline = PIPELINE(stats);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Data Sources"
        description="Where TRACE data comes from — and what it does not claim."
      />

      <div className="space-y-10">
        <Section title="Sources">
          <div className="space-y-4">
            <div className="rounded-md border border-hairline bg-surface p-5">
              <h3 className="font-display font-semibold text-lg text-ink">
                NASA FIRMS
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                <Term term="NASA FIRMS" definition={GLOSSARY.firms} /> Thermal
                anomaly detections from the VIIRS (375 m) and MODIS (1 km)
                instruments, published in near-real-time with roughly 3 hours of
                latency. Each detection carries a location,{' '}
                <Term term="FRP" definition={GLOSSARY.frp} />, brightness
                temperature, and acquisition time. TRACE clusters raw detections
                into events — it does not alter what the satellites observed.
              </p>
            </div>
            <div className="rounded-md border border-hairline bg-surface p-5">
              <h3 className="font-display font-semibold text-lg text-ink">
                OpenStreetMap
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                <Term term="OpenStreetMap" definition={GLOSSARY.osm} /> TRACE
                uses a local extract of the India planet file filtered to
                industrial tags — {fmtInt(stats?.total_facilities)} facilities
                in this snapshot. Coverage depends on community mapping: an
                unmapped facility is invisible to TRACE, and a mapped one may be
                outdated.
              </p>
            </div>
          </div>
        </Section>

        <Section title="Pipeline">
          <ol className="space-y-5">
            {pipeline.map((s) => (
              <li key={s.n} className="flex gap-4">
                <span className="font-mono text-xs text-faint pt-1 shrink-0">{s.n}</span>
                <div>
                  <p className="font-semibold text-[15px] text-ink">{s.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Dataset honesty">
          <ul className="space-y-2.5 text-sm leading-relaxed text-muted list-disc pl-5">
            <li>
              This is a{' '}
              <span className="font-semibold text-ink">
                5-day snapshot{from && to ? ` (${from} – ${to})` : ''}
              </span>
              , not a live feed. Refresh cadence is a deployment choice, not a product claim.
            </li>
            <li>
              FIRMS latency is measured in hours; a heat source can start and end between overpasses.
            </li>
            <li>
              VIIRS pixels are ~375 m across — a &ldquo;point&rdquo; on the map is an area, not a building.
            </li>
            <li>
              OSM facility data is community-mapped and may be incomplete or stale.
            </li>
          </ul>
          <div className="mt-5">
            <HonestyNote />
          </div>
        </Section>

        <Section title="How TRACE assesses events">
          <p className="text-sm leading-relaxed text-muted mb-4">
            Every event carries <span className="font-semibold text-ink">one assessment</span> —
            the thermal model's analyst category, with a confidence score. It is a hypothesis
            to investigate, not a verified cause: in its latest evaluation the model scored{' '}
            <span className="font-semibold text-ink">69% accuracy against 107 events labeled by hand</span>.
            The model assesses. The analyst decides.
          </p>
          <p className="text-sm leading-relaxed text-muted mb-4">
            Alongside it, a fixed <span className="font-semibold text-ink">attention tier</span> tells
            the analyst where to look first. It is triage, not a verdict — a transparent rule over
            two real fields (detection count, distance to the nearest mapped facility):
          </p>
          <dl className="rounded-md border border-hairline bg-surface divide-y divide-hairline overflow-hidden">
            {[
              ['Critical', '25+ detections within 5 km of a mapped facility'],
              ['High', '10+ detections, or 3+ detections within 1 km of a facility'],
              ['Medium', '3+ detections, or any event within 5 km of a facility'],
              ['Low', 'everything else'],
            ].map(([tier, rule]) => (
              <div key={tier} className="flex items-baseline gap-4 px-4 py-2.5">
                <dt className="w-20 shrink-0 text-xs font-bold uppercase tracking-[0.06em] text-ink">
                  {tier}
                </dt>
                <dd className="text-[13px] text-muted">{rule}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Detection-level <span className="font-semibold text-ink">confidence</span> (high /
            nominal / low) comes straight from the FIRMS feed and describes each satellite
            observation — it is a filter for detections, not a competing verdict on the event.
          </p>
        </Section>

        <Section title="What TRACE does not do">
          <ul className="space-y-2.5 text-sm leading-relaxed text-muted list-disc pl-5">
            <li>It does not confirm causes — model categories are hypotheses that need field verification.</li>
            <li>It does not send alerts or notifications — flags are browser-only notes.</li>
            <li>It does not attribute a thermal event to a nearby facility.</li>
            <li>It does not see inside facility walls — only the thermal picture around them.</li>
            <li>It does not replace field verification, ever.</li>
          </ul>
        </Section>
      </div>
    </div>
  );
};

export default About;
