import test from "node:test";
import assert from "node:assert/strict";
import { loadTokens, authenticateToken, requireAuth } from "./auth.js";

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
