import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/** Page title block: serif title + one-line description + optional actions. */
export const PageHeader: React.FC<{
  title: string;
  description: string;
  actions?: React.ReactNode;
}> = ({ title, description, actions }) => (
  <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
    <div className="min-w-0">
      <h1 className="font-display font-semibold text-[28px] leading-tight tracking-tight text-ink">
        {title}
      </h1>
      <p className="mt-1 text-sm text-muted max-w-prose">{description}</p>
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

/** Content section with micro-label heading and hairline rule. */
export const Section: React.FC<{
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, action, children, className = '' }) => (
  <section className={className} aria-label={title}>
    <div className="flex items-center justify-between gap-3 pb-2 border-b border-hairline mb-4">
      <h2 className="micro-label">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

/** Big typographic metric: Fraunces numeral + micro-label + muted sub-note. */
export const Stat: React.FC<{ label: string; value: string; sub?: string }> = ({
  label,
  value,
  sub,
}) => (
  <div className="min-w-0">
    <p className="micro-label">{label}</p>
    <p className="mt-1.5 font-display font-semibold text-[34px] leading-none tracking-tight text-ink tabular-nums">
      {value}
    </p>
    {sub && <p className="mt-1.5 text-xs text-muted">{sub}</p>}
  </div>
);

export const EmptyState: React.FC<{
  title: string;
  hint?: string;
  action?: React.ReactNode;
}> = ({ title, hint, action }) => (
  <div className="flex flex-col items-center justify-center text-center py-14 px-6">
    <p className="font-display font-semibold text-lg text-ink">{title}</p>
    {hint && <p className="mt-1.5 text-sm text-muted max-w-sm">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const ErrorState: React.FC<{ message: string; onRetry?: () => void }> = ({
  message,
  onRetry,
}) => (
  <div className="flex flex-col items-center justify-center text-center py-14 px-6">
    <AlertTriangle className="w-6 h-6 text-ember-deep" aria-hidden="true" />
    <p className="mt-3 font-display font-semibold text-lg text-ink">
      Something couldn&apos;t be loaded
    </p>
    <p className="mt-1.5 text-sm text-muted max-w-sm">{message}</p>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="transition-quiet mt-4 inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:border-pine hover:text-pine-deep"
      >
        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
        Retry
      </button>
    )}
  </div>
);

export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded-sm bg-wash ${className}`} aria-hidden="true" />
);

export const SkeletonRows: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="space-y-2.5 py-2" aria-hidden="true" aria-label="Loading">
    {Array.from({ length: rows }).map((_, i) => (
      <Skeleton key={i} className="h-9 w-full" />
    ))}
  </div>
);

/** Definition-list row used in dossier-style panels. */
export const DefRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5">
    <dt className="text-xs text-muted shrink-0">{label}</dt>
    <dd className="text-[13px] font-semibold text-ink text-right tabular-nums">
      {children}
    </dd>
  </div>
);
