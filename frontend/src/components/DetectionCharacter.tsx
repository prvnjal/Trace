import React, { useMemo } from 'react';
import type { EventDetection } from '../types';

/**
 * Detection character: when the heat burns (day/night split) and how much
 * the sensors trust the pile (confidence mix). Descriptive only — it
 * describes the recorded detections, never what caused the heat.
 * Pure SVG, TRACE visual system.
 */
export const DetectionCharacter: React.FC<{ detections: EventDetection[] }> = ({
  detections,
}) => {
  const { day, night, conf } = useMemo(() => {
    let day = 0;
    let night = 0;
    const conf = { high: 0, nominal: 0, low: 0 };
    detections.forEach((d) => {
      const dn = (d.daynight ?? '').toUpperCase();
      if (dn === 'D') day += 1;
      else if (dn === 'N') night += 1;
      const c = (d.confidence ?? '').toLowerCase();
      if (c === 'high') conf.high += 1;
      else if (c === 'low') conf.low += 1;
      else conf.nominal += 1;
    });
    return { day, night, conf };
  }, [detections]);

  const total = detections.length;
  if (total === 0) return null;
  const dayFrac = day / total;

  const confRows: { label: string; frac: number; color: string }[] = [
    { label: 'High', frac: conf.high / total, color: '#1D4A38' },
    { label: 'Nominal', frac: conf.nominal / total, color: '#C98A2D' },
    { label: 'Low', frac: conf.low / total, color: '#A39A8B' },
  ];

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <p className="mb-3 text-[11px] tracking-[0.18em] text-muted">
          DAY / NIGHT SPLIT
        </p>
        <svg viewBox="0 0 300 86" className="w-full" role="img"
          aria-label={`Day night split: ${day} day, ${night} night detections`}>
          <rect x={8} y={14} width={240} height={26} rx={6} fill="#F5F0E6" />
          {dayFrac > 0 && (
            <rect x={8} y={14} width={(240 * dayFrac).toFixed(1)} height={26}
              rx={6} fill="#C2521E" opacity={0.85} />
          )}
          <text x={8} y={62} fontSize={12} fill="#5B6570">
            Day {Math.round(dayFrac * 100)}% ({day})
          </text>
          <text x={248} y={62} fontSize={12} fill="#5B6570" textAnchor="end">
            Night {Math.round((1 - dayFrac) * 100)}% ({night})
          </text>
        </svg>
        <p className="mt-1 text-xs text-muted">
          Continuous day-and-night burning fits ongoing operation; daytime-only
          fits field burning.
        </p>
      </div>
      <div>
        <p className="mb-3 text-[11px] tracking-[0.18em] text-muted">
          CONFIDENCE MIX
        </p>
        <svg viewBox="0 0 300 86" className="w-full" role="img"
          aria-label={`Confidence mix: high ${conf.high}, nominal ${conf.nominal}, low ${conf.low}`}>
          {confRows.map((r, i) => {
            const y = 6 + i * 26;
            return (
              <g key={r.label}>
                <text x={4} y={y + 13} fontSize={12} fill="#5B6570">
                  {r.label}
                </text>
                <rect x={70} y={y} width={168} height={14} rx={4} fill="#F5F0E6" />
                {r.frac > 0 && (
                  <rect x={70} y={y} width={(168 * r.frac).toFixed(1)}
                    height={14} rx={4} fill={r.color} opacity={0.85} />
                )}
                <text x={246} y={y + 13} fontSize={12} fill="#8A8177">
                  {Math.round(r.frac * 100)}%
                </text>
              </g>
            );
          })}
        </svg>
        <p className="mt-1 text-xs text-muted">
          Sensor confidence per detection — how much weight to give the pile.
        </p>
      </div>
    </div>
  );
};
