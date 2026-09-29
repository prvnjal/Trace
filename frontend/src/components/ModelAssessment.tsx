import React from 'react';
import type { MlPrediction } from '../services/api';
import { mlClassLabel } from '../utils/ml';

/**
 * Dossier hero card: the model's assessment of one event.
 * One card — class, confidence, one honesty line. When there is no scored
 * prediction (predictions not loaded, or event codes churned after a
 * refresh), renders a single quiet line instead of the card.
 */
export const ModelAssessment: React.FC<{ prediction: MlPrediction | null }> = ({
  prediction,
}) => {
  if (!prediction) {
    return (
      <p className="text-xs text-faint">No model assessment for this event yet.</p>
    );
  }
  const pct =
    prediction.confidence != null ? Math.round(prediction.confidence * 100) : null;
  return (
    <div className="rounded-md border border-hairline bg-surface px-5 py-5 shadow-restrained">
      <p className="micro-label">Model assessment</p>
      <p className="mt-2 font-display text-[26px] font-semibold tracking-tight text-ink">
        {mlClassLabel(prediction.predicted_label)}
      </p>
      {pct != null && (
        <>
          <div className="mt-3 flex items-baseline gap-2.5">
            <span className="font-display text-[34px] font-semibold leading-none tabular-nums text-ink">
              {pct}%
            </span>
            <span className="text-[13px] text-muted">model confidence</span>
          </div>
          <div
            className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-wash"
            role="img"
            aria-label={`Model confidence ${pct} percent`}
          >
            <div className="h-full rounded-full bg-ember" style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
      <p className="mt-4 border-t border-hairline pt-3 text-xs leading-relaxed text-muted">
        An analyst category from the thermal model — not a confirmed cause.
      </p>
    </div>
  );
};

export default ModelAssessment;
