import React from 'react';
import { SystemStatistics } from '../types';
import { Flame, Zap, Factory, MapPin } from 'lucide-react';

interface MetricCardsProps {
  stats: SystemStatistics | null;
  loading: boolean;
}

export const MetricCards: React.FC<MetricCardsProps> = ({ stats, loading }) => {
  const pct5 =
    stats && stats.total_events > 0
      ? Math.round((100 * stats.events_within_5km_of_facility) / stats.total_events)
      : 0;

  const cards = [
    {
      title: 'THERMAL EVENTS',
      value: stats?.total_events ?? 0,
      subtext: 'clustered hotspots',
      icon: Flame,
      color: 'from-amber-500/20 to-orange-500/10 border-amber-500/30 text-amber-400',
      iconBg: 'bg-amber-500/20 text-amber-400',
    },
    {
      title: 'SATELLITE DETECTIONS',
      value: stats?.total_detections ?? 0,
      subtext: 'VIIRS + MODIS',
      icon: Zap,
      color: 'from-sky-500/20 to-blue-600/10 border-sky-500/30 text-sky-400',
      iconBg: 'bg-sky-500/20 text-sky-400',
    },
    {
      title: 'INDUSTRIAL FACILITIES',
      value: stats?.total_facilities ?? 0,
      subtext: 'from OpenStreetMap',
      icon: Factory,
      color: 'from-slate-500/20 to-slate-600/10 border-slate-500/30 text-slate-300',
      iconBg: 'bg-slate-500/20 text-slate-300',
    },
    {
      title: 'EVENTS NEAR INDUSTRY',
      value: stats?.events_within_5km_of_facility ?? 0,
      subtext: `≤ 5 km · ${pct5}% of events`,
      icon: MapPin,
      color: 'from-emerald-500/20 to-green-600/10 border-emerald-500/30 text-emerald-400',
      iconBg: 'bg-emerald-500/20 text-emerald-400',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-[#0c1220] border-b border-slate-800">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <div
            key={idx}
            className={`p-3.5 rounded-xl border bg-gradient-to-br ${card.color} shadow-sm backdrop-blur-sm transition hover:scale-[1.02] cursor-default`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold tracking-wider text-slate-300">
                {card.title}
              </span>
              <div className={`p-1.5 rounded-lg ${card.iconBg}`}>
                <Icon className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              {loading ? (
                <div className="h-8 w-16 bg-slate-800 animate-pulse rounded"></div>
              ) : (
                <span className="text-2xl font-black font-mono text-slate-50 tracking-tight">
                  {card.value.toLocaleString('en-IN')}
                </span>
              )}
              <span className="text-[10px] text-slate-400 font-medium">{card.subtext}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
