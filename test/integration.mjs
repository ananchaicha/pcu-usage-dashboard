import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dataDir = await mkdtemp(join(tmpdir(), "pcu-dashboard-test-"));
const port = 18765;
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DATA_DIR: dataDir,
    ADMIN_EMAIL: "admin@example.test",
    ADMIN_PASSWORD: "correct-horse-battery-staple",
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const base = `http://127.0.0.1:${port}`;
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    if (i === 49) throw new Error("Server did not start");
  }

  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/me`)).json(), { isAdmin: false, signedIn: false });
  assert.equal((await fetch(`${base}/api/dataset`, { method: "PUT", body: "denied" })).status, 403);

  const badLogin = await fetch(`${base}/admin/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: "admin@example.test", password: "wrong-password" }),
  });
  assert.equal(badLogin.status, 401);

  const login = await fetch(`${base}/admin/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: "admin@example.test", password: "correct-horse-battery-staple" }),
  });
  assert.equal(login.status, 303);
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const saved = await fetch(`${base}/api/dataset`, {
    method: "PUT",
    headers: {
      cookie,
      "content-type": "text/csv; charset=utf-8",
      "x-dataset-period": "2026-10",
      "x-dataset-filename": encodeURIComponent("visit-recording-2026-10.csv"),
    },
    body: "name,visits\nunit,25",
  });
  assert.equal(saved.status, 200);

  const catalog = await (await fetch(`${base}/api/datasets`)).json();
  assert.equal(catalog.latest, "2026-10");
  assert.equal(catalog.periods.length, 1);
  assert.equal(await (await fetch(`${base}/api/dataset?period=2026-10`)).text(), "name,visits\nunit,25");
  assert.deepEqual(await (await fetch(`${base}/api/me`, { headers: { cookie } })).json(), { isAdmin: true, signedIn: true });
  console.log("Portable dashboard integration tests passed");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolveWait) => child.once("exit", resolveWait));
  await rm(dataDir, { recursive: true, force: true });
}
