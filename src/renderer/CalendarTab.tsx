import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
  X,
  Sparkles,
  Presentation,
} from 'lucide-react';
import Dialog from './components/Dialog';

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  description?: string;
  color?: string;
  time?: string;
  /** Kayıtlı sunumun adı (Sunumlar sekmesinde kaydedilen isimle aynı) */
  presentationName?: string;
}

function parseStoredEvents(raw: unknown): CalendarEvent[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((item): CalendarEvent => {
    const e = item as Record<string, unknown>;
    const legacyRef =
      typeof e.slideId === 'string' ? e.slideId : undefined;
    const presentationName =
      typeof e.presentationName === 'string'
        ? e.presentationName
        : legacyRef;

    return {
      id: String(e.id ?? crypto.randomUUID()),
      title: String(e.title ?? ''),
      date: String(e.date ?? ''),
      description:
        typeof e.description === 'string' ? e.description : undefined,
      color: typeof e.color === 'string' ? e.color : undefined,
      time: typeof e.time === 'string' ? e.time : undefined,
      presentationName: presentationName?.trim() || undefined,
    };
  });
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

const STORAGE_KEY = 'calendar-events-v2';

const EVENT_COLORS = [
  'bg-blue-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-orange-500',
  'bg-pink-500',
];

function getLocaleMonths(locale: string): string[] {
  return Array.from({ length: 12 }, (_, i) =>
    new Date(2024, i, 1).toLocaleDateString(locale, { month: 'long' }),
  );
}

function getLocaleDays(locale: string): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }),
  );
}

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

function formatDate(date: Date) {
  return formatLocalDate(date);
}

function generateCalendarDays(year: number, month: number) {
  const firstDayOfMonth = new Date(year, month, 1);

  // Monday based calendar
  const startOffset = (firstDayOfMonth.getDay() + 6) % 7;

  const startDate = new Date(firstDayOfMonth);
  startDate.setDate(firstDayOfMonth.getDate() - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return date;
  });
}

interface CalendarTabProps {
  savedPresentationNames?: string[];
  onOpenPresentation?: (presentationName: string) => void;
}

