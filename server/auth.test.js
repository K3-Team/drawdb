import test from "node:test";
import assert from "node:assert/strict";
import {
  loadTokens,
  authenticateToken,
  requireAuth,
  loadAllowedOrigins,
  isOriginAllowed,
} from "./auth.js";
import { createApplication } from "./index.js";

/* global process */

test("loadTokens parses a token map from JSON", () => {
  const tokens = loadTokens(
    '{"secretA":{"userId":"u1","displayName":"Ann","color":"#2563eb"}}',
  );
  assert.equal(tokens.get("secretA").displayName, "Ann");
});

test("authenticateToken returns the identity for a known token", () => {
  const tokens = loadTokens(
    '{"secretA":{"userId":"u1","displayName":"Ann","color":"#2563eb"}}',
  );
  assert.equal(authenticateToken(tokens, "secretA").userId, "u1");
});

test("authenticateToken returns null for an unknown or empty token", () => {
  const tokens = loadTokens(
    '{"secretA":{"userId":"u1","displayName":"Ann","color":"#2563eb"}}',
  );
  assert.equal(authenticateToken(tokens, "nope"), null);
  assert.equal(authenticateToken(tokens, ""), null);
  assert.equal(authenticateToken(tokens, undefined), null);
});

test("requireAuth returns 401 when tokens are configured and no/invalid Bearer is sent", () => {
  const tokens = loadTokens(
    '{"secretA":{"userId":"u1","displayName":"Ann","color":"#2563eb"}}',
  );
  const middleware = requireAuth(tokens);

  const makeReqRes = (authorization) => {
    let statusCode = null;
    let jsonBody = null;
    const req = {
      get: (name) =>
        name.toLowerCase() === "authorization" ? authorization : undefined,
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        jsonBody = body;
        return this;
      },
    };
    return { req, res, getStatus: () => statusCode, getBody: () => jsonBody };
  };

  // No Authorization header at all.
  let nextCalled = false;
  let ctx = makeReqRes(undefined);
  middleware(ctx.req, ctx.res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(ctx.getStatus(), 401);
  assert.deepEqual(ctx.getBody(), { error: "Unauthorized" });

  // Invalid Bearer token.
  nextCalled = false;
  ctx = makeReqRes("Bearer wrong");
  middleware(ctx.req, ctx.res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(ctx.getStatus(), 401);

  // Valid Bearer token passes through and attaches identity.
  nextCalled = false;
  ctx = makeReqRes("Bearer secretA");
  middleware(ctx.req, ctx.res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(ctx.getStatus(), null);
  assert.equal(ctx.req.user.userId, "u1");
});

test("isOriginAllowed enforces the allowlist and rejects missing origins", () => {
  const allowed = new Set(["https://x"]);
  assert.equal(isOriginAllowed(allowed, "https://x"), true);
  assert.equal(isOriginAllowed(allowed, "https://evil.example"), false);
  // Missing origin when a set is configured is rejected.
  assert.equal(isOriginAllowed(allowed, undefined), false);
});

test("loadAllowedOrigins returns null (allow-all) when unset, and null allows anything", () => {
  assert.equal(loadAllowedOrigins(undefined), null);
  assert.equal(loadAllowedOrigins(""), null);
  assert.equal(isOriginAllowed(null, "https://anything"), true);
  assert.equal(isOriginAllowed(null, undefined), true);

  const allowed = loadAllowedOrigins("https://a, https://b");
  assert.equal(allowed.has("https://a"), true);
  assert.equal(allowed.has("https://b"), true);
});

test("createApplication fails closed when auth is required but no tokens configured", () => {
  const saved = {
    COLLAB_REQUIRE_AUTH: process.env.COLLAB_REQUIRE_AUTH,
    COLLAB_TOKENS: process.env.COLLAB_TOKENS,
    COLLAB_TOKENS_FILE: process.env.COLLAB_TOKENS_FILE,
    NODE_ENV: process.env.NODE_ENV,
  };
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  try {
    delete process.env.COLLAB_TOKENS;
    delete process.env.COLLAB_TOKENS_FILE;
    delete process.env.NODE_ENV;

    // Auth required + no tokens => throws (fail closed).
    process.env.COLLAB_REQUIRE_AUTH = "1";
    assert.throws(
      () => createApplication({ databasePath: ":memory:" }),
      /auth required but no tokens/i,
    );

    // Auth required + tokens configured => does NOT throw.
    process.env.COLLAB_TOKENS =
      '{"secretA":{"userId":"u1","displayName":"Ann","color":"#2563eb"}}';
    const withTokens = createApplication({ databasePath: ":memory:" });
    assert.equal(withTokens.tokens.size, 1);
    withTokens.database.close();

    // Neither flag nor tokens (dev) => does NOT throw, just warns.
    delete process.env.COLLAB_REQUIRE_AUTH;
    delete process.env.COLLAB_TOKENS;
    const devMode = createApplication({ databasePath: ":memory:" });
    assert.equal(devMode.tokens.size, 0);
    devMode.database.close();
  } finally {
    restore();
  }
});
