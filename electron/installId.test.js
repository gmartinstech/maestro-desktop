// Unit tests for the desktop-side local install-id helpers (no network).
//
// These cover the non-network subset of the old affiliateTracking module:
// resolveInstallId, readState, and writeState.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const installId = require("./installId");

// --- temp-dir helper -------------------------------------------------------

function makeTempUserDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openswarm-affiliate-test-"));
  return dir;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("resolveInstallId: reuses install.json app_install_id", () => {
  const userDataDir = makeTempUserDataDir();
  installId.writeState(userDataDir, { app_install_id: "existing-id-12345" });
  const id = installId.resolveInstallId({
    userDataDir, isPackaged: true, projectRoot: userDataDir, homeDir: userDataDir,
  });
  assert.equal(id, "existing-id-12345");
});

test("resolveInstallId: adopts python settings installation_id and persists it", () => {
  const userDataDir = makeTempUserDataDir();
  const settingsDir = path.join(userDataDir, "backend", "data", "settings");
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(
    path.join(settingsDir, "settings.json"),
    JSON.stringify({ installation_id: "python-analytics-id-1" }),
  );

  const id = installId.resolveInstallId({
    userDataDir,
    isPackaged: false,
    projectRoot: userDataDir,
  });
  assert.equal(id, "python-analytics-id-1");
  const state = readJson(path.join(userDataDir, "install.json"));
  assert.equal(state.app_install_id, "python-analytics-id-1");
});

test("resolveInstallId: generates once and returns the same id on repeat calls", () => {
  const userDataDir = makeTempUserDataDir();
  const first = installId.resolveInstallId({
    userDataDir, isPackaged: true, projectRoot: userDataDir, homeDir: userDataDir,
  });
  const second = installId.resolveInstallId({
    userDataDir, isPackaged: true, projectRoot: userDataDir, homeDir: userDataDir,
  });
  assert.ok(first && first.length >= 8);
  assert.equal(second, first);
  const state = readJson(path.join(userDataDir, "install.json"));
  assert.equal(state.app_install_id, first);
});

test("install.json write is atomic-ish (temp + rename)", async () => {
  const userDataDir = makeTempUserDataDir();
  installId.writeState(userDataDir, { app_install_id: "atomic-test-1234567890", ref: "x" });
  // After write, the temp file shouldn't be left behind.
  const files = fs.readdirSync(userDataDir);
  assert.ok(files.includes("install.json"));
  assert.ok(!files.some((f) => f.endsWith(".tmp")), "no leftover temp file");
});

test("readState returns {} when no install.json exists", () => {
  const userDataDir = makeTempUserDataDir();
  const state = installId.readState(userDataDir);
  assert.deepEqual(state, {});
});

test("readState returns {} when install.json is corrupt", () => {
  const userDataDir = makeTempUserDataDir();
  fs.writeFileSync(path.join(userDataDir, "install.json"), "{ not json");
  const state = installId.readState(userDataDir);
  assert.deepEqual(state, {});
});
