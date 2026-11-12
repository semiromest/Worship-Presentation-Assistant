import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { FileDown, FileText, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { GoogleAccount, GooglePanel, GoogleSignIn } from './GooglePanel';
import { playSfx } from '../sfx';

interface CloudPresentation {
  id: string;
  name: string;
}

interface CloudPresentationDialogProps {
  provider: 'googleSlides' | 'canva';
  onClose: () => void;
  onImport: (presentation: CloudPresentation) => Promise<boolean>;
  returnFocus: RefObject<HTMLElement | null>;
}

export default function CloudPresentationDialog({ provider, onClose, onImport, returnFocus }: CloudPresentationDialogProps) {
  const { t } = useTranslation();
  const api = window.electronAPI;
  const title = provider === 'canva' ? 'Canva' : 'Google Slides';
  const readStatus = provider === 'canva' ? api.canvaStatus : api.googleSlidesStatus;
  const listFiles = provider === 'canva' ? api.canvaList : api.googleSlidesList;
  const [access, setAccess] = useState<boolean>();
  const [connecting, setConnecting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [reload, setReload] = useState(0);
  const cancelled = useRef(false);
  const [email, setEmail] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pageToken, setPageToken] = useState<string>();
  const [nextPageToken, setNextPageToken] = useState<string>();
  const [files, setFiles] = useState<CloudPresentation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [importing, setImporting] = useState<string>();
  const [importError, setImportError] = useState(false);

  useEffect(() => {
    let active = true;
    readStatus().then(status => {
      if (!active) return;
      setEmail(status.email);
      setAccess(status.signedIn);
    }).catch(() => {
      if (active) { setAccess(false); setError(true); }
    });
    return () => { active = false; };
  }, [readStatus]);

  useEffect(() => {
    if (!access) return;
    let active = true;
    setLoading(true);
    setError(false);
    const timer = setTimeout(() => {
      listFiles(query, pageToken).then(page => {
        if (!active) return;
        setFiles(previous => pageToken ? [...previous, ...page.files] : page.files);
        setNextPageToken(page.nextPageToken);
      }).catch(() => {
        if (active) setError(true);
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, query ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [access, query, pageToken, reload, listFiles]);

  const resetFiles = () => {
    setFiles([]);
    setPageToken(undefined);
    setNextPageToken(undefined);
  };

  const connect = async () => {
    cancelled.current = false;
    setConnecting(true);
    setError(false);
    setAccess(false);
    try {
      const status = await (provider === 'canva' ? api.canvaConnect() : api.googleSlidesConnect());
      if (cancelled.current) return;
      if (status.signedIn) {
        setEmail(status.email);
        setAccess(true);
        resetFiles();
        playSfx('connect');
      } else setError(true);
    } catch { if (!cancelled.current) setError(true); }
    finally { setConnecting(false); }
  };

  const cancelSignIn = async () => {
    cancelled.current = true;
    try { await (provider === 'canva' ? api.canvaCancel() : api.googleSlidesCancel()); }
    catch { cancelled.current = false; setError(true); }
  };

  const signOut = async () => {
    setSigningOut(true);
    setError(false);
    try {
      await (provider === 'canva' ? api.canvaSignOut() : api.googleSlidesSignOut());
      setEmail(null);
      setAccess(false);
      setQuery('');
      resetFiles();
      setImportError(false);
      playSfx('disconnect');
    } catch { setError(true); }
    finally { setSigningOut(false); }
  };

  const importFile = async (file: CloudPresentation) => {
    setImporting(file.id);
    setImportError(false);
    try { if (await onImport(file)) onClose(); }
    catch { setImportError(true); }
    finally { setImporting(undefined); }
  };

  const busy = signingOut || !!importing;
  return (
    <GooglePanel open title={title} titleId={`${provider}-title`} returnFocus={returnFocus} busy={busy || connecting}
      onClose={() => { playSfx('close'); onClose(); }}>
      {access === undefined && <p role="status">{t('common.loading')}</p>}
      {error && <p role="alert" className="text-sm text-red-300">{t('drive.error')}</p>}
      {importError && <p role="alert" className="text-sm text-red-300">{t('common.importFailedGeneric')}</p>}
      {access === false && <GoogleSignIn description={t(`${provider}.permission`)} signingIn={connecting}
        onSignIn={() => void connect()} onCancel={() => void cancelSignIn()} />}
      {access && <>
        <GoogleAccount email={email} onSignOut={() => void signOut()} busy={busy} />
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-white/50">{title}</h3>
          <button type="button" disabled={busy || loading} onClick={() => { resetFiles(); setReload(value => value + 1); }}
            className="flex items-center gap-1 px-2 h-6 rounded-md text-[11px] text-blue-400/70 hover:text-blue-300 hover:bg-blue-500/10 disabled:opacity-40" aria-label={t('common.refresh')}>
            <RefreshCw className={loading ? 'size-3 animate-spin' : 'size-3'} aria-hidden="true" />{t('common.refresh')}
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-white/50 pointer-events-none" aria-hidden="true" />
          <input type="search" className="w-full h-9 pl-9 pr-8 rounded-lg bg-white/5 border border-white/10 text-xs text-white/90 placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400/50" value={query} maxLength={200} disabled={busy}
            aria-label={t(`${provider}.search`)} placeholder={t(`${provider}.search`)}
            onChange={event => { setQuery(event.target.value); resetFiles(); }} />
          {query && <button type="button" disabled={busy} onClick={() => { setQuery(''); resetFiles(); }}
            aria-label={t('settings.navigation.clearSearch')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-white/55 hover:bg-white/5 hover:text-white">
            <X className="size-3" aria-hidden="true" />
          </button>}
        </div>
        <div className="rounded-xl border border-white/6 bg-white/[0.02] max-h-56 overflow-y-auto" aria-busy={loading || !!importing}>
          <ul className="divide-y divide-white/5">
            {files.map(file => <li key={file.id} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-white/[0.03]">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText className="size-4 shrink-0 text-blue-400/70" aria-hidden="true" />
                <span className="truncate text-xs font-medium text-white/80" title={file.name}>{file.name}</span>
              </div>
              <button type="button" disabled={busy} className="flex items-center gap-1.5 shrink-0 rounded-lg px-2 h-7 text-xs text-blue-400 hover:bg-blue-500/10 disabled:opacity-50" onClick={() => void importFile(file)}>
                {importing === file.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileDown className="size-4" aria-hidden="true" />}
                {importing === file.id ? t('common.importing') : t('googleSlides.add')}
              </button>
            </li>)}
          </ul>
          {loading && <p role="status" className="py-4 text-center text-xs text-white/55">{t('common.loading')}</p>}
          {!loading && !error && !files.length && <p className="py-8 text-center text-sm text-white/55">{t('drive.noFiles')}</p>}
          {nextPageToken && <button type="button" disabled={busy || loading} onClick={() => setPageToken(nextPageToken)}
            className="workspace-secondary-action mt-3">{t('googleSlides.more')}</button>}
        </div>
      </>}
    </GooglePanel>
  );
}
