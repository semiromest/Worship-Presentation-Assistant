import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PracticeSpotlight from '../../src/renderer/components/PracticeSpotlight';
export function mount(useInert: boolean) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  function Spike() {
    const [step, setStep] = useState(0); const [closed, setClosed] = useState(false);
    const target = document.querySelector<HTMLElement>(step === 0 ? 'nav button:nth-child(2)' : '[data-spike-target]');
    return closed ? null : <PracticeSpotlight target={target} index={step} interactive useInert={useInert} exit={() => setClosed(true)}>
      <h2>Interactive spike</h2><button onClick={() => setStep(1)}>Next target</button><button onClick={() => setClosed(true)}>Exit</button>
    </PracticeSpotlight>;
  }
  root.render(<StrictMode><Spike /></StrictMode>);
  return () => { root.unmount(); host.remove(); };
}
