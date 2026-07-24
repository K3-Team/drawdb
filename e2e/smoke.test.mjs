import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { createApplication } from "../server/index.js";

// Real-browser boot smoke: serve the built SPA, load it in headless Chromium,
// and assert React mounts with no uncaught page exception. This catches the
// "the build is broken / the app crashes on load" regression class that unit
// tests miss. The client protocol logic itself is covered headlessly by
// src/context/CollabContext.test.jsx; full UI-driven multi-browser sync is a
// separate, heavier E2E not attempted here.
//
// Requires a built dist/ and a Chromium binary (CHROMIUM env or `chromium` on
// PATH). Run via `npm run test:e2e`.

/* global process */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "..", "dist");
const CHROMIUM = process.env.CHROMIUM || "chromium";
const DEBUG_PORT = 9333;

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

async function waitFor(fn, { timeout = 15000, interval = 200, label } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* keep polling */
    }
    if (Date.now() - start > timeout) throw new Error(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

// Minimal CDP client over the page target's WebSocket.
function cdp(ws) {
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { send, events };
}

test("the built SPA boots in a real browser without uncaught errors", async (t) => {
  assert.ok(fs.existsSync(path.join(DIST, "index.html")), "dist/ must be built first");

  // 1. Serve the built app (dev-open; the static SPA needs no token).
  delete process.env.COLLAB_TOKENS;
  delete process.env.COLLAB_TOKENS_FILE;
  delete process.env.ALLOWED_ORIGINS;
  const app = createApplication({ databasePath: ":memory:", staticPath: DIST });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const appPort = app.server.address().port;
  const appUrl = `http://127.0.0.1:${appPort}/`;

  // 2. Launch headless Chromium pointed at the app.
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "drawdb-e2e-"));
  const chrome = spawn(
    CHROMIUM,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${userDir}`,
      appUrl,
    ],
    { stdio: "ignore" },
  );

  t.after(async () => {
    chrome.kill("SIGKILL");
    app.server.close();
    app.websocket.close();
    app.database.close();
    fs.rmSync(userDir, { recursive: true, force: true });
  });

  // 3. Find the page target and attach.
  const target = await waitFor(
    async () => {
      const list = await getJSON(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      return list.find((tg) => tg.type === "page" && tg.webSocketDebuggerUrl);
    },
    { label: "chromium page target" },
  );

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  t.after(() => ws.close());

  const client = cdp(ws);
  await client.send("Runtime.enable");
  await client.send("Page.enable");

  // 4. Wait for React to mount into #root.
  const mounted = await waitFor(
    async () => {
      const { result } = await client.send("Runtime.evaluate", {
        expression: "document.getElementById('root')?.childElementCount || 0",
        returnByValue: true,
      });
      return result.value > 0;
    },
    { label: "React root to mount", timeout: 20000 },
  );
  assert.ok(mounted, "React mounted content into #root");

  // 5. /editor must present the dismissable Create/Open start chooser rather
  // than force-creating a diagram (regression guard for the orphan-diagram bug).
  await client.send("Page.navigate", { url: `${appUrl}editor` });
  const chooser = await waitFor(
    async () => {
      const { result } = await client.send("Runtime.evaluate", {
        expression: `(() => {
          const text = document.body.innerText;
          return JSON.stringify({
            createTab: text.includes('Create new'),
            openTab: text.includes('Open existing'),
            dismissable: text.includes('Cancel'),
          });
        })()`,
        returnByValue: true,
      });
      const state = JSON.parse(result.value);
      return state.createTab && state.openTab && state.dismissable ? state : null;
    },
    { label: "/editor start chooser (Create/Open, dismissable)", timeout: 15000 },
  );
  assert.ok(chooser.openTab, "start chooser offers 'Open existing'");
  assert.ok(chooser.dismissable, "start chooser is dismissable (has Cancel)");

  // Give any deferred module errors a beat to surface, then assert none across
  // both the landing and the editor.
  await new Promise((r) => setTimeout(r, 500));
  const exceptions = client.events
    .filter((e) => e.method === "Runtime.exceptionThrown")
    .map((e) => e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text)
    .filter(Boolean);
  assert.deepEqual(exceptions, [], `uncaught page exceptions:\n${exceptions.join("\n")}`);
});
