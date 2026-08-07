const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

function getStateFilePath(userDataDir) {
  return path.join(userDataDir, "install.json");
}

function readState(userDataDir) {
  const p = getStateFilePath(userDataDir);
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  return {};
}

function writeState(userDataDir, state) {
  const p = getStateFilePath(userDataDir);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // Rename a complete temp file so termination cannot leave invalid JSON.
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, p);
  } catch (err) {
    console.warn("[installId] failed to write install.json:", err && err.message);
  }
}

const INSTALL_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

function pythonSettingsFile({ isPackaged, projectRoot, platform, env, homeDir }) {
  if (!isPackaged) {
    return path.join(projectRoot, "backend", "data", "settings", "settings.json");
  }
  let appSupport;
  if (platform === "darwin") {
    appSupport = path.join(homeDir, "Library", "Application Support", "OpenSwarm");
  } else if (platform === "win32") {
    appSupport = path.join(env.APPDATA || homeDir, "OpenSwarm");
  } else {
    appSupport = path.join(env.XDG_DATA_HOME || path.join(homeDir, ".local", "share"), "OpenSwarm");
  }
  return path.join(appSupport, "data", "settings", "settings.json");
}

function resolveInstallId({
  userDataDir,
  isPackaged,
  projectRoot,
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir(),
}) {
  const state = readState(userDataDir);
  if (typeof state.app_install_id === "string" && INSTALL_ID_RE.test(state.app_install_id)) {
    return state.app_install_id;
  }

  try {
    const settingsPath = pythonSettingsFile({ isPackaged, projectRoot, platform, env, homeDir });
    const iid = JSON.parse(fs.readFileSync(settingsPath, "utf8")).installation_id;
    if (typeof iid === "string" && INSTALL_ID_RE.test(iid)) {
      writeState(userDataDir, { ...state, app_install_id: iid });
      return iid;
    }
  } catch {}

  const freshId = crypto.randomUUID();
  writeState(userDataDir, { ...state, app_install_id: freshId });
  return freshId;
}

module.exports = { resolveInstallId, readState, writeState };
