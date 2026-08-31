const AZURE_SIGNING_ENV = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_SIGNING_ENDPOINT',
  'AZURE_SIGNING_ACCOUNT',
  'AZURE_SIGNING_CERT_PROFILE',
];

const STORE_IDENTITY_ENV = [
  'MAESTRO_STORE_IDENTITY_NAME',
  'MAESTRO_STORE_PUBLISHER',
  'MAESTRO_STORE_PUBLISHER_DISPLAY_NAME',
];

function resolveWindowsBuildMode(flags = {}, env = process.env) {
  const normalized = {
    publish: false,
    sign: false,
    devSign: false,
    store: false,
    dirOnly: false,
    squirrel: false,
    ...flags,
  };

  if (normalized.store) {
    const conflicts = [
      ['publish', 'Publish'],
      ['sign', 'Sign'],
      ['devSign', 'DevSign'],
      ['dirOnly', 'DirOnly'],
      ['squirrel', 'Squirrel'],
    ]
      .filter(([key]) => normalized[key])
      .map(([, label]) => `-${label}`);
    if (conflicts.length) throw new Error(`-Store cannot be combined with ${conflicts.join(', ')}`);

    const missingStoreEnv = STORE_IDENTITY_ENV.filter((name) => !String(env[name] || '').trim());
    if (missingStoreEnv.length) {
      throw new Error(`-Store requires Partner Center identity values: ${missingStoreEnv.join(', ')}`);
    }

    return {
      channel: 'store',
      requiresAzureSigning: false,
      missingAzureEnv: [],
      targetArgs: [
        '--config.win.target=appx',
        `--config.appx.identityName=${env.MAESTRO_STORE_IDENTITY_NAME}`,
        `--config.appx.publisher=${env.MAESTRO_STORE_PUBLISHER}`,
        `--config.appx.publisherDisplayName=${env.MAESTRO_STORE_PUBLISHER_DISPLAY_NAME}`,
        '--config.appx.artifactName=MaestroStudio-Store-${version}-${arch}.${ext}',
      ],
    };
  }

  const requiresAzureSigning = normalized.publish || normalized.sign;
  return {
    channel: 'stable',
    requiresAzureSigning,
    missingAzureEnv: requiresAzureSigning
      ? AZURE_SIGNING_ENV.filter((name) => !String(env[name] || '').trim())
      : [],
    targetArgs: normalized.squirrel
      ? [
        '--config.win.target=squirrel',
        '--config.squirrelWindows.iconUrl=https://raw.githubusercontent.com/gmartinstech/maestro-desktop/main/electron/build/icon.ico',
      ]
      : [],
  };
}

function cliFlags(argv) {
  return Object.fromEntries(argv.map((arg) => [arg.replace(/^--/, ''), true]));
}

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(resolveWindowsBuildMode(cliFlags(process.argv.slice(2)))));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { AZURE_SIGNING_ENV, STORE_IDENTITY_ENV, resolveWindowsBuildMode };
