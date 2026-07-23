import fs from "node:fs";

/* global process */

// Tokens come from COLLAB_TOKENS (inline JSON) or COLLAB_TOKENS_FILE (path to JSON).
// Shape: { "<token>": { "userId": "...", "displayName": "...", "color": "#rrggbb" } }
export function loadTokens(source) {
  const raw =
    source ??
    (process.env.COLLAB_TOKENS_FILE
      ? fs.readFileSync(process.env.COLLAB_TOKENS_FILE, "utf8")
      : process.env.COLLAB_TOKENS);
  if (!raw) return new Map();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Invalid COLLAB_TOKENS/COLLAB_TOKENS_FILE JSON: ${e.message}`,
    );
  }
  const map = new Map();
  for (const [token, identity] of Object.entries(parsed)) {
    if (
      token &&
      identity &&
      typeof identity.userId === "string" &&
      typeof identity.displayName === "string"
    ) {
      map.set(token, {
        userId: identity.userId,
        displayName: identity.displayName,
        color: typeof identity.color === "string" ? identity.color : "#2563eb",
      });
    }
  }
  return map;
}

export function authenticateToken(tokens, token) {
  if (!token || typeof token !== "string") return null;
  return tokens.get(token) ?? null;
}

// Express middleware factory. When tokens is empty, auth is OPEN (dev only) and
// logs a warning once — production MUST configure tokens.
export function requireAuth(tokens) {
  return (req, res, next) => {
    if (tokens.size === 0) return next();
    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const identity = authenticateToken(tokens, token);
    if (!identity) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = identity;
    next();
  };
}
