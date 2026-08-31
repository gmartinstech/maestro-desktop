const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const skillPath = path.join(
  __dirname,
  '..',
  '.agents',
  'skills',
  'publishing-maestro-windows-releases',
  'SKILL.md',
);

test('release skill keeps Store AppX publication separate from signed Squirrel publication', () => {
  const skill = fs.readFileSync(skillPath, 'utf8');
  assert.match(skill, /^---\nname: publishing-maestro-windows-releases\ndescription: Use when/m);
  assert.match(skill, /publish-store-appx\.ps1 -ArtifactPath/);
  assert.match(skill, /MaestroStudio-Store-1\.1879\.0-x64\.appx/);
  assert.match(skill, /ae80eace712d02ea1fc52e5194e6286d5131e13793744a3e7b3f843f5e985e71/);
  assert.match(skill, /Azure Trusted Signing/);
  assert.match(skill, /never.*version\.json/is);
});
