import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveHost } from "./index.js";

/* global process */

test("resolveHost defaults to 0.0.0.0 when HOST is unset", () => {
  assert.equal(resolveHost({}), "0.0.0.0");
});

test("resolveHost honours HOST when set", () => {
  assert.equal(resolveHost({ HOST: "127.0.0.1" }), "127.0.0.1");
});

test("resolveHost ignores an empty HOST", () => {
  assert.equal(resolveHost({ HOST: "" }), "0.0.0.0");
});

const entrypoint = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "index.js",
);

function runEntrypoint(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entrypoint], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("exit", (code) => resolve({ code, stderr }));
  });
}

test("refusing to boot without tokens exits non-zero", async (t) => {
  // Keep the spawned server's database out of the repository working tree.
  const databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "drawdb-"));
  t.after(() => fs.rmSync(databaseDirectory, { recursive: true, force: true }));

  const { code, stderr } = await runEntrypoint({
    NODE_ENV: "production",
    COLLAB_TOKENS: "",
    COLLAB_TOKENS_FILE: "",
    PORT: "0",
    DATABASE_PATH: path.join(databaseDirectory, "drawdb.sqlite"),
  });
  assert.notEqual(
    code,
    0,
    `expected a non-zero exit so systemd sees a failure, got ${code}. stderr:\n${stderr}`,
  );
  assert.match(stderr, /Refusing to start|Failed to start/);
});

test("failing to bind the port exits non-zero", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "drawdb-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  // A valid token file, so startup gets past the auth guard and actually
  // reaches server.listen().
  const tokensFile = path.join(directory, "tokens.json");
  fs.writeFileSync(
    tokensFile,
    JSON.stringify({
      "test-token": { userId: "u", displayName: "U", color: "#2563eb" },
    }),
  );

  // Occupy a kernel-assigned port so the spawned server cannot bind it.
  const blocker = net.createServer();
  t.after(() => new Promise((resolve) => blocker.close(resolve)));
  const port = await new Promise((resolve) => {
    blocker.listen(0, "127.0.0.1", () => resolve(blocker.address().port));
  });

  const { code, stderr } = await runEntrypoint({
    COLLAB_REQUIRE_AUTH: "1",
    COLLAB_TOKENS: "",
    COLLAB_TOKENS_FILE: tokensFile,
    ALLOWED_ORIGINS: "http://localhost",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATABASE_PATH: path.join(directory, "drawdb.sqlite"),
  });
  assert.notEqual(
    code,
    0,
    `expected a non-zero exit so systemd sees a failure, got ${code}. stderr:\n${stderr}`,
  );
  assert.match(stderr, /EADDRINUSE|Failed to listen/);
});
