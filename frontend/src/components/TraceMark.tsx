import React from 'react';

/**
 * The single TRACE brand mark. Abstract geometric symbol:
 * a thin orbital ring (pine) with a traced arc segment (ink) ending in a
 * small thermal point (ember), over a faint instrument reticle.
 * Pure flat SVG geometry — no gradients, no glow, no flame.
 * Used for: sidebar logo, splash, favicon, loading mark.
 */
export const TraceMark: React.FC<{
  size?: number;
  className?: string;
  label?: string;
  /** Lighten ink elements for use on dark backgrounds (e.g. the splash). */
  dark?: boolean;
}> = ({ size = 24, className, label = 'TRACE', dark = false }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    className={className}
    role="img"
    aria-label={label}
  >
    <circle cx="16" cy="16" r="11.5" stroke="#1D4A38" strokeWidth="2.25" />
    <path
      d="M 7.87 7.87 A 11.5 11.5 0 0 1 24.13 7.87"
      stroke={dark ? '#EDE8DC' : '#1A1712'}
      strokeWidth="2.25"
      strokeLinecap="round"
    />
    <path
      d="M 16 13.4 v 5.2 M 13.4 16 h 5.2"
      stroke="#A39A8B"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <circle
      cx="24.13"
      cy="7.87"
      r="3.3"
      fill="#C2521E"
      stroke="#FAFAF7"
      strokeWidth="1.25"
    />
  </svg>
);

export default TraceMark;
