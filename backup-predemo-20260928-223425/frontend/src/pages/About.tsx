import React from 'react';
import { PageHeader, Section } from '../components/ui';
import { Term, GLOSSARY, HonestyNote } from '../components/Term';
import { useTraceData } from '../data/TraceDataContext';
import { fmtDate, fmtInt } from '../utils/format';

const PIPELINE = [
  {
    n: '01',
    title: 'Ingest',
    body: 'NASA FIRMS thermal anomaly CSVs (VIIRS SNPP, VIIRS NOAA-20, MODIS) for the India region are downloaded and normalized — 1,868 unique detections in this snapshot.',
  },
  {
    n: '02',
    title: 'Cluster',
    body: 'Detections are grouped into events with haversine DBSCAN (5 km radius, min_samples=1); clusters split when consecutive detections are more than 24 hours apart — 708 events.',
  },
  {
    n: '03',
    title: 'Contextualize',
    body: 'Each event is cross-matched against 14,963 OpenStreetMap industrial facilities (works, power plants, industrial sites, petroleum wells): nearest facility, distance, and counts within 1 and 5 km.',
  },
  {
    n: '04',
    title: 'Serve',
    body: 'Events and facilities live in PostGIS and are served by a FastAPI backend. This dashboard reads them live — every number on screen comes from that API.',
  },
];

export const About: React.FC = () => {
  const { stats } = useTraceData();
  const from = stats?.date_range.from ? fmtDate(stats.date_range.from) : '20 Sept 2026';
  const to = stats?.date_range.to ? fmtDate(stats.date_range.to) : '24 Sept 2026';

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
            {PIPELINE.map((s) => (
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
              This is a <span className="font-semibold text-ink">5-day snapshot ({from} – {to})</span>,
              not a live feed. Refresh cadence is a deployment choice, not a product claim.
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

        <Section title="The attention-tier rule">
          <p className="text-sm leading-relaxed text-muted mb-3">
            Attention tiers are a fixed, explainable heuristic computed from two
            real fields — detection count and distance to the nearest mapped
            facility. There is no model, no training data, and no confidence
            score. The exact rule:
          </p>
          <pre className="rounded-md border border-hairline bg-ink text-paper font-mono text-xs leading-relaxed p-4 overflow-x-auto">
{`CRITICAL:  detections >= 25 AND nearest facility <= 5 km
HIGH:      detections >= 10
           OR (detections >= 3 AND nearest facility <= 1 km)
MEDIUM:    detections >= 3 OR nearest facility <= 5 km
LOW:       everything else`}
          </pre>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Every badge in the product carries its plain-language reasons
            (detection count, span, distance). The tier tells you where to look
            first — never what caused the heat.
          </p>
        </Section>

        <Section title="What TRACE does not do">
          <ul className="space-y-2.5 text-sm leading-relaxed text-muted list-disc pl-5">
            <li>It does not classify fires (industrial, wildfire, agricultural, flare).</li>
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
