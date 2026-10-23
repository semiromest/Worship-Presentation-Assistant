export interface FirewallDiagnostic {
  status: 'allowed' | 'disabled' | 'blocked' | 'missingPermission' | 'unknown' | 'unsupported';
  profile: 'Public' | 'Private' | 'Domain' | null;
}
