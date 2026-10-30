import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { usePreviewImage } from '../../src/renderer/hooks/usePreviewImage';
import { notePreviewScroll } from '../../src/renderer/scrollPreviewPolicy';

export function mountPreviewPolicyProbe(source: string) {
  const host = document.createElement('div');
  document.body.append(host);
  function Probe() {
    const url = usePreviewImage(source, 800);
    return createElement('img', { 'data-policy-source': '', src: url });
  }
  const root = createRoot(host);
  notePreviewScroll(3);
  const timer = setInterval(() => notePreviewScroll(3), 50);
  root.render(createElement(Probe));
  return {
    idle: () => clearInterval(timer),
    scroll: () => notePreviewScroll(3),
    close: () => { clearInterval(timer); root.unmount(); host.remove(); },
  };
}
