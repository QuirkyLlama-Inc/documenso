import { NEXT_PUBLIC_WEBAPP_URL } from '../constants/app';
import { env } from './env';

/**
 * Hosts a reverse proxy may serve this app from, in addition to
 * `NEXT_PUBLIC_WEBAPP_URL`. Configured through the comma-separated
 * `NEXT_PRIVATE_ALLOWED_PROXY_HOSTS`: an entry starting with "." matches any
 * subdomain of it (".proxy.example.com"), anything else matches exactly.
 *
 * Useful for dev environments where each instance gets its own proxy hostname
 * that is only known at request time. Empty by default, which keeps
 * `NEXT_PUBLIC_WEBAPP_URL` as the only trusted origin.
 */
export const getAllowedProxyHosts = (): string[] => {
  const value = env('NEXT_PRIVATE_ALLOWED_PROXY_HOSTS') ?? '';

  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
};

const stripPort = (host: string) => host.replace(/:\d+$/, '');

export const isAllowedProxyHost = (host: string): boolean => {
  const hostname = stripPort(host.trim().toLowerCase());

  return getAllowedProxyHosts().some((entry) =>
    entry.startsWith('.') ? hostname.endsWith(entry) && hostname.length > entry.length : hostname === entry,
  );
};

const firstHeaderValue = (value: string | null) => value?.split(',')[0]?.trim() || null;

const VALID_HOST_REGEX = /^[a-z0-9.-]+(:\d+)?$/i;

/**
 * The web app URL as the browser sees it for this request.
 *
 * When the request arrived through an allowed proxy host (via
 * `X-Forwarded-Host`, falling back to `Host`), returns that origin plus the
 * configured base path. Otherwise returns `NEXT_PUBLIC_WEBAPP_URL`.
 */
export const getRequestWebAppUrl = (request: Request): string => {
  const configured = NEXT_PUBLIC_WEBAPP_URL();

  if (getAllowedProxyHosts().length === 0) {
    return configured;
  }

  const host = firstHeaderValue(request.headers.get('x-forwarded-host')) ?? request.headers.get('host');

  if (!host || !VALID_HOST_REGEX.test(host) || !isAllowedProxyHost(host)) {
    return configured;
  }

  // Proxies terminate TLS, so assume https unless told otherwise.
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
  const protocol = forwardedProto === 'http' ? 'http' : 'https';

  let basePath = '';

  try {
    basePath = new URL(configured).pathname.replace(/\/$/, '');
  } catch {
    // Keep an empty base path.
  }

  return `${protocol}://${host.toLowerCase()}${basePath}`;
};
