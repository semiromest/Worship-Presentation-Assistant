import { create } from 'zustand';
import { DEFAULT_DESKTOP, type DesktopStatus, type OpenDocumentRequest } from '../shared/desktop';
export const useDesktopState = create<DesktopStatus & { requests: OpenDocumentRequest[] }>(() => ({
  preferences: DEFAULT_DESKTOP, registered: { previous: false, next: false, blackout: false }, services: {}, requests: [], outputs: [],
}));
let blocked = false;
export const desktopCommandsBlocked = () => blocked || !!document.querySelector('[role="dialog"], [role="alertdialog"]');
export function setDesktopCommandsBlocked(value: boolean) { blocked = value; }
