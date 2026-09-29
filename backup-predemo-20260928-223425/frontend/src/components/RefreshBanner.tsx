import React, { useMemo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTraceData } from '../data/TraceDataContext';
import { fmtDateTime } from '../utils/format';

/** Data older than this counts as stale (scheduled refresh runs every 6 h). */
const STALE_AFTER_HOURS = 12;

const timeAgo = (iso: string): string => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.round(hours / 24)} day${Math.round(hours / 24) === 1 ? '' : 's'}`;
};

/**
 * Honesty banner: surfaces a failed or stale FIRMS refresh instead of letting
 * the dashboard silently go out of date. Hidden when printing briefs.
 */
export const RefreshBanner: React.FC = () => {
  const { refreshJob, dataStatus } = useTraceData();

  const banner = useMemo(() => {
    if (refreshJob?.state === 'failed') {
      return {
        kind: 'error' as const,
        text: `Last data refresh failed${refreshJob.detail ? ` — ${refreshJob.detail}` : ''}.`,
        sub: dataStatus?.refreshed_at
          ? `Showing data from ${fmtDateTime(dataStatus.refreshed_at)}.`
          : 'No successful refresh recorded yet.',
      };
    }
    if (refreshJob?.state === 'running') {
      return {
        kind: 'info' as const,
        text: 'Refreshing data from FIRMS…',
        sub: 'The dashboard will update when it finishes.',
      };
    }
    const at = dataStatus?.refreshed_at;
    if (at) {
      const ageHours = (Date.now() - new Date(at).getTime()) / 3600000;
      if (ageHours > STALE_AFTER_HOURS) {
        return {
          kind: 'warn' as const,
          text: `Data is stale — last updated ${timeAgo(at)} ago.`,
          sub: 'Automatic refresh runs every 6 hours; check that the stack is running.',
        };
      }
    }
    return null;
  }, [refreshJob, dataStatus]);

  if (!banner) return null;

  const styles =
    banner.kind === 'error'
      ? 'border-ember/50 bg-[#FBF1E8] text-[#8A3A12]'
      : banner.kind === 'warn'
        ? 'border-hairline bg-surface text-muted'
        : 'border-hairline bg-surface text-muted';

  return (
    <div
      role={banner.kind === 'error' ? 'alert' : 'status'}
      className={`no-print mb-5 flex items-start gap-2.5 rounded-md border px-4 py-3 text-[13px] ${styles}`}
    >
      {banner.kind === 'error' ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      ) : banner.kind === 'info' ? (
        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <div>
        <p className="font-semibold leading-snug">{banner.text}</p>
        <p className="mt-0.5 leading-snug opacity-90">{banner.sub}</p>
      </div>
    </div>
  );
};
