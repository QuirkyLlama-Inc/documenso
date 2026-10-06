import {
  parseTrustedProxyHosts,
  resolveTrustedProxyOrigin,
} from '@documenso/lib/server-only/proxy/trusted-proxy-origin';
import { setRequestWebappUrlResolver } from '@documenso/lib/universal/request-webapp-url';
import { env } from '@documenso/lib/utils/env';
import type { Context, Next } from 'hono';
import { tryGetContext } from 'hono/context-storage';

import type { HonoEnv } from './router';

const TRUSTED_PROXY_HOSTS = parseTrustedProxyHosts(env('NEXT_PRIVATE_TRUSTED_PROXY_HOSTS'));

setRequestWebappUrlResolver(() => tryGetContext<HonoEnv>()?.var.webappUrl);

/**
 * Serve requests from a trusted proxy host as that host's origin.
 *
 * When the forwarded host matches `NEXT_PRIVATE_TRUSTED_PROXY_HOSTS`, store its
 * origin on the request context so `NEXT_PUBLIC_WEBAPP_URL()` returns it for the
 * rest of the request. Must run after `contextStorage()`.
 */
export const trustedProxyOriginMiddleware = (c: Context<HonoEnv>, next: Next) => {
  const origin = resolveTrustedProxyOrigin(c.req.raw, TRUSTED_PROXY_HOSTS);

  if (origin) {
    c.set('webappUrl', origin);
  }

  return next();
};
