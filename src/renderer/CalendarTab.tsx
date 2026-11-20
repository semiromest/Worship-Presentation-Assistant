import { playSfx } from './sfx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  Clock,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
  X,
  Presentation,
} from 'lucide-react';
import Dialog from './components/Dialog';
import './calendar.css';

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  description?: string;
  color?: string;
  time?: string;
  /** Name of the saved preset (same as the name saved in the Presets tab) */
  presentationName?: string;
}

function parseStoredEvents(raw: unknown): CalendarEvent[] {
  if (!Array.isArray(raw)) return [];

  return raw.filter(item => item && typeof item === 'object').map((item): CalendarEvent => {
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
  const [monthDirection, setMonthDirection] = useState(0);
  const focusDate = useRef<string | null>(null);

  const localeMap: Record<string, string> = {
    tr: 'tr-TR',
    en: 'en-US',
    es: 'es-ES',
    de: 'de-DE',
    ko: 'ko-KR',
  };
  const currentLocale = localeMap[i18n.language] || 'en-US';

  const dayNames = useMemo(() => getLocaleDays(currentLocale), [currentLocale]);
  const fullDate = useMemo(() => new Intl.DateTimeFormat(currentLocale, { dateStyle: 'full' }), [currentLocale]);

  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => formatDate(currentDate));
  const todayKey = formatDate(new Date());


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

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(events)); }
    catch { console.warn('Could not save calendar events'); }
  }, [events]);

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

  const selectedDayEvents = [...(eventsByDate[selectedDate] || [])]
    .sort((a, b) => (a.time || '24:00').localeCompare(b.time || '24:00'));
  const selectedDayLabel = new Date(`${selectedDate}T00:00:00`).toLocaleDateString(currentLocale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const goToToday = useCallback(() => {
    const now = new Date();
    setMonthDirection(0);

    if (selectedDate !== formatDate(now) || currentDate.getMonth() !== now.getMonth() || currentDate.getFullYear() !== now.getFullYear()) playSfx('select');
    setCurrentDate(now);
    setSelectedDate(formatDate(now));
  }, [selectedDate, currentDate]);

  const changeMonth = (direction: number) => {
    const next = new Date(year, month + direction, 1);
    setMonthDirection(direction);
    setCurrentDate(next);
    setSelectedDate(formatDate(next));
    playSfx(direction < 0 ? 'back' : 'forward');
  };

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
    playSfx('open');
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
    playSfx('open');
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
    playSfx('success');
  }, [newEvent, selectedDate, closeModal]);

  const updateEvent = useCallback(() => {
    if (!newEvent.title.trim() || !editingEvent) return;
    if (editingEvent.title === newEvent.title.trim() && (editingEvent.description ?? '') === newEvent.description.trim() && editingEvent.color === newEvent.color && (editingEvent.time ?? '') === newEvent.time && (editingEvent.presentationName ?? '') === newEvent.presentationName.trim()) { closeModal(); return; }

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
    playSfx('success');
  }, [newEvent, editingEvent, closeModal]);

  const deleteEvent = useCallback((id: string) => {
    setEvents(prev => prev.filter(event => event.id !== id));
    playSfx('delete');
  }, []);

  return (
    <section className="calendar-page" aria-labelledby="calendar-heading" onKeyDown={event => {
      if ((event.key === 'Enter' || event.key === ' ') && (event.target as HTMLElement).closest('button')) event.stopPropagation();
    }}>
      <header className="calendar-page-header">
        <div className="flex min-w-0 items-center gap-3">
          <span className="calendar-heading-icon"><CalendarDays size={19} aria-hidden="true" /></span>
          <div className="min-w-0">
            <h2 id="calendar-heading" className="text-lg font-semibold">{t('common.calendarTitle')}</h2>
            <p className="text-xs text-white/65">{t('common.calendarSubtitle')}</p>
          </div>
        </div>
        <button type="button" onClick={openModal} className="workspace-secondary-action">
          <Plus size={16} aria-hidden="true" />
          {t('common.calendarAddEvent')}
        </button>
      </header>

      <div className="calendar-layout">
        <section className="calendar-panel calendar-month-panel min-w-0" aria-labelledby="calendar-month">
          <div className="calendar-panel-header">
            <h3 id="calendar-month" className="text-sm font-semibold capitalize" aria-live="polite">
              {currentDate.toLocaleDateString(currentLocale, { month: 'long', year: 'numeric' })}
            </h3>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={goToToday} className="workspace-secondary-action calendar-today">
                {t('common.calendarToday')}
              </button>
              <button type="button" onClick={() => changeMonth(-1)} className="calendar-icon-button" aria-label={t('common.calendarPrevMonth')}>
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => changeMonth(1)} className="calendar-icon-button" aria-label={t('common.calendarNextMonth')}>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="calendar-weekdays" aria-hidden="true">
            {dayNames.map(day => <span key={day}>{day}</span>)}
          </div>
          <div key={`${year}-${month}`} className={cn('calendar-grid', monthDirection < 0 ? 'ui-calendar-previous' : monthDirection > 0 ? 'ui-calendar-next' : 'ui-calendar-static')}>
            {calendarDays.map(date => {
              const dateStr = formatDate(date);
              const inMonth = date.getMonth() === month;
              const isToday = dateStr === todayKey;
              const isSelected = dateStr === selectedDate;
              const dayEvents = eventsByDate[dateStr] || [];
              const eventCount = t('common.calendarEventCount', { count: dayEvents.length });
              return (
                <button
                  type="button"
                  key={dateStr}
                  className="calendar-day"
                  data-outside={!inMonth || undefined}
                  aria-current={isToday ? 'date' : undefined}
                  aria-pressed={isSelected}
                  aria-label={`${fullDate.format(date)} · ${eventCount}`}
                  onClick={() => {
                    if (isSelected) return;
                    if (!inMonth) {
                      focusDate.current = dateStr;
                      setMonthDirection(date < new Date(year, month, 1) ? -1 : 1);
                      setCurrentDate(date);
                    }
                    setSelectedDate(dateStr);
                    playSfx('check');
                  }}
                  ref={element => {
                    if (element && focusDate.current === dateStr) {
                      focusDate.current = null;
                      element.focus({ preventScroll: true });
                    }
                  }}
                >
                  <span className="calendar-day-number">{date.getDate()}</span>
                  <span className="calendar-day-events" aria-hidden="true">
                    {dayEvents.slice(0, 2).map(event => (
                      <span key={event.id} className="calendar-event-preview">
                        <span className={cn('calendar-event-dot', event.color || EVENT_COLORS[0])} />
                        <span className="truncate">{event.title}</span>
                      </span>
                    ))}
                    {dayEvents.length > 2 && <span className="calendar-more">+{dayEvents.length - 2}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="calendar-panel calendar-agenda-panel min-w-0" aria-labelledby="calendar-selected-date">
          <div className="calendar-panel-header calendar-agenda-header">
            <div className="min-w-0">
              <p className="text-xs text-white/55">{t('common.calendarSelectedDay')}</p>
              <h3 id="calendar-selected-date" className="mt-1 text-sm font-semibold capitalize" aria-live="polite">{selectedDayLabel}</h3>
            </div>
          </div>
          <div className="calendar-agenda-content p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-1">
              <h4 className="text-sm font-semibold">{t('common.calendarEvents')}</h4>
              <span className="text-xs text-white/55">{t('common.calendarEventCount', { count: selectedDayEvents.length })}</span>
            </div>
            {selectedDayEvents.length === 0 ? (
              <div className="calendar-empty">
                <CalendarDays size={22} className="mx-auto mb-2 text-white/45" aria-hidden="true" />
                <p className="text-sm font-medium">{t('common.calendarNoEvents')}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/60">{t('common.calendarNoEventsDesc')}</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {selectedDayEvents.map(event => (
                  <li key={event.id} className="calendar-event">
                    <div className="flex items-start gap-2">
                      <span className={cn('calendar-event-dot mt-[7px]', event.color || EVENT_COLORS[0])} aria-hidden="true" />
                      <h5 className="min-w-0 flex-1 break-words text-sm font-medium">{event.title}</h5>
                      <button type="button" onClick={() => openEditModal(event)} className="calendar-icon-button" aria-label={t('common.edit')} title={t('common.edit')}>
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => deleteEvent(event.id)} className="calendar-icon-button calendar-danger" aria-label={t('common.delete')} title={t('common.delete')}>
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                    {(event.time || event.presentationName) && (
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/60">
                        {event.time && <span className="inline-flex items-center gap-1"><Clock size={13} aria-hidden="true" />{event.time}</span>}
                        {event.presentationName && <span className="inline-flex min-w-0 items-center gap-1" title={event.presentationName}><Presentation size={13} className="shrink-0" aria-hidden="true" /><span className="truncate">{event.presentationName}</span></span>}
                      </div>
                    )}
                    {event.description && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-white/65">{event.description}</p>}
                    {event.presentationName && onOpenPresentation && (
                      <button type="button" onClick={() => onOpenPresentation(event.presentationName!)} className="workspace-secondary-action mt-3">
                        <Presentation size={14} aria-hidden="true" />
                        {t('common.calendarOpenPresentation')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <Dialog open={isModalOpen} onClose={closeModal} labelledBy="calendar-event-title" className="calendar-dialog">
        <form onSubmit={event => { event.preventDefault(); if (editingEvent) updateEvent(); else addEvent(); }}>
          <div className="calendar-panel-header">
            <div>
              <h3 id="calendar-event-title" className="text-base font-semibold">
                {t(editingEvent ? 'common.calendarEditModalTitle' : 'common.calendarModalTitle')}
              </h3>
              <p className="mt-0.5 text-xs text-white/60">{selectedDayLabel}</p>
            </div>
            <button type="button" onClick={() => { closeModal(); playSfx('close'); }} className="calendar-icon-button" aria-label={t('common.close')}>
              <X size={17} aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-4 p-4">
            <label className="calendar-field">
              {t('common.calendarTitleLabel')}
              <input autoFocus required value={newEvent.title} onChange={e => setNewEvent(prev => ({ ...prev, title: e.target.value }))} placeholder={t('common.calendarTitlePlaceholder')} />
            </label>
            <label className="calendar-field">
              {t('common.calendarDescLabel')}
              <textarea rows={3} value={newEvent.description} onChange={e => setNewEvent(prev => ({ ...prev, description: e.target.value }))} placeholder={t('common.calendarDescPlaceholder')} />
            </label>
            <label className="calendar-field">
              {t('common.calendarTimeLabel')}
              <input type="time" value={newEvent.time} onChange={e => setNewEvent(prev => ({ ...prev, time: e.target.value }))} />
            </label>
            <fieldset>
              <legend className="mb-2 text-xs font-medium text-white/75">{t('common.calendarColorLabel')}</legend>
              <div className="flex gap-2">
                {EVENT_COLORS.map((color, index) => (
                  <button key={color} type="button" className={cn('calendar-swatch', color)}
                    aria-label={t(`common.calendarColors.${['blue', 'violet', 'green', 'orange', 'pink'][index]}`)} aria-pressed={newEvent.color === color}
                    onClick={() => setNewEvent(prev => ({ ...prev, color }))} />
                ))}
              </div>
            </fieldset>
            <label className="calendar-field">
              {t('common.calendarPresNameLabel')}
              <select value={newEvent.presentationName} onChange={e => setNewEvent(prev => ({ ...prev, presentationName: e.target.value }))}>
                <option value="">{t('common.calendarNoPresentation')}</option>
                {newEvent.presentationName && !savedPresentationNames.includes(newEvent.presentationName) && (
                  <option value={newEvent.presentationName}>{t('common.calendarMissingPresentation', { name: newEvent.presentationName })}</option>
                )}
                {savedPresentationNames.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
              <span className="font-normal text-white/55">{t('common.calendarPresHint')}</span>
            </label>
          </div>

          <div className="calendar-dialog-footer">
            <button type="button" onClick={() => { closeModal(); playSfx('close'); }} className="workspace-secondary-action">
              {t('common.calendarCancel')}
            </button>
            <button type="submit" disabled={!newEvent.title.trim()} className="calendar-primary">
              {t(editingEvent ? 'common.calendarUpdate' : 'common.calendarSave')}
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
