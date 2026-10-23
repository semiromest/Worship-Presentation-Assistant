import { execFile } from 'node:child_process';
import type { FirewallDiagnostic } from '../shared/remoteDiagnostics';

export interface FirewallSnapshot {
  profile: FirewallDiagnostic['profile'];
  enabled: boolean;
  blockAll: boolean;
  defaultBlock: boolean;
  allow: boolean;
  block: boolean;
  scoped: boolean;
}

export function evaluateFirewall(snapshot: FirewallSnapshot): FirewallDiagnostic {
  const { profile } = snapshot;
  if (!profile) return { profile, status: 'unknown' };
  if (!snapshot.enabled) return { profile, status: 'disabled' };
  if (snapshot.blockAll || snapshot.block) return { profile, status: 'blocked' };
  // Scoped/IPsec rules cannot establish access for an unknown phone address.
  if (snapshot.scoped) return { profile, status: 'unknown' };
  if (snapshot.allow || !snapshot.defaultBlock) return { profile, status: 'allowed' };
  return { profile, status: 'missingPermission' };
}

export const REMOTE_FIREWALL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ip = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $env:WPA_DIAG_IP
$connection = @(Get-NetConnectionProfile -InterfaceIndex $ip.InterfaceIndex)[0]
$profile = switch ([string]$connection.NetworkCategory) { 'Public' { 4 }; 'Private' { 2 }; 'DomainAuthenticated' { 1 }; default { throw 'Unknown profile' } }
$profileName = switch ($profile) { 4 { 'Public' }; 2 { 'Private' }; 1 { 'Domain' } }
$policy = New-Object -ComObject HNetCfg.FwPolicy2
$allow = $false; $block = $false; $scoped = $false
$port = [int]$env:WPA_DIAG_PORT
$program = $env:WPA_DIAG_PROGRAM
function Matches-Port($ports) {
  if (!$ports -or $ports -eq '*') { return $true }
  foreach ($part in $ports.Split(',')) {
    if ($part -eq [string]$port) { return $true }
    if ($part -match '^([0-9]+)-([0-9]+)$' -and $port -ge [int]$Matches[1] -and $port -le [int]$Matches[2]) { return $true }
  }
  return $false
}
foreach ($rule in $policy.Rules) {
  if (!$rule.Enabled -or $rule.Direction -ne 1 -or ($rule.Profiles -band $profile) -eq 0) { continue }
  # Packaged-app and service rules do not apply to this standalone Electron process.
  if ($rule.LocalAppPackageId -or ($rule.ServiceName -and $rule.ServiceName -ne '*')) { continue }
  if ($rule.ApplicationName -and [Environment]::ExpandEnvironmentVariables($rule.ApplicationName) -ine $program) { continue }
  if ($rule.Protocol -ne 6 -and $rule.Protocol -ne 256) { continue }
  if ($rule.Protocol -eq 6 -and !(Matches-Port $rule.LocalPorts)) { continue }
  if (($rule.LocalAddresses -and $rule.LocalAddresses -ne '*') -or
      ($rule.RemoteAddresses -and $rule.RemoteAddresses -ne '*') -or
      ($rule.Protocol -eq 6 -and $rule.RemotePorts -and $rule.RemotePorts -ne '*') -or
      ($rule.InterfaceTypes -and $rule.InterfaceTypes -ne 'All') -or
      $rule.Interfaces -or $rule.SecureFlags -or $rule.LocalUserAuthorizedList -or
      $rule.RemoteUserAuthorizedList -or $rule.RemoteMachineAuthorizedList) { $scoped = $true; continue }
  if ($rule.Action -eq 0) { $block = $true } else { $allow = $true }
}
@{ profile = $profileName; enabled = [bool]$policy.FirewallEnabled($profile); blockAll = [bool]$policy.BlockAllInboundTraffic($profile); defaultBlock = ($policy.DefaultInboundAction($profile) -eq 0); allow = $allow; block = $block; scoped = $scoped } | ConvertTo-Json -Compress
`;

// Read only. No elevation, firewall changes, or user-controlled shell interpolation.
export async function inspectRemoteFirewall(address: string, port: number): Promise<FirewallDiagnostic> {
  if (process.platform !== 'win32') return { profile: null, status: 'unsupported' };
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(REMOTE_FIREWALL_SCRIPT, 'utf16le').toString('base64')], {
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 64 * 1024,
      env: { ...process.env, WPA_DIAG_IP: address, WPA_DIAG_PORT: String(port), WPA_DIAG_PROGRAM: process.execPath },
    }, (error, stdout) => {
      try {
        if (error) throw error;
        const snapshot = JSON.parse(stdout.trim()) as FirewallSnapshot;
        if (!['Public', 'Private', 'Domain'].includes(snapshot.profile ?? '') ||
            ['enabled', 'blockAll', 'defaultBlock', 'allow', 'block', 'scoped'].some((key) => typeof snapshot[key as keyof FirewallSnapshot] !== 'boolean')) throw new Error('Invalid diagnostic');
        resolve(evaluateFirewall(snapshot));
      } catch {
        resolve({ profile: null, status: 'unknown' });
      }
    });
  });
}
