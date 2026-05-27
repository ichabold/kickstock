const KEY         = 'kickstock_pseudo';
// Survives the OAuth redirect — read by AuthWidget after login to apply the pseudo
const PENDING_KEY = 'kickstock_oauth_pending';

export function getPseudo(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY);
}

export function setPseudo(p: string): void {
  localStorage.setItem(KEY, p);
}

export function clearPseudo(): void {
  localStorage.removeItem(KEY);
}

/** Called just before a Google/email OAuth redirect to preserve the guest pseudo. */
export function saveOAuthPending(): void {
  if (typeof window === 'undefined') return;
  const pseudo = localStorage.getItem(KEY);
  if (pseudo) localStorage.setItem(PENDING_KEY, pseudo);
}

export function getOAuthPending(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(PENDING_KEY);
}

export function clearOAuthPending(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(PENDING_KEY);
}

export function isValidPseudoFormat(p: string): boolean {
  if (p.length < 3 || p.length > 20) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(p)) return false;
  if (/^[_-]|[_-]$/.test(p)) return false;
  return true;
}
