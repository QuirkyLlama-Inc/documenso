import { describe, expect, it } from 'vitest';

import { parseTrustedProxyHosts, resolveTrustedProxyOrigin } from './trusted-proxy-origin';

const TRUSTED_HOSTS = parseTrustedProxyHosts('.proxy.example.com, preview.example.org');

const createRequest = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe('parseTrustedProxyHosts', () => {
  it('returns an empty list when unset or blank', () => {
    expect(parseTrustedProxyHosts(undefined)).toEqual([]);
    expect(parseTrustedProxyHosts('')).toEqual([]);
    expect(parseTrustedProxyHosts(' , ')).toEqual([]);
  });

  it('trims and lowercases entries', () => {
    expect(parseTrustedProxyHosts(' .Proxy.Example.com ,preview.example.org')).toEqual([
      '.proxy.example.com',
      'preview.example.org',
    ]);
  });
});

describe('resolveTrustedProxyOrigin', () => {
  it('returns undefined when no hosts are trusted', () => {
    const request = createRequest('http://127.0.0.1:3000/signin', {
      'x-forwarded-host': 'box.proxy.example.com:3000',
      'x-forwarded-proto': 'https',
    });

    expect(resolveTrustedProxyOrigin(request, [])).toBeUndefined();
  });

  it('uses the forwarded host and protocol for a trusted suffix', () => {
    const request = createRequest('http://127.0.0.1:3000/signin', {
      'x-forwarded-host': 'box--abc123.proxy.example.com:3000',
      'x-forwarded-proto': 'https',
    });

    expect(resolveTrustedProxyOrigin(request, TRUSTED_HOSTS)).toBe('https://box--abc123.proxy.example.com:3000');
  });

  it('falls back to the Host header and request protocol', () => {
    const request = createRequest('http://box.proxy.example.com:3000/signin');

    expect(resolveTrustedProxyOrigin(request, TRUSTED_HOSTS)).toBe('http://box.proxy.example.com:3000');
  });

  it('matches an exact host entry', () => {
    const request = createRequest('http://127.0.0.1:3000/', {
      'x-forwarded-host': 'preview.example.org',
      'x-forwarded-proto': 'https',
    });

    expect(resolveTrustedProxyOrigin(request, TRUSTED_HOSTS)).toBe('https://preview.example.org');
  });

  it('uses the first value of comma-separated forwarded headers', () => {
    const request = createRequest('http://127.0.0.1:3000/', {
      'x-forwarded-host': 'box.proxy.example.com:3000, internal:3000',
      'x-forwarded-proto': 'https, http',
    });

    expect(resolveTrustedProxyOrigin(request, TRUSTED_HOSTS)).toBe('https://box.proxy.example.com:3000');
  });

  it('rejects hosts outside the trusted list', () => {
    const untrustedHosts = [
      'evil.com',
      'proxy.example.com.evil.com',
      'evilproxy.example.com',
      'sub.preview.example.org',
      'localhost:3000',
    ];

    for (const host of untrustedHosts) {
      const request = createRequest('http://127.0.0.1:3000/', {
        'x-forwarded-host': host,
        'x-forwarded-proto': 'https',
      });

      expect(resolveTrustedProxyOrigin(request, TRUSTED_HOSTS)).toBeUndefined();
    }
  });

  it('rejects hosts that would inject a path or credentials', () => {
    const maliciousHosts = ['evil.com/.proxy.example.com', 'evil.com@box.proxy.example.com', 'box.proxy.example.com/x'];

    for (const host of maliciousHosts) {
      const request = createRequest('http://127.0.0.1:3000/', {
        'x-forwarded-host': host,
        'x-forwarded-proto': 'https',
      });

      expect(resolveTrustedProxyOrigin(request, TRUSTED_HOSTS)).toBeUndefined();
    }
  });

  it('ignores an unknown forwarded protocol', () => {
    const request = createRequest('http://127.0.0.1:3000/', {
      'x-forwarded-host': 'box.proxy.example.com',
      'x-forwarded-proto': 'javascript',
    });

    expect(resolveTrustedProxyOrigin(request, TRUSTED_HOSTS)).toBe('http://box.proxy.example.com');
  });
});
