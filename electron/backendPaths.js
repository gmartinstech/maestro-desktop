const path = require('path');

function authTokenPath({ isPackaged, env, platform, home, dirname }) {
  const override = (env.MAESTRO_DATA_ROOT || '').trim();
  if (override) return path.join(path.resolve(override), 'auth.token');
  if (!isPackaged) return path.join(dirname, '..', 'backend', 'data', 'auth.token');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Maestro Studio', 'data', 'auth.token');
  if (platform === 'win32') return path.join(env.APPDATA || home, 'Maestro Studio', 'data', 'auth.token');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'Maestro Studio', 'data', 'auth.token');
}

module.exports = { authTokenPath };
