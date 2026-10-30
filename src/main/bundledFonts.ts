import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
interface Family { family: string; faces: { file: string; weight: string; style: string }[] }
let manifestPromise: Promise<{ root: string; families: Family[] }> | undefined;
export function bundledFontManifest() {
  return manifestPromise ??= (async () => {
    const root = app.isPackaged ? path.join(process.resourcesPath, 'fonts') : path.resolve(__dirname, '../resources/fonts');
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
    return { root, families: manifest.families as Family[] };
  })().catch(error => { manifestPromise = undefined; throw error; });
}
export async function bundledFontCss(name: string): Promise<string | null> {
  const { root, families } = await bundledFontManifest();
  const family = families.find(value => value.family === name);
  if (!family) return null;
  return (await Promise.all(family.faces.map(async face => {
    const bytes = await fs.readFile(path.join(root, face.file));
    return `@font-face{font-family:${JSON.stringify(name)};font-style:${face.style};font-weight:${face.weight};src:url(data:font/ttf;base64,${bytes.toString('base64')}) format('truetype');font-display:block;}`;
  }))).join('\n');
}
