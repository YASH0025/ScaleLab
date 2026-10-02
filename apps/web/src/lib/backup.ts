import type { DesignSnapshot } from '@/store/design-doc';

/**
 * Before a shared link replaces the canvas, the visitor's own design is kept here
 * so "Restore my previous design" can bring it back.
 */
const KEY = 'scalelab-backup';

export function saveBackup(design: DesignSnapshot): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(design));
    return true;
  } catch {
    return false;
  }
}

export function loadBackup(): DesignSnapshot | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DesignSnapshot) : undefined;
  } catch {
    return undefined;
  }
}

export function clearBackup(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable; nothing to clear */
  }
}
