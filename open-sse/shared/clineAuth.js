import pkg from "../../package.json" with { type: "json" };

const APP_VERSION = pkg.version || "0.0.0";

/**
 * Cline's API takes the same access token in two different shapes, and which one
 * it accepts depends on how that token was minted — not on the endpoint:
 *
 *   login-minted  (the token returned by the OAuth exchange, `iat` ≈ `auth_time`)
 *                 → sent RAW:            `Bearer eyJ...`
 *   refresh-minted (the token returned by /auth/refresh, `iat` well past
 *                 `auth_time`)            → sent PREFIXED: `Bearer workos:eyJ...`
 *
 * Feeding either token the other way answers 401 with "…re-authenticate your
 * Cline account", which reads like a dead credential while the token is in fact
 * perfectly valid. Sending BOTH is the safe move rather than trying to classify:
 * the accepted shape returns 200 and the rejected one returns 401.
 */
function isWorkOsJwt(token) {
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(token);
}

export function getClineAccessToken(token) {
  if (typeof token !== "string") return "";
  const trimmed = token.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("workos:")) return trimmed;
  // ClinePass API keys (clp_...) are NOT JWTs and must be sent verbatim.
  return isWorkOsJwt(trimmed) ? `workos:${trimmed}` : trimmed;
}

/**
 * The same token in its OTHER shape, or null when only one shape is valid.
 * Used as a one-shot retry after 401.
 */
export function getAlternateClineToken(token) {
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (!isWorkOsJwt(stripPrefix(trimmed))) return null;

  const candidates = getClineAuthCandidates(trimmed);
  const second = candidates[1];
  if (!second || second === candidates[0]) return null;
  return second;
}

/** The shape a token string represents: "raw" or "prefixed". */
export function clineTokenShape(token) {
  if (typeof token !== "string") return null;
  return token.trim().toLowerCase().startsWith("workos:") ? "prefixed" : "raw";
}

/**
 * Auth header candidates for this token, ordered best-first.
 * A refresh-minted token (common case) needs prefix first.
 * A login-minted token needs it raw first.
 */
export function getClineAuthCandidates(token) {
  if (typeof token !== "string") return [];
  const trimmed = token.trim();
  if (!trimmed) return [];
  if (!isWorkOsJwt(trimmed)) return [trimmed];

  const raw = trimmed;
  const prefixed = `workos:${trimmed}`;
  const loginMinted = isLoginMintedJwt(trimmed);
  return loginMinted ? [raw, prefixed] : [prefixed, raw];
}

/** True when `iat` is close to `auth_time`, i.e. minted by the login flow. */
function isLoginMintedJwt(jwt) {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return false;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payload.length % 4)) % 4);
    const claims = JSON.parse(Buffer.from(padded, "base64").toString("utf-8"));
    const { iat, auth_time: authTime } = claims;
    if (typeof iat !== "number" || typeof authTime !== "number") return false;
    return Math.abs(iat - authTime) <= 60;
  } catch {
    return false;
  }
}

function stripPrefix(token) {
  return token.toLowerCase().startsWith("workos:") ? token.slice(7) : token;
}

export function getClineAuthorizationHeader(token) {
  const candidates = getClineAuthCandidates(token);
  return candidates.length ? `Bearer ${candidates[0]}` : "";
}

export function buildClineHeaders(token, extraHeaders = {}, options = {}) {
  const authorization = buildAuthorization(token, options.shape);
  const headers = {
    "HTTP-Referer": "https://cline.bot",
    "X-Title": "Cline",
    "User-Agent": `Freezeraize/${APP_VERSION}`,
    "X-PLATFORM": process.platform || "unknown",
    "X-PLATFORM-VERSION": process.version || "unknown",
    "X-CLIENT-TYPE": "freezeraize",
    "X-CLIENT-VERSION": APP_VERSION,
    "X-CORE-VERSION": APP_VERSION,
    "X-IS-MULTIROOT": "false",
    ...extraHeaders,
  };

  if (authorization) {
    headers.Authorization = authorization;
  }

  return headers;
}

/**
 * Build the Authorization header, optionally forcing a shape.
 * `shape` is only passed by the retry path in DefaultExecutor.
 */
function buildAuthorization(token, shape) {
  if (typeof token !== "string" || !token.trim()) return "";
  const trimmed = token.trim();

  if (shape === "raw" || shape === "prefixed") {
    const bare = stripPrefix(trimmed);
    if (!isWorkOsJwt(bare)) return `Bearer ${trimmed}`;
    return shape === "raw" ? `Bearer ${bare}` : `Bearer workos:${bare}`;
  }

  const candidates = getClineAuthCandidates(trimmed);
  return candidates.length ? `Bearer ${candidates[0]}` : "";
}
