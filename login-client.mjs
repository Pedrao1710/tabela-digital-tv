import { isIP } from 'node:net';

function normalizeIP(value) {
  if (typeof value !== 'string') return '';
  const address = value.trim();
  const family = isIP(address);
  if (!family || address.includes('%')) return '';
  if (family === 4) return address;
  // Canonicalize IPv6 spellings before comparing trusted peers or limiter keys.
  const canonical = new URL('http://[' + address + ']/').hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const upper = parseInt(mapped[1], 16);
  const lower = parseInt(mapped[2], 16);
  return [upper >>> 8, upper & 255, lower >>> 8, lower & 255].join('.');
}

export function createLoginClientAddress(trustedProxies = []) {
  const entries =
    typeof trustedProxies === 'string'
      ? trustedProxies.trim()
        ? trustedProxies.split(',')
        : []
      : trustedProxies;
  const invalid = () => {
    throw new Error(
      'TABELA_TRUSTED_PROXIES deve conter apenas IPs exatos de proxies, separados por vírgulas.'
    );
  };
  if (!Array.isArray(entries) || entries.length > 32) invalid();
  const trusted = new Set(
    entries.map((entry) => {
      const address = normalizeIP(entry);
      if (!address || address === '0.0.0.0' || address === '::') invalid();
      return address;
    })
  );
  return (req) => {
    const peer = normalizeIP(req.socket.remoteAddress) || 'unknown';
    if (!trusted.has(peer)) return peer;
    // The configured proxy must overwrite this header with its own client IP.
    // Chains, duplicate headers, ports and hostnames are deliberately ignored.
    return normalizeIP(req.headers['x-real-ip']) || peer;
  };
}
