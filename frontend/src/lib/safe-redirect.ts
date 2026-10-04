/**
 * REG-21: where `/login` sends a person after they sign in (`?next=`).
 *
 * `next` comes from the URL, so it is attacker-controlled: a link such as
 * `/login?next=https://evil.example` must never turn a successful login into
 * an open redirect. The only accepted value is an INTERNAL path — one slash,
 * then the path — and anything else yields `null`, which makes the caller fall
 * back to the role's home. The rule is deliberately strict: refusing a
 * legitimate-looking oddity costs one extra click, accepting a malicious one
 * costs a phished session.
 *
 * Pure and free of Node-only APIs: the Edge middleware imports it too.
 */

/** Long enough for any real in-app URL, short enough to refuse a payload. */
const MAX_NEXT_LENGTH = 2048;

/** Never a destination: the login itself would loop, `/api` is JSON, not a page. */
const NEVER_A_DESTINATION = ["/login", "/api"];

/** A base only used to let the URL parser prove the value stays on the same origin. */
const PROBE_ORIGIN = "http://internal.invalid";

/** C0 controls, DEL and C1 controls (browsers strip tab and newline inside URLs). */
// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** Characters that browsers or proxies fold into a path separator. */
const SEPARATOR_LOOKALIKES = /[\\\u2215\u2044\uFF0F\uFF3C]/;

/** How many times the value is percent-decoded when hunting for an encoded trick. */
const MAX_DECODE_PASSES = 3;

function startsWithOneSlash(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

function matchesNeverDestination(path: string): boolean {
  return NEVER_A_DESTINATION.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`) || path.startsWith(`${prefix}#`),
  );
}

/**
 * True when `value`, or any of its percent-decoded forms, is anything but a
 * plain internal path: a control character, a backslash, a second leading
 * slash, or a lookalike. Decoding repeatedly catches `%252F` (an encoded `%2F`).
 */
function hidesATrick(value: string): boolean {
  let current = value;
  for (let pass = 0; pass <= MAX_DECODE_PASSES; pass += 1) {
    if (CONTROL_CHARACTERS.test(current) || SEPARATOR_LOOKALIKES.test(current)) return true;
    if (!startsWithOneSlash(current)) return true;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return true;
    }
    if (decoded === current) return false;
    current = decoded;
  }
  // Still changing after the last pass: a deeper nesting than any real URL has.
  return true;
}

/**
 * Narrows a raw `?next=` into an internal path to navigate to, or `null`.
 * Returns the value unchanged (not decoded) when it is safe.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return null;
  if (raw === "/" || !startsWithOneSlash(raw) || hidesATrick(raw)) return null;
  if (matchesNeverDestination(raw)) return null;

  // Last line of defence: whatever the parser makes of it must stay on our origin.
  try {
    const probe = new URL(raw, PROBE_ORIGIN);
    if (probe.origin !== PROBE_ORIGIN) return null;
    if (matchesNeverDestination(`${probe.pathname}${probe.search}`)) return null;
  } catch {
    return null;
  }
  return raw;
}

/**
 * `route` with the original destination appended as `next`, continuing its
 * query string when it already has one. `pathname` and `search` are the
 * original request's; an unsafe or login-bound value leaves `next` out, so
 * the route behaves exactly as it did before REG-21.
 */
export function withNextPath(route: string, pathname: string, search = ""): string {
  const next = safeNextPath(`${pathname}${search}`);
  if (next === null) return route;
  return `${route}${route.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;
}

/** The `/login` URL that remembers where the person was. */
export function loginPathWithNext(pathname: string, search = ""): string {
  return withNextPath("/login", pathname, search);
}
