/**
 * WebSocket endpoint discovery.
 *
 * The Django/Channels backend serves real-time endpoints on the same origin as
 * the API (`/ws/...`). `VITE_WS_URL` may be given either as a full ws:// URL or
 * as the http(s) origin the API lives on, so it is normalised here.
 */
const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '');

function resolveWsBase(): string {
  const configured = (import.meta.env.VITE_WS_URL as string | undefined) || '';
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) || '';

  const source = stripTrailingSlash(configured || apiBase);
  if (source) {
    const normalised = source
      .replace(/^https:\/\//i, 'wss://')
      .replace(/^http:\/\//i, 'ws://')
      .replace(/\/api\/v\d+$/i, '');
    if (/^wss?:\/\//i.test(normalised)) return normalised;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:8000`;
}

export const WS_BASE = resolveWsBase();

export const getAccessToken = (): string | null =>
  typeof window === 'undefined'
    ? null
    : localStorage.getItem('greenpath_auth_token');

/** Build an authenticated socket URL for a Channels route, e.g. `ws/chat/<id>/`. */
export function socketUrl(path: string): string {
  const token = getAccessToken();
  const clean = path.replace(/^\/+/, '');
  const withSlash = clean.endsWith('/') ? clean : `${clean}/`;
  return `${WS_BASE}/${withSlash}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}
