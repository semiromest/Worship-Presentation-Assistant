import { useTranslation } from 'react-i18next';
import { COLOR_PALETTES, getRecentColors, addRecentColor, type PaletteName } from './colors';

interface ColorPaletteProps {
  onSelect: (color: string) => void;
  currentColor?: string;
}

export function ColorPalette({ onSelect, currentColor }: ColorPaletteProps) {
  const { t } = useTranslation();
  const recentColors = getRecentColors();
  const palettes = Object.entries(COLOR_PALETTES) as [PaletteName, typeof COLOR_PALETTES[PaletteName]][];

  const paletteTitle: Record<string, string> = {
    modern: t('common.paletteModern'),
    pastel: t('common.palettePastel'),
    dark: t('common.paletteDark'),
    brand: t('common.paletteBrand'),
    gray: t('common.paletteGray'),
  };

  const handleSelect = (color: string) => {
    addRecentColor(color);
    onSelect(color);
  };

  return (
    <div className="space-y-2">
      {recentColors.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">
            {t('common.editorRecentColors')}
          </div>
          <div className="flex flex-wrap gap-1">
            {recentColors.map((color, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelect(color)}
                className={`h-6 w-6 rounded-full border-2 transition hover:scale-110 ${
                  currentColor === color
                    ? 'border-blue-400'
                    : 'border-white/10'
                }`}
                style={{ backgroundColor: color }}
                title={color}
                aria-label={`${t('common.editorRecentColors')}: ${color}`}
              />
            ))}
          </div>
        </div>
      )}

      {palettes.map(([name, palette]) => (
        <div key={name}>
          <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">
            {paletteTitle[name] || palette.name}
          </div>
          <div className="flex flex-wrap gap-1">
            {palette.colors.map((color, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelect(color)}
                className={`h-6 w-6 rounded-full border-2 transition hover:scale-110 ${
                  currentColor === color
                    ? 'border-blue-400'
                    : 'border-white/10'
                }`}
                style={{ backgroundColor: color }}
                title={color}
                aria-label={`${paletteTitle[name] || palette.name}: ${color}`}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
