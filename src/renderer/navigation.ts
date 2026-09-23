/** Keep keyboard destinations aligned with the nine visible sidebar pages. */
export const TAB_KEYS = {
  '1': 'presentations',
  '2': 'slides',
  '3': 'bible',
  '4': 'media',
  '5': 'hymns',
  '6': 'countdown',
  '7': 'screen',
  '8': 'calendar',
  '9': 'settings',
} as const;

export function tabForShortcut(key: string) {
  return TAB_KEYS[key as keyof typeof TAB_KEYS];
}
