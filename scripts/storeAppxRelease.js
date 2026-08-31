const STORE_CDN = Object.freeze({
  host: 'cloudinha',
  stagingDir: '/home/ubuntu/maestro-releases/incoming',
  publicDir: '/home/martinstech-cdn/htdocs/cdn.martinstech.net/maestro/downloads',
  publicBaseUrl: 'https://cdn.martinstech.net/maestro/downloads',
});

const STORE_ARTIFACT_NAME = /^MaestroStudio-Store-(\d+\.\d+\.\d+)-x64\.appx$/;
const SOURCE_SHA = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;

function validateStoreArtifact(input) {
  const match = STORE_ARTIFACT_NAME.exec(input.fileName || '');
  if (!match) throw new Error('Expected MaestroStudio-Store-<version>-x64.appx');
  if (!input.identityName || input.identityName !== input.expectedIdentityName) {
    throw new Error('AppX identity does not match Partner Center identity');
  }
  if (!input.publisher || input.publisher !== input.expectedPublisher) {
    throw new Error('AppX publisher does not match Partner Center publisher');
  }
  if (!input.buildInfo || input.buildInfo.channel !== 'store'
    || input.buildInfo.version !== match[1] || !SOURCE_SHA.test(input.buildInfo.sha || '')) {
    throw new Error('AppX Store provenance is invalid');
  }
  if (!SHA256.test(input.sha256 || '')) throw new Error('AppX SHA-256 is invalid');

  const oauthUrl = new URL(input.oauthBaseUrl || '');
  if (oauthUrl.protocol !== 'https:' || oauthUrl.username || oauthUrl.password
    || oauthUrl.search || oauthUrl.hash || oauthUrl.hostname !== 'llm.martinstech.net'
    || oauthUrl.pathname.replace(/\/$/, '') !== '/v1') {
    throw new Error('Bundled OAuth URL is not the expected public gateway');
  }

  return {
    schema: 1,
    channel: 'store-static-download',
    file: input.fileName,
    version: match[1],
    sha256: input.sha256.toLowerCase(),
    provenanceSha: input.buildInfo.sha.toLowerCase(),
  };
}

module.exports = { STORE_CDN, validateStoreArtifact };
