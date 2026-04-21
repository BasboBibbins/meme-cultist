/**
 * Validate that a URL is safe to fetch — blocks private/internal IPs,
 * link-local addresses, and cloud metadata endpoints to prevent SSRF.
 */
function isSafeUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: "Invalid URL format." };
  }

  // Only allow http/https
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { safe: false, reason: `Unsupported protocol: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block common cloud metadata endpoints
  if (hostname === "169.254.169.254" || hostname === "metadata.google.internal" || hostname === "metadata.azure.com") {
    return { safe: false, reason: "Cloud metadata endpoints are not allowed." };
  }

  // Block localhost variations
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0") {
    return { safe: false, reason: "Localhost addresses are not allowed." };
  }

  // Block hostnames that end in .local, .internal, .localhost
  if (/\.(local|internal|localhost)$/i.test(hostname)) {
    return { safe: false, reason: "Internal hostnames are not allowed." };
  }

  // Block RFC 1918 private ranges, link-local, and other reserved ranges
  const ipRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = hostname.match(ipRegex);
  if (match) {
    const [, a, b] = match.map(Number);
    // 10.0.0.0/8
    if (a === 10) return { safe: false, reason: "Private IP addresses are not allowed." };
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return { safe: false, reason: "Private IP addresses are not allowed." };
    // 192.168.0.0/16
    if (a === 192 && b === 168) return { safe: false, reason: "Private IP addresses are not allowed." };
    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return { safe: false, reason: "Link-local addresses are not allowed." };
    // 127.0.0.0/8 (loopback — already caught above but belt-and-suspenders)
    if (a === 127) return { safe: false, reason: "Loopback addresses are not allowed." };
    // 0.0.0.0/8
    if (a === 0) return { safe: false, reason: "Unspecified addresses are not allowed." };
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return { safe: false, reason: "Carrier-grade NAT addresses are not allowed." };
    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (documentation/reserved)
    if (a === 192 && b === 0 && match[3] === "2") return { safe: false, reason: "Documentation/reserved addresses are not allowed." };
    if (a === 198 && b === 51 && match[3] === "100") return { safe: false, reason: "Documentation/reserved addresses are not allowed." };
    if (a === 203 && b === 0 && match[3] === "113") return { safe: false, reason: "Documentation/reserved addresses are not allowed." };
  }

  return { safe: true };
}

module.exports = { isSafeUrl };