import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, Loader2, Download, CheckSquare, AlertTriangle, X } from 'lucide-react';
import Dialog from './Dialog';
import { cn } from '../utils';
import { parseSetLink, fetchSongsByIds, parseSongXml } from '../worshipLeaderApi';

export interface SetImportHymn {
  id: string;
  title: string;
  lyrics: string;
}

interface ResultSong {
  id: number;
  title: string;
  lyrics: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  partsMode: boolean;
  onAddHymn: (hymn: SetImportHymn, partsMode?: boolean) => void;
  onImportLibrary: (hymns: SetImportHymn[]) => void;
}

export default function SetLinkImportDialog({
  open,
  onClose,
  partsMode,
  onAddHymn,
  onImportLibrary,
}: Props) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [songs, setSongs] = useState<ResultSong[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState<{ fetched: number; total: number } | null>(null);

  const reset = () => {
    setLoading(false);
    setSongs([]);
    setSelectedIds(new Set());
    setError('');
    setNote('');
    setProgress(null);
  };

  const handleClose = () => {
    reset();
    setUrl('');
    onClose();
  };

  const handleFetch = async () => {
    reset();
    const trimmed = url.trim();
    if (!trimmed) {
      setError(t('common.setImportInvalid'));
      return;
    }

    const parsed = parseSetLink(trimmed);
    if (parsed.kind === 'set_id') {
      setError(t('common.setImportSetIdOnly', { id: parsed.setLocalId ?? '' }));
      return;
    }
    if (parsed.kind === 'none' || parsed.songIds.length === 0) {
      setError(t('common.setImportInvalid'));
      return;
    }

    setLoading(true);
    try {
      const details = await fetchSongsByIds(parsed.songIds, (fetched, total) =>
        setProgress({ fetched, total })
      );
      const results: ResultSong[] = [];
      for (const d of details) {
        const lyrics = parseSongXml(d.songxml);
        if (!lyrics.trim()) continue;
        results.push({ id: d.id, title: d.title, lyrics });
      }
      setSongs(results);
      setSelectedIds(new Set(results.map((s) => s.id)));
      if (results.length === 0) {
        setNote(t('common.setImportNoSongs'));
      }
    } catch (e: any) {
      setError(e?.message ?? t('common.setImportFetchError'));
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === songs.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(songs.map((s) => s.id)));
  };

  const handleAddToPresentation = () => {
    const chosen = songs.filter((s) => selectedIds.has(s.id));
    if (chosen.length === 0) return;

    const imported: SetImportHymn[] = chosen.map((s) => ({
      id: String(s.id),
      title: s.title,
      lyrics: s.lyrics,
    }));

    for (const hymn of imported) {
      onAddHymn(hymn, partsMode);
    }
    onImportLibrary(imported);
    handleClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      labelledBy="set-link-import-title"
      className="bg-surface-overlay rounded-xl border border-white/10 w-full max-w-lg mx-4 shadow-2xl"
    >
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <h3 id="set-link-import-title" className="text-sm font-semibold text-white/80 flex items-center gap-2">
          <Link2 className="w-4 h-4 text-sky-400" aria-hidden="true" />
          {t('common.setImportTitle')}
        </h3>
        <button
          onClick={handleClose}
          aria-label={t('common.close')}
          className="text-white/45 hover:text-white/70 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div className="space-y-1">
          <label htmlFor="set-link-input" className="block text-xs text-white/60 font-semibold mb-1">
            {t('common.setImportHint')}
          </label>
          <input
            id="set-link-input"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('common.setImportPlaceholder')}
            className="w-full bg-black/30 border border-white/10 rounded-md p-2 text-sm text-white placeholder:text-white/25 focus-visible:border-blue-500/60 focus-visible:outline-none"
          />
        </div>

        <button
          onClick={handleFetch}
          disabled={loading || !url.trim()}
          className="w-full h-10 flex items-center justify-center gap-2 bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 rounded-xl text-sm font-semibold border border-sky-500/30 transition-colors disabled:opacity-40"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          {loading
            ? t('common.setImportFetching', progress ?? { count: 0, total: 0 })
            : t('common.setImportFetch')}
        </button>

        {error && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {note && !error && (
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/50">
            {note}
          </div>
        )}

        {songs.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50 font-semibold">
                {t('common.setImportCount', { count: songs.length })}
              </span>
              <button
                onClick={toggleSelectAll}
                className="text-xs text-sky-300 hover:text-sky-200"
              >
                {selectedIds.size === songs.length
                  ? t('common.onlineHymnsClearSelection')
                  : t('common.onlineHymnsSelectAll')}
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto border border-white/10 rounded-lg divide-y divide-white/5">
              {songs.map((song) => (
                <div
                  key={song.id}
                  onClick={() => toggleSelect(song.id)}
                  role="checkbox"
                  aria-checked={selectedIds.has(song.id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleSelect(song.id);
                    }
                  }}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors',
                    selectedIds.has(song.id) ? 'bg-blue-600/20' : 'hover:bg-white/5'
                  )}
                >
                  <div
                    className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                      selectedIds.has(song.id) ? 'bg-blue-600 border-blue-600' : 'border-white/25'
                    )}
                    aria-hidden="true"
                  >
                    {selectedIds.has(song.id) && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{song.title}</div>
                    <div className="text-xs text-white/40 truncate">{song.lyrics.split('\n')[0]}</div>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={handleAddToPresentation}
              disabled={selectedIds.size === 0}
              className="w-full h-11 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40"
            >
              <CheckSquare className="w-4 h-4" aria-hidden="true" />
              {t('common.setImportAddAll', { count: selectedIds.size })}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
