// engine/src/agents/manager/permissions/pathGate.test.ts -- AGT-5. Ports
// backend/tests/test_path_gate.py case-for-case. Every Bash case is mirrored for PowerShell, same
// reason the Python suite does: on Windows the CLI's shell tool is named `PowerShell`, not `Bash`.
// Every test runs with an empty trusted-paths allowlist by default (the module's own default),
// matching the Python suite's `empty_trusted` autouse fixture; the trust tests opt a pattern in
// explicitly via the `loadTrustedSensitivePaths` injection seam.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUDITED_CLI_VERSION,
  describeSensitivePattern,
  extractTargetPath,
  looksLikeOsScheduling,
  matchBashCatastrophicPattern,
  matchSensitivePattern,
  maybeOverridePolicy,
  SCHEDULE_GATED,
  SHELL_TOOLS,
} from './pathGate';

const trust = (patterns: readonly string[]) => () => patterns;

describe('matchSensitivePattern', () => {
  it('flags sensitive paths', () => {
    expect(matchSensitivePattern('/Users/eric/.ssh/authorized_keys')).toBe('*/.ssh/*');
    expect(matchSensitivePattern('/Users/eric/.zshrc')).toBe('*/.zshrc');
    expect(matchSensitivePattern('/Users/eric/.aws/credentials')).toBe('*/.aws/*');
    expect(matchSensitivePattern('/Users/eric/Library/Keychains/login.keychain-db')).toBe('*/Library/Keychains/*');
    expect(matchSensitivePattern('/etc/anything')).toBe('/etc/*');
  });

  it('does not flag benign paths', () => {
    expect(matchSensitivePattern('/Users/eric/project/main.py')).toBeUndefined();
    expect(matchSensitivePattern('')).toBeUndefined();
  });

  it('skips a trusted pattern', () => {
    expect(matchSensitivePattern('/Users/eric/.ssh/authorized_keys', trust(['*/.ssh/*']))).toBeUndefined();
  });
});

describe('looksLikeOsScheduling', () => {
  it('detects OS scheduling', () => {
    expect(looksLikeOsScheduling({ command: 'crontab -e' })).toBe(true);
    expect(looksLikeOsScheduling({ command: 'schtasks /create /tn evil' })).toBe(true);
    expect(looksLikeOsScheduling({ command: 'Register-ScheduledTask -TaskName x' })).toBe(true);
    expect(looksLikeOsScheduling({ command: 'launchctl load ~/Library/LaunchAgents/x.plist' })).toBe(true);
  });

  it('ignores benign commands and garbage input', () => {
    expect(looksLikeOsScheduling({ command: 'echo hello' })).toBe(false);
    expect(looksLikeOsScheduling({ command: '' })).toBe(false);
    expect(looksLikeOsScheduling('not a dict')).toBe(false);
  });
});

describe('matchBashCatastrophicPattern', () => {
  it('flags catastrophic bash writes', () => {
    expect(matchBashCatastrophicPattern('echo key >> ~/.ssh/authorized_keys')).toBe('*/.ssh/*');
    expect(matchBashCatastrophicPattern('cp evil /etc/sudoers')).toBe('/etc/sudoers');
    expect(matchBashCatastrophicPattern('printf x > /etc/shadow')).toBe('/etc/shadow');
  });

  it('requires a write operator', () => {
    expect(matchBashCatastrophicPattern('cat ~/.ssh/id_rsa')).toBeUndefined();
    expect(matchBashCatastrophicPattern('echo hello world')).toBeUndefined();
  });

  it('flags catastrophic PowerShell writes (honours ~ and forward slashes)', () => {
    expect(matchBashCatastrophicPattern("'ssh-rsa AAA' >> ~/.ssh/authorized_keys")).toBe('*/.ssh/*');
    expect(matchBashCatastrophicPattern('Add-Content -Path $env:USERPROFILE\\.ssh\\authorized_keys -Value \'ssh-rsa AAA\'')).toBe(
      '*/.ssh/*',
    );
    expect(matchBashCatastrophicPattern("Set-Content C:\\Users\\me\\.ssh\\authorized_keys 'ssh-rsa AAA'")).toBe('*/.ssh/*');
    expect(matchBashCatastrophicPattern("'ssh-rsa AAA' | Out-File -Append $HOME\\.ssh\\authorized_keys")).toBe('*/.ssh/*');
    expect(matchBashCatastrophicPattern('Copy-Item evil.txt C:\\Users\\me\\.ssh\\authorized_keys')).toBe('*/.ssh/*');
  });

  it('requires a write operator for PowerShell too', () => {
    expect(matchBashCatastrophicPattern('Get-Content $env:USERPROFILE\\.ssh\\id_rsa')).toBeUndefined();
    expect(matchBashCatastrophicPattern("Write-Output 'hello world'")).toBeUndefined();
  });
});

describe('extractTargetPath', () => {
  it('extracts the target path per tool shape', () => {
    expect(extractTargetPath('Write', { file_path: '/a/b.py' })).toBe('/a/b.py');
    expect(extractTargetPath('NotebookEdit', { notebook_path: '/n.ipynb' })).toBe('/n.ipynb');
    expect(extractTargetPath('Write', {})).toBe('');
    expect(extractTargetPath('Write', 'not a dict')).toBe('');
  });
});

