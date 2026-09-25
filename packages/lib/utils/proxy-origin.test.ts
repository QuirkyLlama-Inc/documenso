import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getAllowedProxyHosts, getRequestWebAppUrl, isAllowedProxyHost } from './proxy-origin';

const ORIGINAL_ENV = { ...process.env };

const makeRequest = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe('proxy-origin', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_WEBAPP_URL = 'http://localhost:3000';
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    delete process.env.NEXT_PRIVATE_ALLOWED_PROXY_HOSTS;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('getAllowedProxyHosts', () => {
    it('returns an empty list when unset', () => {
      expect(getAllowedProxyHosts()).toEqual([]);
    });

    it('splits, trims and lowercases entries', () => {
      process.env.NEXT_PRIVATE_ALLOWED_PROXY_HOSTS = ' .Proxy.Example.com, dev.example.org ,,';

      expect(getAllowedProxyHosts()).toEqual(['.proxy.example.com', 'dev.example.org']);
    });
  });

  describe('isAllowedProxyHost', () => {
    beforeEach(() => {
      process.env.NEXT_PRIVATE_ALLOWED_PROXY_HOSTS = '.proxy.example.com,dev.example.org';
    });

    it('matches subdomains of a leading-dot entry, ignoring the port', () => {
      expect(isAllowedProxyHost('box--abc123.proxy.example.com:3000')).toBe(true);
      expect(isAllowedProxyHost('BOX.PROXY.EXAMPLE.COM')).toBe(true);
    });

    it('does not match the bare suffix or lookalike hosts', () => {
      expect(isAllowedProxyHost('proxy.example.com')).toBe(false);
      expect(isAllowedProxyHost('evilproxy.example.com')).toBe(false);
      expect(isAllowedProxyHost('box.proxy.example.com.evil.net')).toBe(false);
    });

    it('matches exact entries only exactly', () => {
      expect(isAllowedProxyHost('dev.example.org:8080')).toBe(true);
      expect(isAllowedProxyHost('sub.dev.example.org')).toBe(false);
    });

    it('rejects everything when unset', () => {
      delete process.env.NEXT_PRIVATE_ALLOWED_PROXY_HOSTS;

      expect(isAllowedProxyHost('box.proxy.example.com')).toBe(false);
    });
  });

  describe('getRequestWebAppUrl', () => {
    it('returns the configured URL when no proxy hosts are allowed', () => {
      const request = makeRequest('http://localhost:3000/', { host: 'box.proxy.example.com:3000' });

      expect(getRequestWebAppUrl(request)).toBe('http://localhost:3000');
    });

    it('derives the public origin from an allowed Host header, defaulting to https', () => {
      process.env.NEXT_PRIVATE_ALLOWED_PROXY_HOSTS = '.proxy.example.com';

      const request = makeRequest('http://box.proxy.example.com:3000/', { host: 'box.proxy.example.com:3000' });

      expect(getRequestWebAppUrl(request)).toBe('https://box.proxy.example.com:3000');
    });

    it('prefers X-Forwarded-Host and X-Forwarded-Proto', () => {
      process.env.NEXT_PRIVATE_ALLOWED_PROXY_HOSTS = '.proxy.example.com';

      const request = makeRequest('http://127.0.0.1:3000/', {
        host: '127.0.0.1:3000',
        'x-forwarded-host': 'box--r1.proxy.example.com:3000, other.example.com',
        'x-forwarded-proto': 'https, http',
      });

      expect(getRequestWebAppUrl(request)).toBe('https://box--r1.proxy.example.com:3000');
    });

    it('falls back to the configured URL for hosts not on the allow-list', () => {
      process.env.NEXT_PRIVATE_ALLOWED_PROXY_HOSTS = '.proxy.example.com';

      const request = makeRequest('http://evil.example.net/', {
        host: 'evil.example.net',
        'x-forwarded-host': 'evil.example.net',
      });

      expect(getRequestWebAppUrl(request)).toBe('http://localhost:3000');
    });

    it('keeps the base path of the configured URL', () => {
      process.env.NEXT_PRIVATE_ALLOWED_PROXY_HOSTS = '.proxy.example.com';
      process.env.NEXT_PUBLIC_WEBAPP_URL = 'http://localhost:3000/ESign';

      const request = makeRequest('http://box.proxy.example.com/', { host: 'box.proxy.example.com:3000' });

      expect(getRequestWebAppUrl(request)).toBe('https://box.proxy.example.com:3000/ESign');
    });

    it('ignores a malformed forwarded host', () => {
      process.env.NEXT_PRIVATE_ALLOWED_PROXY_HOSTS = '.proxy.example.com';

      const request = makeRequest('http://localhost:3000/', {
        host: 'localhost:3000',
        'x-forwarded-host': 'box.proxy.example.com/<script>',
      });

      expect(getRequestWebAppUrl(request)).toBe('http://localhost:3000');
    });
  });
});
