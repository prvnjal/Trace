import React, { useMemo } from 'react';
import type { EventDetection } from '../types';
import { satLabel, fmtDate } from '../utils/format';

/**
 * Satellite corroboration: one row per instrument, one tick per detection,
 * positioned on the event's own time axis. The analyst can see at a glance
 * whether the heat was caught by one sensor or independently by several.
 * Pure SVG, TRACE visual system.
 */
const SAT_ORDER = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'MODIS_NRT'];
const SAT_COLORS: Record<string, string> = {
  VIIRS_SNPP_NRT: '#C2521E', // ember
  VIIRS_NOAA20_NRT: '#1D4A38', // pine
  MODIS_NRT: '#C98A2D', // clay
};
const FALLBACK = '#5B6570';

interface Row {
  sat: string;
  color: string;
  xs: number[]; // 0..1 positions along the time axis
  count: number;
}

export const SatelliteStrip: React.FC<{ detections: EventDetection[] }> = ({
  detections,
}) => {
  const { rows, first, last } = useMemo(() => {
    const pts = detections
      .map((d) => ({
        t: d.timestamp ? new Date(d.timestamp).getTime() : NaN,
        sat: d.satellite ?? 'unknown',
      }))
      .filter((p) => !Number.isNaN(p.t));
    if (pts.length === 0) return { rows: [] as Row[], first: 0, last: 0 };
    const f = Math.min(...pts.map((p) => p.t));
    const l = Math.max(...pts.map((p) => p.t));
    const span = Math.max(1, l - f);
    const sats = SAT_ORDER.filter((s) => pts.some((p) => p.sat === s));
    pts.forEach((p) => {
      if (!sats.includes(p.sat)) sats.push(p.sat);
    });
    return {
      rows: sats.map((s) => {
        const mine = pts.filter((p) => p.sat === s);
        return {
          sat: s,
          color: SAT_COLORS[s] ?? FALLBACK,
          xs: mine.map((p) => (p.t - f) / span),
          count: mine.length,
        };
      }),
      first: f,
      last: l,
    };
  }, [detections]);

  if (rows.length === 0) return null;

  const W = 640;
  const labelW = 150;
  const pr = 14;
  const pw = W - labelW - pr;
  const rowH = 28;
  const gap = 12;
  const top = 12;
  const axisH = 24;
  const H = top + rows.length * (rowH + gap) - gap + axisH;

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Satellite corroboration: ${rows
          .map((r) => `${satLabel(r.sat)} ${r.count}`)
          .join(', ')} detections`}
      >
        {rows.map((r, ri) => {
          const y = top + ri * (rowH + gap);
          return (
            <g key={r.sat}>
              <text
                x={labelW - 12}
                y={y + rowH / 2 + 4}
                fontSize={12}
                fill="#5B6570"
                textAnchor="end"
              >
                {satLabel(r.sat)}
              </text>
              <rect
                x={labelW}
                y={y}
                width={pw}
                height={rowH}
                rx={5}
                fill="#F5F0E6"
              />
              {r.xs.map((x, i) => (
                <rect
                  key={i}
                  x={(labelW + x * pw - 2).toFixed(1)}
                  y={y + 5}
                  width={4}
                  height={rowH - 10}
                  rx={2}
                  fill={r.color}
                  opacity={0.9}
                />
              ))}
            </g>
          );
        })}
        {/* count badges + time axis */}
        {rows.map((r, ri) => {
          const y = top + ri * (rowH + gap);
          return (
            <text
              key={`c-${r.sat}`}
              x={labelW + pw - 8}
              y={y + rowH / 2 + 4}
              fontSize={11}
              fill="#8A8177"
              textAnchor="end"
            >
              {r.count}
            </text>
          );
        })}
        <text x={labelW} y={H - 6} fontSize={11} fill="#8A8177">
          {fmtDate(new Date(first).toISOString())}
        </text>
        <text x={W - pr} y={H - 6} fontSize={11} fill="#8A8177" textAnchor="end">
          {fmtDate(new Date(last).toISOString())}
        </text>
      </svg>
      <figcaption className="mt-2 text-xs text-muted">
        {rows.length} instrument{rows.length === 1 ? '' : 's'} ·{' '}
        {rows.map((r) => `${satLabel(r.sat)} ${r.count}`).join(' · ')}
      </figcaption>
    </figure>
  );
};
