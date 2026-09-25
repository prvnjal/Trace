import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Trash2 } from 'lucide-react';
import { useTraceData } from '../data/TraceDataContext';
import { PageHeader, EmptyState } from '../components/ui';
import { RiskBadge } from '../components/RiskBadge';
import {
  loadFlags,
  removeFlag,
  setFlagAcknowledged,
  InvestigationFlag,
} from '../utils/flags';
import { fmtDateTime } from '../utils/format';

export const Alerts: React.FC = () => {
  const { events, riskByCode } = useTraceData();
  const [flags, setFlags] = useState<InvestigationFlag[]>(() => loadFlags());

  const eventByCode = (code: string) => events.find((e) => e.event_code === code);

  const acknowledge = (code: string, v: boolean) =>
    setFlags(setFlagAcknowledged(code, v));
  const dismiss = (code: string) => setFlags(removeFlag(code));

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Investigation Flags"
        description="Events you flagged for follow-up."
      />

      <div className="mb-6 rounded-md border border-hairline bg-wash/60 px-4 py-3">
        <p className="text-[13px] leading-relaxed text-muted">
          <span className="font-semibold text-ink">Browser-only.</span> These
          flags are stored in this browser&apos;s local storage by the analyst —
          TRACE has no backend alerting system, sends no notifications, and
          shares nothing. Clearing browser data removes them.
        </p>
      </div>

      {flags.length === 0 ? (
        <EmptyState
          title="No flagged events"
          hint="Open any event and choose “Flag for investigation” to keep it on this list."
          action={
            <Link
              to="/events"
              className="transition-quiet rounded-sm bg-pine px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-pine-deep"
            >
              Browse events
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-hairline rounded-md border border-hairline bg-surface">
          {flags.map((f) => {
            const e = eventByCode(f.code);
            const risk = riskByCode.get(f.code);
            return (
              <li
                key={f.code}
                className={`flex flex-wrap items-center gap-3 px-4 py-3 ${f.acknowledged ? 'opacity-60' : ''}`}
              >
                {risk && <RiskBadge assessment={risk} />}
                <div className="min-w-0">
                  <Link
                    to={`/events/${encodeURIComponent(f.code)}`}
                    className="font-mono text-[13px] font-semibold text-pine-deep hover:text-pine tabular-nums"
                  >
                    {f.code}
                  </Link>
                  <p className="text-xs text-faint tabular-nums">
                    Flagged {fmtDateTime(f.createdAt)}
                    {e ? ` · ${e.detection_count} detections` : ' · not in current dataset'}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => acknowledge(f.code, !f.acknowledged)}
                    aria-pressed={f.acknowledged}
                    className={`transition-quiet inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-xs font-medium ${
                      f.acknowledged
                        ? 'border-pine bg-pine-soft text-pine-deep'
                        : 'border-hairline text-muted hover:text-ink'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    {f.acknowledged ? 'Acknowledged' : 'Acknowledge'}
                  </button>
                  <button
                    type="button"
                    onClick={() => dismiss(f.code)}
                    aria-label={`Remove flag for ${f.code}`}
                    className="transition-quiet p-2 rounded-sm text-faint hover:text-[#B3372A] hover:bg-wash"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default Alerts;