export default function CalendarTab({
  savedPresentationNames = [],
  onOpenPresentation,
}: CalendarTabProps) {
  const { t, i18n } = useTranslation();

  const localeMap: Record<string, string> = {
    tr: 'tr-TR',
    en: 'en-US',
    es: 'es-ES',
    de: 'de-DE',
    ko: 'ko-KR',
  };
  const currentLocale = localeMap[i18n.language] || 'en-US';

  const monthNames = useMemo(() => getLocaleMonths(currentLocale), [currentLocale]);
  const dayNames = useMemo(() => getLocaleDays(currentLocale), [currentLocale]);

  const today = useMemo(() => new Date(), []);

  const [currentDate, setCurrentDate] = useState(today);
  const [selectedDate, setSelectedDate] = useState(formatDate(today));

  const [events, setEvents] = useState<CalendarEvent[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? parseStoredEvents(JSON.parse(stored)) : [];
    } catch {
      return [];
    }
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  const [newEvent, setNewEvent] = useState({
    title: '',
    description: '',
    color: EVENT_COLORS[0],
    time: '',
    presentationName: '',
  });

  const saveRef = useRef(events);
  saveRef.current = events;

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    }, 500);
    return () => clearTimeout(timer);
  }, [events]);

  useEffect(() => {
    const flush = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(saveRef.current));
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const calendarDays = useMemo(
    () => generateCalendarDays(year, month),
    [year, month]
  );

  // O(1) event lookup map
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};

    for (const event of events) {
      if (!map[event.date]) {
        map[event.date] = [];
      }

      map[event.date].push(event);
    }

    return map;
  }, [events]);

  const selectedDayEvents = eventsByDate[selectedDate] || [];

  const goToToday = useCallback(() => {
    const now = new Date();

    setCurrentDate(now);
    setSelectedDate(formatDate(now));
  }, []);

  const goToPreviousMonth = useCallback(() => {
    setCurrentDate(prev => {
      return new Date(prev.getFullYear(), prev.getMonth() - 1, 1);
    });
  }, []);

  const goToNextMonth = useCallback(() => {
    setCurrentDate(prev => {
      return new Date(prev.getFullYear(), prev.getMonth() + 1, 1);
    });
  }, []);

  const openModal = useCallback(() => {
    setEditingEvent(null);
    setNewEvent({
      title: '',
      description: '',
      color: EVENT_COLORS[0],
      time: '',
      presentationName: '',
    });
    setIsModalOpen(true);
  }, []);

  const openEditModal = useCallback((event: CalendarEvent) => {
    setEditingEvent(event);
    setNewEvent({
      title: event.title,
      description: event.description ?? '',
      color: event.color ?? EVENT_COLORS[0],
      time: event.time ?? '',
      presentationName: event.presentationName ?? '',
    });
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingEvent(null);

    setNewEvent({
      title: '',
      description: '',
      color: EVENT_COLORS[0],
      time: '',
      presentationName: '',
    });
  }, []);

  const addEvent = useCallback(() => {
    if (!newEvent.title.trim()) return;

    const event: CalendarEvent = {
      id: crypto.randomUUID(),
      title: newEvent.title.trim(),
      description: newEvent.description.trim(),
      date: selectedDate,
      color: newEvent.color,
      time: newEvent.time || undefined,
      presentationName: newEvent.presentationName.trim() || undefined,
    };

    setEvents(prev => [event, ...prev]);

    closeModal();
  }, [newEvent, selectedDate, closeModal]);

  const updateEvent = useCallback(() => {
    if (!newEvent.title.trim() || !editingEvent) return;

    setEvents(prev =>
      prev.map(event =>
        event.id === editingEvent.id
          ? {
              ...event,
              title: newEvent.title.trim(),
              description: newEvent.description.trim(),
              color: newEvent.color,
              time: newEvent.time || undefined,
              presentationName: newEvent.presentationName.trim() || undefined,
            }
          : event,
      ),
    );

    closeModal();
  }, [newEvent, editingEvent, closeModal]);

  const deleteEvent = useCallback((id: string) => {
    setEvents(prev => prev.filter(event => event.id !== id));
  }, []);

  return (
    <div className="h-full bg-surface-base text-white overflow-hidden">
      <div className="h-full flex flex-col">
        {/* HEADER */}
        <div className="border-b border-white/5 bg-surface-raised/95 backdrop-blur-xl">
          <div className="px-6 py-4 flex items-center justify-between">
            {/* LEFT */}
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-500/20 to-violet-500/20 border border-white/10 flex items-center justify-center shadow-lg shadow-blue-500/10">
                <CalendarDays className="w-5 h-5 text-blue-400" />
              </div>

              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  {t('common.calendarTitle')}
                </h2>

                <p className="text-xs text-white/40 mt-0.5">
                  {t('common.calendarSubtitle')}
                </p>
              </div>
            </div>

            {/* CENTER */}
            <div className="flex items-center gap-3">
              <button
                onClick={goToPreviousMonth}
                aria-label={t('common.calendarPrevMonth')}
                className="w-10 h-10 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] transition-all flex items-center justify-center"
              >
                <ChevronLeft className="w-5 h-5" aria-hidden="true" />
              </button>

              <div className="min-w-[220px] text-center">
                <h2 className="text-xl font-semibold tracking-tight">
                  {monthNames[month]} {year}
                </h2>
              </div>

              <button
                onClick={goToNextMonth}
                aria-label={t('common.calendarNextMonth')}
                className="w-10 h-10 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] transition-all flex items-center justify-center"
              >
                <ChevronRight className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {/* RIGHT */}
            <div className="flex items-center gap-3">
              <button
                onClick={goToToday}
                className="h-10 px-4 rounded-xl border border-blue-500/20 bg-blue-500/10 hover:bg-blue-500/20 transition-all text-sm text-blue-300 font-medium"
              >
                {t('common.calendarToday')}
              </button>

              <button
                onClick={openModal}
                className="h-10 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 hover:opacity-90 transition-all flex items-center gap-2 text-sm font-medium shadow-lg shadow-blue-500/20"
              >
                <Plus className="w-4 h-4" />
                {t('common.calendarAddEvent')}
              </button>
            </div>
          </div>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-hidden flex">
          {/* CALENDAR */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-5">
              {/* WEEK DAYS */}
              <div className="grid grid-cols-7 gap-2 mb-2">
                {dayNames.map(day => (
                  <div
                    key={day}
                    className="h-10 flex items-center justify-center text-xs uppercase tracking-wider text-white/35 font-semibold"
                  >
                    {day}
                  </div>
                ))}
              </div>

              {/* DAYS */}
              <div className="grid grid-cols-7 gap-2">
                {calendarDays.map((date, index) => {
                  const dateStr = formatDate(date);

                  const isCurrentMonth = date.getMonth() === month;

                  const isToday =
                    dateStr === formatDate(new Date());

                  const isSelected = dateStr === selectedDate;

                  const dayEvents = eventsByDate[dateStr] || [];

                  return (
                    <button
                      key={index}
                      onClick={() => setSelectedDate(dateStr)}
                      className={cn(
                        'group relative min-h-[120px] rounded-2xl border p-3 text-left transition-all duration-200 overflow-hidden',
                        isCurrentMonth
                          ? 'bg-white/[0.03] border-white/5'
                          : 'bg-white/[0.015] border-white/[0.03] opacity-40',
                        'hover:border-blue-500/20 hover:bg-white/[0.05]',
                        isSelected &&
                          'border-blue-500/40 bg-blue-500/[0.08] shadow-lg shadow-blue-500/10',
                        isToday &&
                          'ring-1 ring-blue-500/40'
                      )}
                    >
                      {/* Glow */}
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-br from-blue-500/[0.03] to-violet-500/[0.03]" />

                      {/* Top */}
                      <div className="relative z-10 flex items-center justify-between">
                        <span
                          className={cn(
                            'text-sm font-semibold',
                            isToday ? 'text-blue-300' : 'text-white/80'
                          )}
                        >
                          {date.getDate()}
                        </span>

                        {dayEvents.length > 0 && (
                          <div className="min-w-6 h-6 px-1 rounded-full bg-blue-500/20 border border-blue-500/20 text-[11px] flex items-center justify-center text-blue-300 font-medium">
                            {dayEvents.length}
                          </div>
                        )}
                      </div>

                      {/* EVENTS */}
                      <div className="relative z-10 mt-3 space-y-1.5">
                        {dayEvents.slice(0, 3).map(event => (
                          <div
                            key={event.id}
                            className="flex items-center gap-2 rounded-lg bg-black/20 border border-white/5 px-2 py-1.5"
                          >
                            <div
                              className={cn(
                                'w-2 h-2 rounded-full shrink-0',
                                event.color
                              )}
                            />

                            <span className="text-[11px] text-white/80 truncate">
                              {event.title}
                            </span>
                          </div>
                        ))}

                        {dayEvents.length > 3 && (
                          <div className="text-[11px] text-white/35 px-1">
                            {t('common.calendarMoreEvents', { count: dayEvents.length - 3 })}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* SIDEBAR */}
          <div className="w-[380px] border-l border-white/5 bg-[#12151b] overflow-y-auto">
            <div className="p-5">
              {/* DATE HEADER */}
              <div className="rounded-3xl bg-gradient-to-br from-blue-500/10 to-violet-500/10 border border-white/5 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/10">
                    <Sparkles className="w-5 h-5 text-blue-400" />
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-wider text-white/35">
                      {t('common.calendarSelectedDay')}
                    </p>

                    <h3 className="font-semibold">
                      {new Date(selectedDate).toLocaleDateString(
                        currentLocale,
                        {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                        }
                      )}
                    </h3>
                  </div>
                </div>

                <button
                  onClick={openModal}
                  className="w-full h-11 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 transition-all text-sm font-medium flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  {t('common.calendarNewEvent')}
                </button>
              </div>

              {/* EVENTS */}
              <div className="mt-6">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-semibold">
                    {t('common.calendarEvents')}
                  </h4>

                  <span className="text-xs text-white/35">
                    {t('common.calendarEventCount', { count: selectedDayEvents.length })}
                  </span>
                </div>

                <div aria-live="polite">
                {selectedDayEvents.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
                    <div className="w-16 h-16 mx-auto rounded-3xl bg-blue-500/10 border border-blue-500/10 flex items-center justify-center mb-4">
                      <CalendarDays className="w-8 h-8 text-blue-400/60" />
                    </div>

                    <h5 className="font-medium text-white/80">
                      {t('common.calendarNoEvents')}
                    </h5>

                    <p className="text-sm text-white/35 mt-2 leading-relaxed">
                      {t('common.calendarNoEventsDesc')}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedDayEvents.map(event => (
                      <div
                        key={event.id}
                        className="group rounded-3xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.05] transition-all p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex gap-3 flex-1">
                            <div
                              className={cn(
                                'w-3 h-3 rounded-full mt-1.5 shrink-0',
                                event.color
                              )}
                            />

                            <div className="min-w-0">
                              <h5 className="font-medium text-sm truncate">
                                {event.title}
                              </h5>

                              {(event.time || event.presentationName) && (
                                <div className="flex gap-3 mt-1.5 text-xs text-white/50">
                                  {event.time && <span>🕐 {event.time}</span>}
                                  {event.presentationName && (
                                    <span className="truncate" title={event.presentationName}>
                                      📊 {event.presentationName}
                                    </span>
                                  )}
                                </div>
                              )}

                              {event.description && (
                                <p className="text-xs text-white/45 mt-2 leading-relaxed">
                                  {event.description}
                                </p>
                              )}

                              {event.presentationName && onOpenPresentation && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenPresentation(event.presentationName!)
                                  }
                                  className="mt-3 w-full h-9 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-xs font-medium flex items-center justify-center gap-2 transition-all"
                                >
                                  <Presentation className="w-3.5 h-3.5" />
                                  {t('common.calendarOpenPresentation')}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="flex gap-1">
                            <button
                              onClick={() => openEditModal(event)}
                              aria-label={t('common.edit')}
                              className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-all w-9 h-9 rounded-xl hover:bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0"
                            >
                              <Pencil className="w-4 h-4" aria-hidden="true" />
                            </button>

                            <button
                              onClick={() => deleteEvent(event.id)}
                              aria-label={t('common.delete')}
                              className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-all w-9 h-9 rounded-xl hover:bg-red-500/10 text-red-400 flex items-center justify-center shrink-0"
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </div>
            </div>
          </div>
        </div>

        {/* MODAL */}
        <Dialog
          open={isModalOpen}
          onClose={closeModal}
          labelledBy="calendar-event-title"
          className="w-full max-w-md rounded-[32px] border border-white/10 bg-surface-raised shadow-2xl shadow-black/40 overflow-hidden"
        >
              <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
                <div>
                  <h3 id="calendar-event-title" className="text-lg font-semibold">
                    {editingEvent
                      ? t('common.calendarEditModalTitle')
                      : t('common.calendarModalTitle')}
                  </h3>

                  <p className="text-sm text-white/45 mt-1">
                    {new Date(selectedDate).toLocaleDateString(currentLocale)}
                  </p>
                </div>

                <button
                  onClick={closeModal}
                  aria-label={t('common.close')}
                  className="w-10 h-10 rounded-xl hover:bg-white/[0.05] flex items-center justify-center transition-all focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                >
                  <X className="w-5 h-5 text-white/60" aria-hidden="true" />
                </button>
              </div>

              {/* BODY */}
              <div className="p-6 space-y-5">
                <div>
                  <label htmlFor="cal-event-title" className="block text-xs uppercase tracking-wider text-white/35 mb-2">
                    {t('common.calendarTitleLabel')}
                  </label>

                  <input
                    id="cal-event-title"
                    type="text"
                    value={newEvent.title}
                    onChange={e =>
                      setNewEvent(prev => ({
                        ...prev,
                        title: e.target.value,
                      }))
                    }
                    placeholder={t('common.calendarTitlePlaceholder')}
                    className="w-full h-12 rounded-2xl bg-black/20 border border-white/10 px-4 outline-none focus:border-blue-500/40 transition-all"
                  />
                </div>

                <div>
                  <label htmlFor="cal-event-desc" className="block text-xs uppercase tracking-wider text-white/35 mb-2">
                    {t('common.calendarDescLabel')}
                  </label>

                  <textarea
                    id="cal-event-desc"
                    value={newEvent.description}
                    onChange={e =>
                      setNewEvent(prev => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    placeholder={t('common.calendarDescPlaceholder')}
                    className="w-full h-28 rounded-2xl bg-black/20 border border-white/10 px-4 py-3 outline-none resize-none focus:border-blue-500/40 transition-all"
                  />
                </div>

                {/* COLORS */}
                <div>
                  <label className="block text-xs uppercase tracking-wider text-white/35 mb-3">
                    {t('common.calendarColorLabel')}
                  </label>

                  <div className="flex gap-3">
                    {EVENT_COLORS.map(color => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`${t('common.calendarColorLabel')} ${color}`}
                        aria-pressed={newEvent.color === color}
                        onClick={() =>
                          setNewEvent(prev => ({
                            ...prev,
                            color,
                          }))
                        }
                        className={cn(
                          'w-10 h-10 rounded-2xl transition-all border-2',
                          color,
                          newEvent.color === color
                            ? 'border-white scale-110'
                            : 'border-transparent opacity-70 hover:opacity-100'
                        )}
                      />
                    ))}
                  </div>
                </div>

                {/* TIME */}
                <div>
                  <label htmlFor="cal-event-time" className="block text-xs uppercase tracking-wider text-white/35 mb-2">
                    {t('common.calendarTimeLabel')}
                  </label>

                  <input
                    id="cal-event-time"
                    type="time"
                    value={newEvent.time}
                    onChange={e =>
                      setNewEvent(prev => ({
                        ...prev,
                        time: e.target.value,
                      }))
                    }
                    className="w-full h-12 rounded-2xl bg-black/20 border border-white/10 px-4 outline-none focus:border-blue-500/40 transition-all"
                  />
                </div>

                {/* Sunum adı */}
                <div>
                  <label htmlFor="cal-event-pres-name" className="block text-xs uppercase tracking-wider text-white/35 mb-2">
                    {t('common.calendarPresNameLabel')}
                  </label>

                  <input
                    id="cal-event-pres-name"
                    type="text"
                    list="calendar-presentation-names"
                    value={newEvent.presentationName}
                    onChange={e =>
                      setNewEvent(prev => ({
                        ...prev,
                        presentationName: e.target.value,
                      }))
                    }
                    placeholder={t('common.calendarPresPlaceholder')}
                    className="w-full h-12 rounded-2xl bg-black/20 border border-white/10 px-4 outline-none focus:border-blue-500/40 transition-all"
                  />
                  {savedPresentationNames.length > 0 && (
                    <datalist id="calendar-presentation-names">
                      {savedPresentationNames.map(name => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  )}
                  <p className="text-[11px] text-white/45 mt-2">
                    {t('common.calendarPresHint')}
                  </p>
                </div>
              </div>

              {/* FOOTER */}
              <div className="px-6 py-5 border-t border-white/5 flex gap-3">
                <button
                  onClick={closeModal}
                  className="flex-1 h-12 rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-all font-medium"
                >
                  {t('common.calendarCancel')}
                </button>

                <button
                  onClick={editingEvent ? updateEvent : addEvent}
                  disabled={!newEvent.title.trim()}
                  className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-all hover:opacity-90"
                >
                  {editingEvent
                    ? t('common.calendarUpdate')
                    : t('common.calendarSave')}
                </button>
              </div>
        </Dialog>
      </div>
    </div>
  );
}