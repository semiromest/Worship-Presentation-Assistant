import type { ReactNode, RefObject } from 'react';
import { Cloud, Loader2, LogIn, LogOut, User, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Dialog from './Dialog';

export function GooglePanel({ open, title, titleId, onClose, returnFocus, busy, children }: {
  open: boolean; title: string; titleId: string; onClose: () => void;
  returnFocus?: RefObject<HTMLElement | null>; busy?: boolean; children: ReactNode;
}) {
  const { t } = useTranslation();
  return <Dialog open={open} onClose={onClose} labelledBy={titleId} returnFocus={returnFocus}
    closeOnEscape={!busy} closeOnOverlayClick={!busy}
    className="flex flex-col w-[calc(100%-2rem)] max-w-[640px] max-h-[calc(100dvh-2rem)] overflow-hidden rounded-2xl border border-white/10 bg-surface-overlay shadow-2xl">
    <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
      <h2 id={titleId} className="flex items-center gap-2.5 text-sm font-semibold text-white/90">
        <span className="flex items-center justify-center w-7 h-7 rounded-xl bg-blue-500/15 text-blue-400" aria-hidden="true"><Cloud className="w-4 h-4" /></span>
        {title}
      </h2>
      <button type="button" disabled={busy} onClick={onClose} aria-label={t('common.close')}
        className="flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-xs text-white/55 hover:text-white/70 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 disabled:opacity-50">
        <X className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">{t('common.close')}</span>
      </button>
    </div>
    <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-4">{children}</div>
  </Dialog>;
}

export function GoogleSignIn({ description, signingIn, onSignIn, onCancel }: {
  description: string; signingIn: boolean; onSignIn: () => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  return <div className="flex flex-col items-center py-6 text-center space-y-4">
    <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-white/5 border border-white/8" aria-hidden="true">
      <Cloud className="w-6 h-6 text-white/25" />
    </div>
    <div className="space-y-1">
      <p className="text-sm font-medium text-white/70">{t('drive.signIn')}</p>
      <p className="text-xs text-white/55 max-w-[220px]">{description}</p>
    </div>
    <button type="button" onClick={onSignIn} disabled={signingIn}
      className="h-11 px-6 rounded-xl text-sm font-semibold flex items-center justify-center gap-2.5 transition-all duration-200 bg-gradient-to-r from-blue-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-blue-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised/50">
      {signingIn ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <LogIn className="w-4 h-4" aria-hidden="true" />}
      {t(signingIn ? 'drive.signingIn' : 'drive.signIn')}
    </button>
    {signingIn && <button type="button" onClick={onCancel}
      className="rounded text-xs text-white/50 underline underline-offset-2 hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">
      {t('common.cancel')}
    </button>}
  </div>;
}

export function GoogleAccount({ email, onSignOut, busy }: {
  email: string | null; onSignOut: () => void; busy?: boolean;
}) {
  const { t } = useTranslation();
  return <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white/4 border border-white/6">
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500/20 text-blue-400 shrink-0" aria-hidden="true">
        <User className="w-3.5 h-3.5" />
      </span>
      <div className="min-w-0">
        {email && <p className="text-xs font-medium text-white/70 truncate">{email}</p>}
        <p className="text-[11px] text-white/55">{t('drive.connected')}</p>
      </div>
    </div>
    <button type="button" onClick={onSignOut} disabled={busy} aria-label={t('drive.signOut')}
      className="shrink-0 flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-xs text-red-400/80 hover:text-red-300 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 disabled:opacity-50">
      <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
      <span className="hidden sm:inline">{t('drive.signOut')}</span>
    </button>
  </div>;
}
