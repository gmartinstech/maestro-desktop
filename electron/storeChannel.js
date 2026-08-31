function resolveUpdateChannel({
  platform = process.platform,
  windowsStore = process.windowsStore === true,
} = {}) {
  if (platform !== 'win32') return 'native';
  return windowsStore === true ? 'store' : 'cdn';
}

function storeManagedStatus() {
  return {
    status: 'store-managed',
    info: { source: 'microsoft-store' },
    error: null,
  };
}

module.exports = { resolveUpdateChannel, storeManagedStatus };
