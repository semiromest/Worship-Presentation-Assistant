import { useTranslation } from 'react-i18next';
import { getTemplates, type SlideTemplate } from './templates';

const tplNameKeys: Record<string, string> = {
  'title-only': 'common.templateTitleOnly',
  'title-content': 'common.templateTitleContent',
  'two-column': 'common.templateTwoColumn',
  'image-text': 'common.templateImageText',
  'image-full': 'common.templateImageFull',
  'list': 'common.templateList',
};

const tplDescKeys: Record<string, string> = {
  'title-only': 'common.templateTitleOnlyDesc',
  'title-content': 'common.templateTitleContentDesc',
  'two-column': 'common.templateTwoColumnDesc',
  'image-text': 'common.templateImageTextDesc',
  'image-full': 'common.templateImageFullDesc',
  'list': 'common.templateListDesc',
};

interface SlideTemplatesProps {
  onSelect: (templateId: string) => void;
}

export function SlideTemplates({ onSelect }: SlideTemplatesProps) {
  const { t } = useTranslation();
  const templates = getTemplates();

  return (
    <div className="grid grid-cols-2 gap-2 p-1">
      {templates.map(tpl => (
        <button
          key={tpl.id}
          type="button"
          onClick={() => onSelect(tpl.id)}
          className="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-black/20 p-3 text-center transition hover:bg-black/35 hover:border-blue-500/40"
        >
          <span className="text-lg font-bold text-blue-400">{tpl.icon}</span>
          <span className="text-xs font-medium text-white/80">
            {t(tplNameKeys[tpl.id] || 'common.templateTitleOnly')}
          </span>
          <span className="text-[10px] text-white/40 leading-tight">
            {t(tplDescKeys[tpl.id] || 'common.templateTitleOnlyDesc')}
          </span>
        </button>
      ))}
    </div>
  );
}
