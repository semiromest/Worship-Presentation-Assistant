import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Cloud,
  Upload,
  Download,
  Trash2,
  LogOut,
  LogIn,
  Loader2,
  FileText,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  X,
  HardDrive,
  User,
  Clock,
  FileUp,
  Edit3,
  Search,
} from 'lucide-react';
import type { DriveFile } from '../types';
import { useStore } from '../state/useStore';
import { confirmDialog } from '../dialogs';
import { playSfx } from '../sfx';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatSize(size?: string): string {
  if (!size) return '';
  const bytes = Number(size);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

function Toast({ message, type, onDismiss }: { message: string; type: 'success' | 'error'; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-medium animate-in slide-in-from-top-2 fade-in duration-200',
        type === 'success'
          ? 'bg-emerald-500/12 border-emerald-500/25 text-emerald-300'
          : 'bg-red-500/12 border-red-500/25 text-red-300'
      )}
    >
      {type === 'success' ? (
        <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
      ) : (
        <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
      )}
      <span className="flex-1 min-w-0 truncate">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 p-0.5 rounded-md opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
        aria-label="Kapat"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 animate-pulse" aria-hidden="true">
      <div className="w-4 h-4 rounded bg-white/6 shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 rounded bg-white/8 w-3/5" />
        <div className="h-2 rounded bg-white/5 w-1/4" />
      </div>
      <div className="w-6 h-6 rounded-lg bg-white/6" />
      <div className="w-6 h-6 rounded-lg bg-white/6" />
    </div>
  );
}

