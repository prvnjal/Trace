import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export type ConfidenceLevel = 'high' | 'nominal' | 'low';

const ALL_LEVELS: ConfidenceLevel[] = ['high', 'nominal', 'low'];

export function getConfidenceButtonLabel(selected: string[]): string {
  const hasHigh = selected.includes('high');
  const hasNominal = selected.includes('nominal');
  const hasLow = selected.includes('low');

  if (hasHigh && hasNominal && hasLow) {
    return 'Confidence: All';
  }
  const parts: string[] = [];
  if (hasHigh) parts.push('High');
  if (hasNominal) parts.push('Nominal');
  if (hasLow) parts.push('Low');

  if (parts.length === 0) return 'Confidence: All';
  return `Confidence: ${parts.join(' + ')}`;
}

interface ConfidenceFilterProps {
  value: string[];
  onChange: (next: string[]) => void;
  align?: 'left' | 'right';
  className?: string;
}

export const ConfidenceFilter: React.FC<ConfidenceFilterProps> = ({
  value,
  onChange,
  align = 'left',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isAllChecked = ALL_LEVELS.every((lvl) => value.includes(lvl));

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const toggleLevel = (lvl: ConfidenceLevel) => {
    if (value.includes(lvl)) {
      if (value.length <= 1) return;
      onChange(value.filter((item) => item !== lvl));
    } else {
      const next = ALL_LEVELS.filter((item) => value.includes(item) || item === lvl);
      onChange(next);
    }
  };

  const handleSelectAll = () => {
    onChange(['high', 'nominal', 'low']);
  };

  const label = getConfidenceButtonLabel(value);

  return (
    <div ref={containerRef} className={`relative inline-block text-left ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={label}
        className="transition-quiet inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2.5 py-2 text-[13px] text-ink hover:border-pine focus:outline-none focus:ring-1 focus:ring-pine"
      >
        <span>{label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted" aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          className={`absolute z-[100] mt-1 w-72 rounded-sm border border-hairline bg-surface p-3 shadow-lg text-ink ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          role="dialog"
          aria-label="Filter by detection confidence"
        >
          {/* Header */}
          <div className="pb-2">
            <h3 className="text-[13px] font-medium text-ink">Detection confidence (FIRMS)</h3>
            <p className="text-[11px] text-faint leading-tight mt-0.5">
              How sure the satellite is this is fire — not our attention tier.
            </p>
          </div>

          <div className="border-t border-hairline my-2" />

          {/* All reset row */}
          <div className="pb-1">
            <button
              type="button"
              onClick={handleSelectAll}
              disabled={isAllChecked}
              className="transition-quiet w-full text-left rounded px-2 py-1 text-xs font-medium text-pine-deep hover:bg-wash disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              All confidence levels
            </button>
          </div>

          {/* Checkbox rows */}
          <div className="space-y-1">
            {[
              { id: 'high', label: 'High confidence' },
              { id: 'nominal', label: 'Nominal confidence' },
              { id: 'low', label: 'Low confidence' },
            ].map(({ id, label }) => {
              const isChecked = value.includes(id);
              const isDisabled = isChecked && value.length === 1;

              return (
                <label
                  key={id}
                  className={`flex items-center gap-2.5 rounded px-2 py-1.5 text-[13px] transition-quiet select-none ${
                    isDisabled
                      ? 'cursor-not-allowed opacity-60'
                      : 'cursor-pointer hover:bg-wash'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={isDisabled}
                    onChange={() => toggleLevel(id as ConfidenceLevel)}
                    className="rounded border-hairline h-4 w-4 accent-[#1D4A38] focus:ring-pine cursor-pointer disabled:cursor-not-allowed"
                  />
                  <span className="font-medium text-ink">{label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ConfidenceFilter;
