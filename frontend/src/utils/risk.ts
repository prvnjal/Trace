import type { EventSummary } from '../types';

/**
 * Transparent, rule-based attention tiering for thermal events.
 *
 * This is NOT a machine-learning model and NOT an AI prediction. It is a
 * fixed, explainable heuristic computed client-side from real event fields
 * only (detection count + distance to the nearest mapped industrial
 * facility). Every tier ships with plain-language reasons that are shown
 * in the UI next to the badge.
 *
 * Exact rule (for the record):
 *   CRITICAL: detection_count >= 25 AND nearest facility <= 5 km
 *   HIGH:     detection_count >= 10 OR (detection_count >= 3 AND nearest facility <= 1 km)
 *   MEDIUM:   detection_count >= 3 OR nearest facility <= 5 km
 *   LOW:      everything else
 */

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RiskAssessment {
  tier: RiskTier;
  reasons: string[];
}

export const RISK_META: Record<
  RiskTier,
  { label: string; color: string; softBg: string; rank: number }
> = {
  LOW: { label: 'Low', color: '#2F7D4F', softBg: '#E9F2EC', rank: 0 },
  MEDIUM: { label: 'Medium', color: '#B97F1F', softBg: '#F7EFD9', rank: 1 },
  HIGH: { label: 'High', color: '#C2521E', softBg: '#FAEDE3', rank: 2 },
  CRITICAL: { label: 'Critical', color: '#B3372A', softBg: '#F8E4E0', rank: 3 },
};

export const RISK_TIERS: RiskTier[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

type RiskInputs = Pick<
  EventSummary,
  'detection_count' | 'facility_distance_m' | 'first_detected' | 'last_detected' | 'max_frp'
>;

export function assessRisk(e: RiskInputs): RiskAssessment {
  const n = e.detection_count;
  const dKm = e.facility_distance_m == null ? null : e.facility_distance_m / 1000;
  const reasons: string[] = [];

  let span = '';
  if (e.first_detected && e.last_detected) {
    const days =
      (new Date(e.last_detected).getTime() - new Date(e.first_detected).getTime()) / 86400000;
    if (days >= 1) {
      const r = Math.round(days);
      span = ` across ${r} day${r === 1 ? '' : 's'}`;
    }
  }
  reasons.push(`${n} thermal detection${n === 1 ? '' : 's'}${span}`);
  if (dKm != null) {
    reasons.push(
      `${dKm.toFixed(1)} km from the nearest mapped industrial facility`
    );
  } else {
    reasons.push('no mapped industrial facility in the immediate vicinity');
  }
  if (e.max_frp != null && e.max_frp >= 20) {
    reasons.push(`peak intensity ${e.max_frp.toFixed(1)} MW`);
  }

  let tier: RiskTier = 'LOW';
  if (n >= 25 && dKm != null && dKm <= 5) {
    tier = 'CRITICAL';
  } else if (n >= 10 || (n >= 3 && dKm != null && dKm <= 1)) {
    tier = 'HIGH';
  } else if (n >= 3 || (dKm != null && dKm <= 5)) {
    tier = 'MEDIUM';
  }

  return { tier, reasons };
}
