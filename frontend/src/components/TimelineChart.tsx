import React, { useMemo } from 'react';
import type { EventDetection } from '../types';
import { fmtDate, fmtDateTime } from '../utils/format';

/**
 * Heat-over-time: one bar per satellite detection, height = FRP.
 * Pure SVG, no chart library. Ember bars (heat), hairline grid —
 * matches the TRACE visual system.
 */
export const TimelineChart: React.FC<{ detections: EventDetection[] }> = ({
  detections,
}) => {
  const { bars, maxFrp, first, last } = useMemo(() => {
    const pts = detections.map((d) => ({
      t: d.timestamp ? new Date(d.timestamp).getTime() : NaN,
      frp: d.frp ?? 0,
      satellite: d.satellite,
      raw: d.timestamp,
    }));
    const max = Math.max(1, ...pts.map((p) => p.frp));
    const times = pts.map((p) => p.t).filter((t) => !Number.isNaN(t));
    return {
      bars: pts,
      maxFrp: max,
      first: times.length ? Math.min(...times) : null,
      last: times.length ? Math.max(...times) : null,
    };
  }, [detections]);

  if (bars.length === 0) return null;

  const W = 600;
  const H = 170;
  const PAD_L = 8;
  const PAD_R = 8;
  const PAD_T = 18;
  const PAD_B = 26;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const n = bars.length;
  const slot = plotW / n;
  const barW = Math.max(2, Math.min(28, slot * 0.72));

  const peakIdx = bars.reduce(
    (best, b, i) => (b.frp > bars[best].frp ? i : best),
    0
  );

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Heat over time: ${n} detections, peak ${maxFrp.toFixed(1)} megawatts`}
      >
        {/* baseline */}
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={H - PAD_B}
          y2={H - PAD_B}
          stroke="#E9E2D5"
          strokeWidth={1}
        />
        {bars.map((b, i) => {
          const h = Math.max(2, (b.frp / maxFrp) * plotH);
          const x = PAD_L + slot * i + (slot - barW) / 2;
          const y = H - PAD_B - h;
          const isPeak = i === peakIdx && n > 1;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={h}
              rx={1}
              fill={isPeak ? '#A33F14' : '#C2521E'}
              opacity={isPeak ? 1 : 0.82}
            >
              <title>
                {b.raw ? fmtDateTime(b.raw) : 'Unknown time'} ·{' '}
                {b.frp.toFixed(1)} MW
                {b.satellite ? ` · ${b.satellite.replace(/_/g, ' ')}` : ''}
              </title>
            </rect>
          );
        })}
        {/* y label: peak */}
        <text
          x={W - PAD_R}
          y={PAD_T - 6}
          textAnchor="end"
          fontSize={11}
          fill="#6E675C"
          fontFamily="'IBM Plex Mono', monospace"
        >
          peak {maxFrp.toFixed(1)} MW
        </text>
        {/* x labels */}
        {first != null && (
          <text
            x={PAD_L}
            y={H - 8}
            fontSize={11}
            fill="#6E675C"
            fontFamily="'IBM Plex Mono', monospace"
          >
            {fmtDate(new Date(first).toISOString())}
          </text>
        )}
        {last != null && last !== first && (
          <text
            x={W - PAD_R}
            y={H - 8}
            textAnchor="end"
            fontSize={11}
            fill="#6E675C"
            fontFamily="'IBM Plex Mono', monospace"
          >
            {fmtDate(new Date(last).toISOString())}
          </text>
        )}
      </svg>
      <figcaption className="mt-1 text-xs text-muted">
        Each bar is one satellite pass · height = fire radiative power (MW).
        Hover a bar for the exact reading.
      </figcaption>
    </figure>
  );
};