describe('maybeOverridePolicy (the orchestrator)', () => {
  it('flips always_allow to ask on a sensitive write', () => {
    expect(maybeOverridePolicy('always_allow', 'Write', { file_path: '/Users/eric/.ssh/authorized_keys' })).toEqual([
      'ask',
      '*/.ssh/*',
    ]);
  });

  it('passes benign writes through', () => {
    expect(maybeOverridePolicy('always_allow', 'Write', { file_path: '/Users/eric/project/x.py' })).toEqual([
      'always_allow',
      undefined,
    ]);
  });

  it('flips bash OS scheduling to ask', () => {
    expect(maybeOverridePolicy('always_allow', 'Bash', { command: 'crontab -e' })).toEqual(['ask', undefined]);
  });

  it('flips catastrophic bash to ask', () => {
    expect(maybeOverridePolicy('always_allow', 'Bash', { command: 'echo x > /etc/sudoers' })).toEqual(['ask', '/etc/sudoers']);
  });

  it('leaves ordinary bash alone', () => {
    expect(maybeOverridePolicy('always_allow', 'Bash', { command: 'ls -la' })).toEqual(['always_allow', undefined]);
  });

  it('flips PowerShell OS scheduling to ask (the shell tool Windows actually gets)', () => {
    expect(maybeOverridePolicy('always_allow', 'PowerShell', { command: 'Register-ScheduledTask -TaskName evil -Action $a' })).toEqual([
      'ask',
      undefined,
    ]);
    expect(
      maybeOverridePolicy('always_allow', 'PowerShell', { command: 'schtasks /create /tn evil /tr calc.exe /sc minute' }),
    ).toEqual(['ask', undefined]);
  });

  it('flips catastrophic PowerShell to ask', () => {
    expect(
      maybeOverridePolicy('always_allow', 'PowerShell', {
        command: "Add-Content -Path $env:USERPROFILE\\.ssh\\authorized_keys -Value 'ssh-rsa AAA'",
      }),
    ).toEqual(['ask', '*/.ssh/*']);
  });

  it('leaves ordinary PowerShell alone', () => {
    expect(maybeOverridePolicy('always_allow', 'PowerShell', { command: 'Get-ChildItem -Force' })).toEqual([
      'always_allow',
      undefined,
    ]);
    expect(maybeOverridePolicy('always_allow', 'PowerShell', { command: 'npm run verify' })).toEqual(['always_allow', undefined]);
  });

  it('honors trust for PowerShell', () => {
    expect(
      maybeOverridePolicy(
        'always_allow',
        'PowerShell',
        { command: "Set-Content C:\\Users\\me\\.ssh\\authorized_keys 'k'" },
        trust(['*/.ssh/*']),
      ),
    ).toEqual(['always_allow', undefined]);
  });

  it('the gated tool-name manifests cover both platform shells', () => {
    expect(SHELL_TOOLS.has('Bash')).toBe(true);
    expect(SHELL_TOOLS.has('PowerShell')).toBe(true);
  });

  it('Monitor is gated because its input is a shell command', () => {
    expect(SHELL_TOOLS.has('Monitor')).toBe(true);
    expect(
      maybeOverridePolicy('always_allow', 'Monitor', { command: "while ($true) { Add-Content ~/.ssh/authorized_keys 'k'; sleep 60 }" }),
    ).toEqual(['ask', '*/.ssh/*']);
    expect(maybeOverridePolicy('always_allow', 'Monitor', { command: 'tail -f dev.log | grep --line-buffered ERROR' })).toEqual([
      'always_allow',
      undefined,
    ]);
  });

  it('TaskStop is not gated', () => {
    expect(SHELL_TOOLS.has('TaskStop')).toBe(false);
    expect(SCHEDULE_GATED.has('TaskStop')).toBe(false);
    expect(maybeOverridePolicy('always_allow', 'TaskStop', { task_id: 'abc123' })).toEqual(['always_allow', undefined]);
  });

  it('does not touch non-path-gated tools', () => {
    expect(maybeOverridePolicy('always_allow', 'Read', { file_path: '/Users/eric/.ssh/authorized_keys' })).toEqual([
      'always_allow',
      undefined,
    ]);
  });

  it('respects a non-permissive policy without a pattern', () => {
    expect(maybeOverridePolicy('ask', 'Write', { file_path: '/Users/eric/.ssh/authorized_keys' })).toEqual(['ask', undefined]);
  });

  it('honors trust', () => {
    expect(maybeOverridePolicy('always_allow', 'Write', { file_path: '/Users/eric/.ssh/authorized_keys' }, trust(['*/.ssh/*']))).toEqual(
      ['always_allow', undefined],
    );
  });
});

describe('the gated tool-name manifests are pinned to the audited CLI version', () => {
  it('drift guard: the bundled Claude CLI version must match AUDITED_CLI_VERSION', () => {
    // Same drift guard as test_path_gate.py's test_tool_name_manifests_are_pinned_to_the_audited_
    // cli_version, read off the installed SDK package's own claudeCodeVersion field (AGT-4's own
    // derivation of what "CLI version" means on the TS side -- see AGT-4's row in txm-status.md).
    // The package has no "./package.json" export subpath, so resolve its main entry and walk up.
    const entryPath = require.resolve('@anthropic-ai/claude-agent-sdk');
    const pkgRoot = entryPath.slice(0, entryPath.indexOf('claude-agent-sdk') + 'claude-agent-sdk'.length);
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as { claudeCodeVersion?: string };
    expect(pkg.claudeCodeVersion).toBe(AUDITED_CLI_VERSION);
  });
});

describe('describeSensitivePattern', () => {
  it('describes a known pattern from either table', () => {
    const [label, why] = describeSensitivePattern('*/.ssh/*')!;
    expect(label).toContain('SSH');
    expect(why).toBeTruthy();
    const [label2] = describeSensitivePattern('/etc/sudoers')!; // catastrophic table
    expect(label2).toContain('Sudo');
    expect(describeSensitivePattern('not-a-real-pattern')).toBeUndefined();
  });
});
