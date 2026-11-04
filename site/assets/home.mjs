import { getLanguage, onLanguageChange, t } from './common.mjs';
import { samples } from './strings.mjs';
let selected = 0;
const stage = document.querySelector('#hero-stage');
const text = document.querySelector('#hero-slide-text');
function render() {
  const slide = samples(getLanguage())[selected];
  stage.className = `preview-stage theme-${slide.theme}`;
  text.textContent = slide.text;
  stage.querySelector('.stage-overline').textContent = [t('sampleWelcomeLabel'), t('sampleHymn'), t('sampleScripture')][selected];
  document.querySelectorAll('[data-preview]').forEach(button => {
    const active = Number(button.dataset.preview) === selected;
    button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active));
  });
  document.title = getLanguage() === 'tr' ? 'Worship Presentation Assistant — Hazırlığı sadeleştirin. Ana odaklanın.' : 'Worship Presentation Assistant — Prepare with clarity. Present with confidence.';
}
document.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () => { selected = Number(button.dataset.preview); render(); }));
onLanguageChange(render);
render();