export default function DrivePanel() {
  const { t } = useTranslation();
  const presentation = useStore((s) => s.presentation);
  const driveSignedIn = useStore((s) => s.driveSignedIn);
  const driveEmail = useStore((s) => s.driveEmail);
  const driveFiles = useStore((s) => s.driveFiles);
  const setDriveSignedIn = useStore((s) => s.setDriveSignedIn);
  const setDriveFiles = useStore((s) => s.setDriveFiles);
  const drivePanelOpen = useStore((s) => s.drivePanelOpen);
  const setDrivePanelOpen = useStore((s) => s.setDrivePanelOpen);
  const driveSigningIn = useStore((s) => s.driveSigningIn);
  const setDriveSigningIn = useStore((s) => s.setDriveSigningIn);

const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [driveFileName, setDriveFileName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileListRef = useRef<HTMLDivElement>(null);
  const driveFilesLoaded = useStore((s) => s.driveFilesLoaded);
  const setDriveFilesLoaded = useStore((s) => s.setDriveFilesLoaded);

  // Sync filename input with presentation name when it changes
  useEffect(() => {
    setDriveFileName(presentation?.name?.trim() || '');
  }, [presentation?.name]);

  const clearFeedback = useCallback(() => {
    setError(null);
    setSuccess(null);
  }, []);

  const refreshFiles = useCallback(async () => {
    if (!window.electronAPI?.driveListFiles) return;
    setLoading(true);
    clearFeedback();
    try {
      const files = await window.electronAPI.driveListFiles();
      setDriveFiles(Array.isArray(files) ? files : []);
    } catch {
      setError(t('drive.error'));
      playSfx('error');
    } finally {
      setLoading(false);
      setDriveFilesLoaded(true);
    }
  }, [setDriveFiles, setDriveFilesLoaded, t, clearFeedback]);

  // Rescan Drive whenever the panel opens/remounts; auto-fetch only once.
  useEffect(() => {
    if (drivePanelOpen && driveSignedIn && !driveFilesLoaded) {
      refreshFiles();
    }
  }, [drivePanelOpen, driveSignedIn, driveFilesLoaded, refreshFiles]);

  const showSuccess = useCallback((msg: string) => {
    setSuccess(msg);
  }, []);

  const handleSignIn = async () => {
    if (!window.electronAPI?.driveSignIn) return;
    setDriveSigningIn(true);
    clearFeedback();
    try {
      const status = await window.electronAPI.driveSignIn();
      if (status.signedIn) {
        setDriveSignedIn(true, status.email);
        showSuccess(t('drive.connected'));
        playSfx('connect');
        refreshFiles();
      } else {
        setError(t('drive.error'));
        playSfx('error');
      }
    } catch {
      setError(t('drive.error'));
      playSfx('error');
    } finally {
      setDriveSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (!window.electronAPI?.driveSignOut) return;
    clearFeedback();
    await window.electronAPI.driveSignOut();
    setDriveSignedIn(false);
    setDriveFiles([]);
    setDriveFilesLoaded(false);
    playSfx('disconnect');
  };

  const handleUpload = async () => {
    if (!window.electronAPI?.driveSavePresentation || !presentation) {
      setError('Önce bir sunum oluşturun veya açın');
      return;
    }
    const finalName = driveFileName.trim();
    if (!finalName) {
      setError('Lütfen bir dosya adı girin');
      return;
    }
    setUploading(true);
    clearFeedback();
    try {
      const content = JSON.stringify({ ...presentation, name: finalName }, null, 2);
      const result = await window.electronAPI.driveSavePresentation(content, finalName);
      if ('ok' in result && result.ok) {
        showSuccess(t('drive.uploadSuccess'));
        playSfx('complete');
        refreshFiles();
        fileListRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        const err = 'error' in result ? result.error : undefined;
        setError(err ?? t('drive.error'));
        playSfx('error');
      }
    } catch (e) {
      setError(String(e));
      playSfx('error');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (file: DriveFile) => {
    if (!window.electronAPI?.driveDownload) return;
    setDownloading(file.id);
    clearFeedback();
    try {
      const result = await window.electronAPI.driveDownload(file.id);
      if ('ok' in result && result.ok && result.data) {
        const parsed = JSON.parse(result.data);
        showSuccess(t('drive.downloadSuccess'));
        playSfx('complete');
        window.dispatchEvent(new CustomEvent('drive-open-presentation', { detail: parsed }));
      } else {
        const err = 'error' in result ? result.error : undefined;
        setError(err ?? t('drive.error'));
        playSfx('error');
      }
    } catch (e) {
      setError(String(e));
      playSfx('error');
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (file: DriveFile) => {
    const confirmed = await confirmDialog(
      `"${file.name}" dosyasını Google Drive'dan kalıcı olarak silmek istediğinize emin misiniz?`,
      { title: 'Dosyayı Sil', detail: 'Bu işlem geri alınamaz.', confirmLabel: 'Sil', cancelLabel: 'İptal' },
    );
    if (!confirmed) return;

    if (!window.electronAPI?.driveDeleteFile) return;
    setDeleting(file.id);
    clearFeedback();
    try {
      const result = await window.electronAPI.driveDeleteFile(file.id);
      if ('ok' in result && result.ok) {
        showSuccess(`"${file.name}" silindi`);
        playSfx('delete');
        refreshFiles();
      } else {
        const err = 'error' in result ? result.error : undefined;
        setError(err ?? t('drive.error'));
        playSfx('error');
      }
    } catch (e) {
      setError(String(e));
      playSfx('error');
    } finally {
      setDeleting(null);
    }
  };

  const signedInLabel = t('drive.signedInAs', { email: driveEmail ?? '' });

  const filteredFiles = driveFiles.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  if (!drivePanelOpen) return null;

  return (
    <div
      className="border-t border-white/10 bg-surface-overlay/95 backdrop-blur-xl"
      role="region"
      aria-label="Google Drive paneli"
    >
      <div className="px-5 py-4 space-y-4">
        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2.5 text-sm font-semibold text-white/90">
            <span className="flex items-center justify-center w-7 h-7 rounded-xl bg-blue-500/15 text-blue-400" aria-hidden="true">
              <Cloud className="w-4 h-4" />
            </span>
            Google Drive
          </h2>
          <button
            type="button"
            onClick={() => setDrivePanelOpen(false)}
            className="flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-xs text-white/40 hover:text-white/70 hover:bg-white/5 transition-[color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
            aria-label="Drive panelini kapat"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{t('common.close')}</span>
          </button>
        </div>

        {/* ── Feedback toasts ── */}
        {success && (
          <Toast message={success} type="success" onDismiss={() => setSuccess(null)} />
        )}
        {error && (
          <Toast message={error} type="error" onDismiss={() => setError(null)} />
        )}

        {/* ── Signed out state ── */}
        {!driveSignedIn ? (
          <div className="flex flex-col items-center py-6 text-center space-y-4">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-white/5 border border-white/8" aria-hidden="true">
              <Cloud className="w-6 h-6 text-white/25" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-white/70">{t('drive.signIn')}</p>
              <p className="text-xs text-white/35 max-w-[220px]">
                Sunumlarınızı Google Drive ile senkronize edin
              </p>
            </div>
            <button
              type="button"
              onClick={handleSignIn}
              disabled={driveSigningIn}
              className={cn(
                'group relative overflow-hidden h-11 px-6 rounded-xl text-sm font-semibold flex items-center justify-center gap-2.5 transition-all duration-200',
                'bg-gradient-to-r from-blue-600 to-cyan-600 text-white',
                'hover:shadow-lg hover:shadow-blue-500/25 hover:scale-[1.02]',
                'active:scale-[0.98]',
                'disabled:opacity-50 disabled:hover:scale-100 disabled:shadow-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised/50'
              )}
              aria-label={driveSigningIn ? 'Google ile giriş yapılıyor' : 'Google ile giriş yap'}
            >
              {driveSigningIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  {t('drive.signingIn')}
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" aria-hidden="true" />
                  {t('drive.signIn')}
                </>
              )}
            </button>
          </div>
        ) : (
          /* ── Signed in content ── */
          <div className="space-y-4">
            {/* Account bar */}
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white/4 border border-white/6">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500/20 text-blue-400 shrink-0"
                  aria-hidden="true"
                >
                  <User className="w-3.5 h-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-white/70 truncate">{driveEmail}</p>
                  <p className="text-[10px] text-white/35">{t('drive.connected')}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="shrink-0 flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-xs text-red-400/80 hover:text-red-300 hover:bg-red-500/10 transition-[color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
                aria-label={t('drive.signOut')}
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{t('drive.signOut')}</span>
              </button>
            </div>

            {/* Filename input + Upload */}
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-xs font-medium text-white/50" htmlFor="drive-filename">
                <Edit3 className="w-3 h-3" aria-hidden="true" />
                Dosya adı
              </label>
              <div className="relative">
                <input
                  id="drive-filename"
                  type="text"
                  value={driveFileName}
                  onChange={(e) => setDriveFileName(e.target.value)}
                  placeholder="Sunum ismi"
                  maxLength={120}
                  disabled={uploading}
                  className="w-full h-10 pl-3.5 pr-16 rounded-xl bg-white/5 border border-white/10 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-blue-400/40 transition-[border-color,box-shadow] disabled:opacity-40"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-white/50 pointer-events-none select-none">.gpres</span>
              </div>
            </div>

            {/* Upload button */}
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading || !presentation || !driveFileName.trim()}
              className={cn(
                'group relative overflow-hidden w-full h-11 rounded-xl text-sm font-semibold flex items-center justify-center gap-2.5 transition-all duration-200',
                'bg-gradient-to-r from-emerald-600 to-teal-600 text-white',
                'hover:shadow-lg hover:shadow-emerald-500/25 hover:scale-[1.01]',
                'active:scale-[0.98]',
                'disabled:opacity-40 disabled:hover:scale-100 disabled:shadow-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised/50'
              )}
              aria-label={
                uploading
                  ? 'Drive yükleniyor'
                  : presentation
                  ? 'Sunumu Drive yükle'
                  : 'Önce bir sunum oluşturun'
              }
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Yükleniyor...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" aria-hidden="true" />
                  <span>{t('drive.upload')}</span>
                  {driveFileName && (
                    <span className="hidden sm:inline text-white/50 text-xs font-normal truncate max-w-[120px]">
                      ({driveFileName}.gpres)
                    </span>
                  )}
                </>
              )}
            </button>

            {/* Files section */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                  <HardDrive className="w-3 h-3" aria-hidden="true" />
                  {t('drive.driveFiles')}
                  {driveFiles.length > 0 && (
                    <span className="text-white/50 font-normal normal-case tracking-normal">
                      ({filteredFiles.length})
                    </span>
                  )}
                </h3>
                <button
                  type="button"
                  onClick={refreshFiles}
                  disabled={loading}
                  className="flex items-center gap-1 px-2 h-6 rounded-md text-[11px] text-blue-400/70 hover:text-blue-300 hover:bg-blue-500/10 transition-[color,background-color] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40"
                  aria-label={t('common.refresh')}
                >
                  <RefreshCw
                    className={cn('w-3 h-3', loading && 'animate-spin')}
                    aria-hidden="true"
                  />
                  <span className="hidden sm:inline">{t('common.refresh')}</span>
                </button>
              </div>

              {/* Search */}
              {driveFiles.length > 0 && (
                <div className="relative mb-2.5">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/50 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Dosya ara..."
                    aria-label="Dosyalarda ara"
                    className="w-full h-9 pl-9 pr-8 rounded-lg bg-white/5 border border-white/10 text-xs text-white/90 placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-blue-400/40 transition-[border-color,box-shadow]"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-white/30 hover:text-white/70 hover:bg-white/5 transition-[color,background-color]"
                      aria-label="Aramayı temizle"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}

              {/* File list */}
              <div
                ref={fileListRef}
                className="rounded-xl border border-white/6 bg-white/[0.02] max-h-56 overflow-y-auto"
                role="list"
                aria-label="Drive dosyaları"
                aria-busy={loading}
              >
                {loading ? (
                  <div className="divide-y divide-white/4" role="presentation">
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                  </div>
                ) : filteredFiles.length === 0 ? (
                  <div className="flex flex-col items-center py-8 text-center px-4">
                    <div
                      className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/4 mb-3"
                      aria-hidden="true"
                    >
                      <FileText className="w-5 h-5 text-white/15" />
                    </div>
                    <p className="text-sm font-medium text-white/40 mb-1">
                      {searchQuery ? 'Sonuç bulunamadı' : t('drive.noFiles')}
                    </p>
                    <p className="text-xs text-white/25 max-w-[200px]">
                      {searchQuery ? 'Farklı bir arama deneyin' : 'Sunumunuzu yükleyin, burada görünecek'}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/4" role="list">
                    {filteredFiles.map((file) => {
                      const isDownloading = downloading === file.id;
                      const isDeleting = deleting === file.id;
                      const isBusy = isDownloading || isDeleting;

                      return (
                        <div
                          key={file.id}
                          role="listitem"
                          className={cn(
                            'flex items-center gap-2.5 px-3.5 py-2.5 transition-colors',
                            'hover:bg-white/[0.03] group',
                            isBusy && 'opacity-50 pointer-events-none'
                          )}
                        >
                          {/* Icon */}
                          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500/8 shrink-0" aria-hidden="true">
                            <FileText className="w-4 h-4 text-blue-400/60" />
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white/80 truncate">
                              {file.name}
                            </p>
                            <div className="flex items-center gap-2 text-[11px] text-white/30">
                              {file.size && (
                                <span className="flex items-center gap-1">
                                  <FileUp className="w-2.5 h-2.5" aria-hidden="true" />
                                  {formatSize(file.size)}
                                </span>
                              )}
                              <span className="flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5" aria-hidden="true" />
                                {formatDate(file.modifiedTime)}
                              </span>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleDownload(file)}
                              disabled={isBusy}
                              className="flex items-center justify-center w-8 h-8 rounded-lg text-blue-400/60 hover:text-blue-300 hover:bg-blue-500/12 transition-[color,background-color] disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40"
                              aria-label={`${file.name} dosyasını indir ve aç`}
                            >
                              {isDownloading ? (
                                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <Download className="w-4 h-4" aria-hidden="true" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(file)}
                              disabled={isBusy}
                              className="flex items-center justify-center w-8 h-8 rounded-lg text-red-400/40 hover:text-red-300 hover:bg-red-500/10 transition-[color,background-color] disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
                              aria-label={`${file.name} dosyasını sil`}
                            >
                              {isDeleting ? (
                                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <Trash2 className="w-4 h-4" aria-hidden="true" />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
