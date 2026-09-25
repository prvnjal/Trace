/**
 * Investigation flags — LOCAL ONLY.
 * Analyst flags stored in this browser's localStorage. There is no backend
 * alerting system; these never leave the machine and are not shared.
 */

export interface InvestigationFlag {
  code: string;
  createdAt: string; // ISO
  acknowledged: boolean;
}

const KEY = 'trace-investigation-flags-v1';

export function loadFlags(): InvestigationFlag[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFlags(flags: InvestigationFlag[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(flags));
  } catch {
    /* storage unavailable — flags simply won't persist */
  }
}

export function isFlagged(code: string): boolean {
  return loadFlags().some((f) => f.code === code);
}

export function addFlag(code: string): InvestigationFlag[] {
  const flags = loadFlags();
  if (!flags.some((f) => f.code === code)) {
    flags.unshift({ code, createdAt: new Date().toISOString(), acknowledged: false });
    saveFlags(flags);
  }
  return flags;
}

export function removeFlag(code: string): InvestigationFlag[] {
  const flags = loadFlags().filter((f) => f.code !== code);
  saveFlags(flags);
  return flags;
}

export function setFlagAcknowledged(code: string, acknowledged: boolean): InvestigationFlag[] {
  const flags = loadFlags().map((f) =>
    f.code === code ? { ...f, acknowledged } : f
  );
  saveFlags(flags);
  return flags;
}
