/**
 * Resolve the public origin of a request that arrived through a trusted reverse proxy.
 *
 * Some environments (remote devboxes, preview deployments) serve the app from a
 * hostname that isn't known ahead of time, so `NEXT_PUBLIC_WEBAPP_URL` can't be
 * set to it. When `NEXT_PRIVATE_TRUSTED_PROXY_HOSTS` is configured, a request whose
 * forwarded host matches one of those entries is treated as being served from that
 * origin instead.
 *
 * Only enable this behind a proxy that overwrites `X-Forwarded-Host`, `X-Forwarded-Proto`
 * and `Host`. Anyone able to reach the app directly can pick any host matching the list.
 */

const ALLOWED_PROTOCOLS = new Set(['http', 'https']);

// Hostname (letters, digits, dots, dashes) with an optional port. Rejects
// anything that could smuggle a path, credentials or a scheme into the origin.
const HOST_PATTERN = /^[a-z0-9.-]+(?::\d{1,5})?$/;

/**
 * Parse a comma-separated list of trusted hosts.
 *
 * An entry starting with "." matches any subdomain of it (".proxy.example.com"),
 * otherwise the hostname must match exactly.
 */
export const parseTrustedProxyHosts = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
};

export const resolveTrustedProxyOrigin = (request: Request, trustedHosts: string[]): string | undefined => {
  if (trustedHosts.length === 0) {
    return undefined;
  }

  const requestUrl = new URL(request.url);

  // The Node adapter builds `request.url` from the Host header, so it is the fallback.
  const host = getFirstHeaderValue(request, 'x-forwarded-host') ?? requestUrl.host.toLowerCase();

  if (!host || !HOST_PATTERN.test(host)) {
    return undefined;
  }

  const hostname = host.replace(/:\d+$/, '');

  const isTrusted = trustedHosts.some((trustedHost) =>
    trustedHost.startsWith('.') ? hostname.endsWith(trustedHost) : hostname === trustedHost,
  );

  if (!isTrusted) {
    return undefined;
  }

  const forwardedProtocol = getFirstHeaderValue(request, 'x-forwarded-proto');

  const protocol =
    forwardedProtocol && ALLOWED_PROTOCOLS.has(forwardedProtocol)
      ? forwardedProtocol
      : requestUrl.protocol.replace(':', '');

  return `${protocol}://${host}`;
};

const getFirstHeaderValue = (request: Request, name: string) => {
  const value = request.headers.get(name)?.split(',')[0]?.trim().toLowerCase();

  return value || undefined;
};
