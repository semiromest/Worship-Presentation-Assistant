import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { evaluateFirewall, inspectRemoteFirewall, REMOTE_FIREWALL_SCRIPT, type FirewallSnapshot } from './remoteFirewallDiagnostics';

const publicNetwork: FirewallSnapshot = {
  profile: 'Public', enabled: true, blockAll: false, defaultBlock: true,
  allow: false, block: false, scoped: false,
};

test('missing permission on Public is detected independently of a successful local self-test', () => {
  assert.deepEqual(evaluateFirewall(publicNetwork), { profile: 'Public', status: 'missingPermission' });
  assert.equal(evaluateFirewall({ ...publicNetwork, profile: 'Private', allow: true }).status, 'allowed');
});

test('explicit blocks override allows and disabled firewall is not a permission failure', () => {
  assert.equal(evaluateFirewall({ ...publicNetwork, allow: true, block: true }).status, 'blocked');
  assert.equal(evaluateFirewall({ ...publicNetwork, allow: true, blockAll: true }).status, 'blocked');
  assert.equal(evaluateFirewall({ ...publicNetwork, enabled: false }).status, 'disabled');
});

test('scoped rules and unknown profiles are inconclusive rather than successful', () => {
  assert.equal(evaluateFirewall({ ...publicNetwork, allow: true, scoped: true }).status, 'unknown');
  assert.equal(evaluateFirewall({ ...publicNetwork, profile: null }).status, 'unknown');
  assert.equal(evaluateFirewall({ ...publicNetwork, defaultBlock: false }).status, 'allowed');
});

test('other platforms do not run Windows commands', { skip: process.platform === 'win32' }, async () => {
  assert.deepEqual(await inspectRemoteFirewall('192.168.1.2', 1234), { profile: null, status: 'unsupported' });
});

test('Windows rule filtering excludes other packages, services, profiles and ports', { skip: process.platform !== 'win32' }, () => {
  // Mock the read-only Windows providers; never add rules to the actual firewall.
  const prelude = String.raw`
$script:policyFixture = [pscustomobject]@{ Rules = @(($env:WPA_DIAG_RULES | ConvertFrom-Json)) }
$script:policyFixture | Add-Member ScriptMethod FirewallEnabled { param($profile) $true }
$script:policyFixture | Add-Member ScriptMethod BlockAllInboundTraffic { param($profile) $false }
$script:policyFixture | Add-Member ScriptMethod DefaultInboundAction { param($profile) 0 }
function Get-NetIPAddress { param($AddressFamily, $IPAddress) [pscustomobject]@{ InterfaceIndex = 1 } }
function Get-NetConnectionProfile { param($InterfaceIndex) [pscustomobject]@{ NetworkCategory = 'Public' } }
function New-Object { param($ComObject) $script:policyFixture }
`;
  const base = { Enabled: true, Direction: 1, Profiles: 4, Protocol: 6, LocalPorts: '38473', Action: 1, ApplicationName: process.execPath };
  const cases = [
    { rules: [{ ...base, ApplicationName: '', LocalAppPackageId: 'S-1-15-2-other-app' }, { ...base, ApplicationName: '', ServiceName: 'OtherService' }, { ...base, Profiles: 2 }, { ...base, LocalPorts: '443' }], status: 'missingPermission' },
    { rules: [{ ...base, EdgeTraversal: true }], status: 'allowed' },
    { rules: [{ ...base, LocalPorts: '38000-39000' }, { ...base, Action: 0 }], status: 'blocked' },
    { rules: [{ ...base, LocalUserAuthorizedList: 'restricted-user' }], status: 'unknown' },
  ];
  for (const { rules, status } of cases) {
    const stdout = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(prelude + REMOTE_FIREWALL_SCRIPT, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 15000, encoding: 'utf8',
      env: { ...process.env, WPA_DIAG_RULES: JSON.stringify(rules), WPA_DIAG_IP: '192.168.1.2', WPA_DIAG_PORT: '38473', WPA_DIAG_PROGRAM: process.execPath },
    });
    assert.equal(evaluateFirewall(JSON.parse(stdout)).status, status);
  }
});
