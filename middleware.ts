import { NextResponse, type NextRequest } from "next/server";

// The API can start paid model runs, drive a browser and read the provider
// settings, and the server listens on localhost — where any web page the user
// has open can reach it. So only qpilot's own pages may call it:
//
//  - Host must be a loopback name. This stops DNS rebinding, where an
//    attacker's domain resolves to 127.0.0.1 and the browser then treats the
//    attacker's page as same-origin with qpilot. Behind a reverse proxy, list
//    the public host name(s) in QPILOT_ALLOWED_HOSTS (comma-separated; "*"
//    turns the host check off).
//  - A browser request from another origin is refused. Browsers mark them
//    (Origin, Sec-Fetch-Site), even for "simple" no-preflight POSTs. Clients
//    that aren't browsers (curl, scripts) send neither header and pass.

const LOOPBACK = /^(localhost|[\w-]+\.localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

function hostAllowed(host: string): boolean {
  const name = host.replace(/:\d+$/, "").toLowerCase();
  if (LOOPBACK.test(name)) return true;
  const extra = (process.env.QPILOT_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes("*") || extra.includes(name);
}

function sameOrigin(origin: string, host: string): boolean {
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false; // includes Origin: null (sandboxed iframes, file://)
  }
}

const deny = (reason: string) =>
  NextResponse.json({ error: `Forbidden: ${reason}` }, { status: 403 });

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!hostAllowed(host)) {
    return deny(`host "${host}" is not allowed (set QPILOT_ALLOWED_HOSTS to serve qpilot under this name)`);
  }
  const origin = req.headers.get("origin");
  if (origin !== null && !sameOrigin(origin, host)) {
    return deny("cross-origin request");
  }
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return deny("cross-site request");
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
