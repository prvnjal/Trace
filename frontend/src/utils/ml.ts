/** Human-readable names for the thermal model's analyst categories. */

export const ML_CLASS_LABELS: Record<string, string> = {
  ROUTINE_FLARE: 'Routine flare',
  PERSISTENT_THERMAL_SOURCE: 'Persistent thermal source',
  CANDIDATE_INDUSTRIAL_FIRE: 'Candidate industrial fire',
  LIKELY_WILDFIRE: 'Likely wildfire',
  LIKELY_AG_BURNING: 'Likely agricultural burning',
};

/** Short labels for tight spaces (chart axes). */
export const ML_CLASS_SHORT: Record<string, string> = {
  ROUTINE_FLARE: 'Flare',
  PERSISTENT_THERMAL_SOURCE: 'Persistent heat',
  CANDIDATE_INDUSTRIAL_FIRE: 'Candidate fire',
  LIKELY_WILDFIRE: 'Wildfire',
  LIKELY_AG_BURNING: 'Ag burning',
};

/** Display order: the classes an analyst most wants to triage, first. */
export const ML_CLASS_ORDER = [
  'CANDIDATE_INDUSTRIAL_FIRE',
  'ROUTINE_FLARE',
  'PERSISTENT_THERMAL_SOURCE',
  'LIKELY_WILDFIRE',
  'LIKELY_AG_BURNING',
];

export const mlClassLabel = (code: string): string =>
  ML_CLASS_LABELS[code] ?? code;

/** Honest eval note, shown only for the model version it describes. */
export const mlEvalNote = (modelVersion: string | null): string | null =>
  modelVersion === 'ml-poc-1'
    ? 'Eval accuracy 69% on 107 human-labeled events'
    : null;
