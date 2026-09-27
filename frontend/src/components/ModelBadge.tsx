import React from 'react';
import type { MlPrediction } from '../services/api';
import { mlClassLabel } from '../utils/ml';

/**
 * Compact model badge for table rows, alerts and anywhere space is tight:
 * class name + confidence. Never color-coded alone — the class is text.
 */
export const ModelBadge: React.FC<{
  prediction: MlPrediction;
  className?: string;
}> = ({ prediction, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border border-hairline bg-wash/50 px-2 py-0.5 text-[11px] ${className}`}
    title={`Model assessment (${prediction.model_version}) — an analyst category, not a confirmed cause.`}
  >
    <span className="font-medium text-ink">{mlClassLabel(prediction.predicted_label)}</span>
    {prediction.confidence != null && (
      <span className="tabular-nums text-muted">
        {Math.round(prediction.confidence * 100)}%
      </span>
    )}
  </span>
);

export default ModelBadge;
