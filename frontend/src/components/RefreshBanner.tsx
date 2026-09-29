import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTraceData } from '../data/TraceDataContext';
import { fetchRefreshStatus, resetRefresh, type RefreshJobStatus } from '../services/api';
import { fmtDateTime } from '../utils/format';

/** Data older than this counts as stale (scheduled refresh runs every 6 h). */
const STALE_AFTER_HOURS = 12;
/** While a refresh runs, re-poll its status this often. */
const POLL_MS = 30000;

const timeAgo = (iso: string): string => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.round(hours / 24)} day${Math.round(hours / 24) === 1 ? '' : 's'}`;
};

/**
 * Honesty banner: surfaces a failed, stuck, or stale FIRMS refresh instead of
 * letting the dashboard silently go out of date. Polls the job status while a
 * refresh runs, so "Refreshing…" always shows real elapsed time and the
 * current stage. Hidden when printing briefs.
 */
export const RefreshBanner: React.FC = () => {
  const { refreshJob: initialJob, dataStatus, refreshNow, refreshing } = useTraceData();
  const [job, setJob] = useState<RefreshJobStatus | null>(initialJob);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    setJob(initialJob);
  }, [initialJob]);

  // Keep the status live while a refresh is running — whether it was started
  // from this banner, the Overview button, or the 6-hour scheduler.
  useEffect(() => {
    if (job?.state !== 'running' && !refreshing) return;
    const t = window.setInterval(async () => {
      try {
        setJob(await fetchRefreshStatus());
      } catch {
        /* keep the last known state */
      }
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [job?.state, refreshing]);

  const resetStuck = async () => {
    setResetting(true);
    try {
      // Clear the wedged state so the trigger below is accepted (a stale job
      // no longer blocks new refreshes on the server either, but reset first
      // so the status line starts clean).
      await resetRefresh();
    } catch {
      /* fall through — trigger anyway */
    }
    // Trigger a fresh refresh, poll it, and reload the dashboard when it
    // finishes — or surface the failure instead of spinning forever.
    await refreshNow();
    setResetting(false);
  };

  const banner = useMemo(() => {
    if (job?.state === 'failed') {
      const stuck = !!job.stale;
      return {
        kind: 'error' as const,
        text: stuck
          ? 'The data refresh got stuck (over 3 hours) and was marked as failed.'
          : `Last data refresh failed${job.detail ? ` — ${job.detail}` : ''}.`,
        sub: stuck
          ? 'No data was harmed — the previous dataset is still showing. Reset the stuck state and start a fresh refresh below.'
          : `Showing data from ${dataStatus?.refreshed_at ? fmtDateTime(dataStatus.refreshed_at) : 'the last successful refresh'}. Check the API logs, then try again.`,
        action: stuck ? (
          <button
            type="button"
            onClick={resetStuck}
            disabled={resetting || refreshing}
            className="transition-quiet mt-2 inline-flex items-center gap-1.5 rounded-sm border border-[#B3372A]/40 px-2.5 py-1 text-xs font-semibold text-[#8A3A12] hover:bg-[#B3372A]/10 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${resetting || refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            {refreshing ? 'Refreshing…' : resetting ? 'Resetting…' : 'Reset & refresh'}
          </button>
        ) : undefined,
      };
    }
    if (job?.state === 'running' || refreshing) {
      const startedAt = job?.started_at ?? null;
      const elapsed = startedAt ? ` · ${timeAgo(startedAt)} elapsed` : '';
      return {
        kind: 'info' as const,
        text: `Refreshing data from FIRMS…${elapsed}`,
        sub: `${job?.detail ?? 'Working'}. Full refreshes can take up to an hour — satellite fetch plus map tagging of new events.`,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, dataStatus, resetting, refreshing]);

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
        {banner.action}
      </div>
    </div>
  );
};
