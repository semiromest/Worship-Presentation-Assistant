export type SupportPlatform = 'kreosus' | 'github';
export type SupportAvailability = Record<SupportPlatform, boolean>;
export type SupportConfig = Record<SupportPlatform, { url: string | null; enabled: boolean }>;

/** Enable a provider only after its public support profile is ready to accept payments. */
export const SUPPORT_CONFIG: SupportConfig = {
  kreosus: { url: 'https://kreosus.com/wpa-software', enabled: true },
  github: { url: 'https://github.com/sponsors/semiromest', enabled: false },
};

/** The renderer chooses a provider, never an arbitrary external URL. */
export function supportUrl(platform: unknown, config: SupportConfig = SUPPORT_CONFIG): string | null {
  if (platform !== 'kreosus' && platform !== 'github') return null;
  const entry = config[platform];
  if (!entry.enabled || !entry.url) return null;
  try {
    const url = new URL(entry.url);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (platform === 'github') {
      if (url.host !== 'github.com' || !/^\/sponsors\/[a-z\d-]+\/?$/i.test(url.pathname) || url.search || url.hash) return null;
    } else if (url.host !== 'kreosus.com' || url.pathname === '/') return null;
    return url.href;
  } catch { return null; }
}

export function supportAvailability(config: SupportConfig = SUPPORT_CONFIG): SupportAvailability {
  return { kreosus: !!supportUrl('kreosus', config), github: !!supportUrl('github', config) };
}
