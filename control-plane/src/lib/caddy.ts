// Caddy admin API (loopback). Routes are addressed by a stable @id derived from
// the hostname, so we can upsert/remove them without scanning the array.
const ADMIN = process.env.CADDY_ADMIN ?? "http://127.0.0.1:2019";

// Caddy is optional. When CADDY_ADMIN is unset, the control plane runs without a
// public routing layer (e.g. local OSS dev): deploys are reachable directly on
// their container's localhost port instead of a public https hostname.
export function caddyEnabled(): boolean {
  return Boolean(process.env.CADDY_ADMIN);
}
const ROUTES = `${ADMIN}/config/apps/http/servers/srv0/routes`;

// Node's fetch (undici) attaches an opaque Origin on POST/DELETE that Caddy's
// admin API rejects. Send an explicit, allowed Origin = the admin's own.
const ORIGIN = (() => {
  try {
    return new URL(ADMIN).origin;
  } catch {
    return "http://127.0.0.1:2019";
  }
})();

const routeId = (hostname: string) => `route_${hostname.replace(/[^a-z0-9]/gi, "_")}`;

// Append a host -> reverse_proxy route; Caddy provisions TLS automatically.
export async function addRoute(opts: {
  hostname: string;
  upstreamPort: number;
}): Promise<void> {
  const route = {
    "@id": routeId(opts.hostname),
    match: [{ host: [opts.hostname] }],
    handle: [
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: `127.0.0.1:${opts.upstreamPort}` }],
      },
    ],
  };
  const res = await fetch(ROUTES, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify(route),
  });
  if (!res.ok) throw new Error(`caddy addRoute ${res.status}: ${await res.text()}`);
}

// Remove the route for a hostname (idempotent — ignore "not found").
export async function removeRoute(hostname: string): Promise<void> {
  const res = await fetch(`${ADMIN}/id/${routeId(hostname)}`, {
    method: "DELETE",
    headers: { Origin: ORIGIN },
  });
  if (!res.ok && res.status !== 404 && res.status !== 500) {
    throw new Error(`caddy removeRoute ${res.status}: ${await res.text()}`);
  }
}
