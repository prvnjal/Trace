import React from 'react';
import { RISK_META, RiskAssessment } from '../utils/risk';

/**
 * Risk tier badge. Always renders the tier as TEXT plus a colored dot —
 * risk is never communicated by color alone. Hover/focus reveals the
 * plain-language reasons via the title attribute; detail pages render
 * <RiskReasons> for the full list.
 */
export const RiskBadge: React.FC<{
  assessment: RiskAssessment;
  size?: 'sm' | 'md';
  className?: string;
}> = ({ assessment, size = 'sm', className = '' }) => {
  const meta = RISK_META[assessment.tier];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border font-semibold uppercase tracking-[0.06em] ${
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
      } ${className}`}
      style={{
        color: meta.color,
        borderColor: meta.color,
        backgroundColor: meta.softBg,
      }}
      title={assessment.reasons.join(' · ')}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: meta.color }}
        aria-hidden="true"
      />
      {assessment.tier}
    </span>
  );
};

export const RiskReasons: React.FC<{ assessment: RiskAssessment }> = ({
  assessment,
}) => (
  <ul className="space-y-1.5">
    {assessment.reasons.map((r, i) => (
      <li key={i} className="flex items-start gap-2 text-[13px] text-ink">
        <span
          className="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: RISK_META[assessment.tier].color }}
          aria-hidden="true"
        />
        {r}
      </li>
    ))}
  </ul>
);

export default RiskBadge;
