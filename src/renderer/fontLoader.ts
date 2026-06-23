const loadedFonts = new Set<string>();

function familyToUrl(family: string): string {
  const name = family.split(',')[0].replace(/['"]/g, '').trim();
  const encoded = encodeURIComponent(name);
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;700&display=swap`;
}

export function loadGoogleFont(family: string): void {
  if (family === 'inherit' || loadedFonts.has(family)) return;
  loadedFonts.add(family);

  const name = family.split(',')[0].replace(/['"]/g, '').trim();
  const id = `gf-${name.replace(/\s+/g, '-').toLowerCase()}`;
  if (document.getElementById(id)) return;

  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = familyToUrl(family);
  document.head.appendChild(link);
}
