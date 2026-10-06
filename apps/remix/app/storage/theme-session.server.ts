import { getCookieDomain, useSecureCookies } from '@documenso/lib/constants/auth';
import { createCookieSessionStorage, type SessionStorage } from 'react-router';
import { createThemeSessionResolver } from 'remix-themes';

const baseThemeSessionStorage = createCookieSessionStorage({
  cookie: {
    name: 'theme',
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secrets: ['insecure-secret-do-not-care'],
    secure: useSecureCookies,
    maxAge: 60 * 60 * 24 * 365,
  },
});

// Resolve the cookie domain on each commit: the web app URL can differ per
// request (see `NEXT_PRIVATE_TRUSTED_PROXY_HOSTS`).
const themeSessionStorage: SessionStorage = {
  getSession: baseThemeSessionStorage.getSession,
  commitSession: async (session, options) =>
    baseThemeSessionStorage.commitSession(session, { domain: getCookieDomain(), ...options }),
  destroySession: async (session, options) =>
    baseThemeSessionStorage.destroySession(session, { domain: getCookieDomain(), ...options }),
};

export const themeSessionResolver = createThemeSessionResolver(themeSessionStorage);
