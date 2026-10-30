import approval from '../shared/optimizationApproval.json';
const override = import.meta.env?.VITE_PREVIEW_OPTIMIZATION;
/** Overrides are only for matched measurement builds; release follows evidence. */
export const PREVIEW_OPTIMIZATION_ENABLED = override === '1' || override !== '0' && approval.preview;
