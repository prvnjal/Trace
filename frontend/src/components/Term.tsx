import React from 'react';
import { Info } from 'lucide-react';

/**
 * Dotted-underline term with a CSS-only tooltip. Used so a newcomer can
 * understand TRACE without knowing FIRMS, OSM, or FRP beforehand.
 */
export const Term: React.FC<{ term: string; definition: string }> = ({
  term,
  definition,
}) => (
  <span className="group/term relative inline-flex">
    <button
      type="button"
      className="underline decoration-dotted underline-offset-[3px] decoration-faint cursor-help font-medium"
    >
      {term}
    </button>
    <span
      role="tooltip"
      className="hidden group-hover/term:block group-focus-within/term:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 rounded-sm bg-ink px-3 py-2 text-xs font-normal leading-relaxed text-paper shadow-restrained z-50 normal-case tracking-normal"
    >
      {definition}
    </span>
  </span>
);

export const GLOSSARY = {
  firms:
    'NASA\u2019s Fire Information for Resource Management System — near-real-time thermal anomaly detections from the VIIRS and MODIS satellite instruments, published roughly every 3 hours.',
  osm: 'OpenStreetMap — a community-maintained map. TRACE uses a local extract of mapped industrial facilities (works, power plants, industrial sites, petroleum wells) as context near thermal events.',
  frp: 'Fire Radiative Power — the rate at which a heat source radiates energy, in megawatts. Higher FRP means a more intense thermal signal at the satellite pixel.',
  brightness:
    'Brightness temperature of the thermal pixel in Kelvin, as reported by the satellite instrument. Higher values indicate a hotter observed surface.',
  persistence:
    'How long a thermal signal keeps reappearing at the same place across satellite overpasses. Repeated detections over days suggest an ongoing heat source rather than a one-off flash.',
};

export const PROXIMITY_NOTE =
  'Proximity to an industrial facility is context for analysts \u2014 not evidence of what caused the thermal event.';

/**
 * The honesty note given room to breathe. Full version for the About page;
 * compact icon + tooltip version for industrial-context sections.
 */
export const HonestyNote: React.FC<{ compact?: boolean }> = ({ compact }) => {
  if (compact) {
    return (
      <span className="group/note relative inline-flex items-center">
        <span className="inline-flex items-center gap-1 text-[11px] text-faint">
          <Info className="w-3.5 h-3.5" aria-hidden="true" />
          Proximity is context, not causation.
        </span>
        <span
          role="tooltip"
          className="hidden group-hover/note:block group-focus-within/note:block absolute bottom-full left-0 mb-2 w-64 rounded-sm bg-ink px-3 py-2 text-xs leading-relaxed text-paper shadow-restrained z-50"
        >
          {PROXIMITY_NOTE}
        </span>
      </span>
    );
  }
  return (
    <blockquote className="border-l-2 border-pine pl-4 py-1 text-sm leading-relaxed text-muted max-w-prose">
      {PROXIMITY_NOTE} A thermal event near a factory may be unrelated to it
      entirely \u2014 field verification is the only way to establish a cause.
    </blockquote>
  );
};
