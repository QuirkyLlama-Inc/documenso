/**
 * Per-request override for the web app URL.
 *
 * The server registers a resolver that returns the public origin of the request
 * being handled (see `NEXT_PRIVATE_TRUSTED_PROXY_HOSTS`), which lets the app run
 * behind a proxy whose hostname isn't known ahead of time.
 *
 * The resolver lives on `globalThis` because the server and the React Router
 * build can each bundle their own copy of this module.
 */
type RequestWebappUrlResolver = () => string | undefined;

const RESOLVER_KEY = Symbol.for('documenso.request-webapp-url-resolver');

type GlobalWithResolver = typeof globalThis & {
  [RESOLVER_KEY]?: RequestWebappUrlResolver;
};

export const setRequestWebappUrlResolver = (resolver: RequestWebappUrlResolver) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  (globalThis as GlobalWithResolver)[RESOLVER_KEY] = resolver;
};

export const getRequestWebappUrl = (): string | undefined => {
  if (typeof window !== 'undefined') {
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return (globalThis as GlobalWithResolver)[RESOLVER_KEY]?.();
};
