// Разбор ссылок подписки и генерация конфига Xray
function b64decode(s) {
  s = s.trim().replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function extractLinks(text) {
  text = text.trim();
  if (!text.includes('://')) {
    try { text = b64decode(text); } catch {}
  }
  return text.split(/\r?\n/).map(s => s.trim()).filter(s => /^(vless|trojan):\/\//i.test(s));
}

function parseLink(link) {
  try {
    const u = new URL(link);
    const proto = u.protocol.replace(':', '').toLowerCase();
    const params = Object.fromEntries(u.searchParams);
    const name = decodeURIComponent(u.hash.replace(/^#/, '')) || u.hostname;
    const base = { protocol: proto, name, address: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) || 443, params };
    if (proto === 'vless') return { ...base, id: decodeURIComponent(u.username) };
    if (proto === 'trojan') return { ...base, password: decodeURIComponent(u.username) };
  } catch {}
  return null;
}

function streamSettings(p) {
  const network = p.type || 'tcp';
  const security = p.security || 'none';
  const s = { network, security };
  if (security === 'reality') {
    s.realitySettings = {
      serverName: p.sni || '',
      fingerprint: p.fp || 'chrome',
      publicKey: p.pbk || '',
      shortId: p.sid || '',
      spiderX: p.spx || ''
    };
  } else if (security === 'tls') {
    s.tlsSettings = { serverName: p.sni || p.host || '', fingerprint: p.fp || 'chrome' };
    if (p.alpn) s.tlsSettings.alpn = p.alpn.split(',');
  }
  if (network === 'ws') s.wsSettings = { path: p.path || '/', headers: p.host ? { Host: p.host } : {} };
  if (network === 'grpc') s.grpcSettings = { serviceName: p.serviceName || '' };
  if (network === 'xhttp') s.xhttpSettings = { path: p.path || '/', host: p.host || '', mode: p.mode || 'auto' };
  return s;
}

function buildConfig(srv, socksPort = 10808) {
  const p = srv.params || {};
  let outbound;
  if (srv.protocol === 'vless') {
    outbound = {
      tag: 'proxy', protocol: 'vless',
      settings: { vnext: [{ address: srv.address, port: srv.port,
        users: [{ id: srv.id, encryption: p.encryption || 'none', flow: p.flow || '' }] }] },
      streamSettings: streamSettings(p)
    };
  } else {
    outbound = {
      tag: 'proxy', protocol: 'trojan',
      settings: { servers: [{ address: srv.address, port: srv.port, password: srv.password }] },
      streamSettings: streamSettings({ security: 'tls', ...p })
    };
  }
  return {
    log: { loglevel: 'warning' },
    inbounds: [{
      listen: '127.0.0.1', port: socksPort, protocol: 'socks',
      settings: { udp: true },
      sniffing: { enabled: true, destOverride: ['http', 'tls'] }
    }],
    outbounds: [outbound, { tag: 'direct', protocol: 'freedom' }]
  };
}

module.exports = { extractLinks, parseLink, buildConfig };
