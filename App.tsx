
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { GoogleGenAI, FunctionDeclaration, Type, FunctionCall } from '@google/genai';
import {
  ChecklistItem,
  Reminder,
  Note,
  DateData,
  CalendarData,
  MonthlyChecklists,
  WeeklyChecklists,
  YearlyChecklists,
  YearlyNotes,
  WeeklyNotes,
  MonthlyNotes,
  Holiday,
  MainView,
  AppView,
  RecurringChecklistItem,
  RecurrenceRule,
  ChecklistRecurrenceRule,
  Alarm,
  Timer,
  NotebookPage
} from './types';
import { processNaturalLanguageCommand } from './services/geminiService';

// UTILITY FUNCTIONS
const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
const formatDate = (date: Date): string => date.toISOString().split('T')[0];

const getWeekDays = (d: Date): Date[] => {
    const date = new Date(d);
    const day = date.getDay(); // 0 for Sunday, 1 for Monday, etc.
    const diff = date.getDate() - day; // Go back to Sunday
    const startOfWeek = new Date(date.setDate(diff));
    return Array.from({ length: 7 }, (_, i) => {
        const dayInWeek = new Date(startOfWeek);
        dayInWeek.setDate(startOfWeek.getDate() + i);
        return dayInWeek;
    });
};
const getWeekNumber = (d: Date): number => {
    const startOfYear = new Date(d.getFullYear(), 0, 1);
    const pastDaysOfYear = (d.getTime() - startOfYear.getTime()) / 86400000;
    // Adjust for the first day of the year and calculate week number based on Sunday start
    return Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);
};
const formatMonthKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const formatWeekKey = (date: Date): string => {
    const startOfWeek = getWeekDays(date)[0];
    return formatDate(startOfWeek);
};
const formatTime12Hour = (time24: string): string => {
    if (!time24) return '';
    const [hours, minutes] = time24.split(':');
    const h = parseInt(hours, 10);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${minutes} ${suffix}`;
};
const formatTimer = (seconds: number): string => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
};
const formatStopwatch = (milliseconds: number): string => {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    const ms = (milliseconds % 1000).toString().padStart(3, '0').slice(0, 2);
    return `${h}:${m}:${s}.${ms}`;
};

const playBeep = () => {
    try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (!audioCtx) return;
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(440, audioCtx.currentTime); // A4 pitch
        gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
        console.error("Could not play sound:", e);
    }
};

const getCalculatedAndObservationalHolidays = (year: number): Holiday[] => {
    const formatDateForHoliday = (d: Date): string => d.toISOString().split('T')[0];

    // dayOfWeek: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const getNthDayOfMonth = (n: number, dayOfWeek: number, month: number, year: number): Date => {
        const date = new Date(Date.UTC(year, month, 1));
        // find first matching day
        while (date.getUTCDay() !== dayOfWeek) {
            date.setUTCDate(date.getUTCDate() + 1);
        }
        // add n-1 weeks
        date.setUTCDate(date.getUTCDate() + (n - 1) * 7);
        return date;
    };

    const getLastDayOfMonth = (dayOfWeek: number, month: number, year: number): Date => {
        const date = new Date(Date.UTC(year, month + 1, 0)); // Last day of the given month
        while(date.getUTCDay() !== dayOfWeek) {
            date.setUTCDate(date.getUTCDate() - 1);
        }
        return date;
    }

    // Easter calculation (Anonymous Gregorian algorithm)
    const getEaster = (year: number): Date => {
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31);
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(Date.UTC(year, month - 1, day));
    };

    const easterDate = getEaster(year);
    const goodFriday = new Date(easterDate);
    goodFriday.setUTCDate(easterDate.getUTCDate() - 2);

    const thanksgiving = getNthDayOfMonth(4, 4, 10, year); // 4th Thursday of November
    const blackFriday = new Date(thanksgiving);
    blackFriday.setUTCDate(thanksgiving.getUTCDate() + 1);
    
    return [
        { name: "Martin Luther King, Jr. Day", date: formatDateForHoliday(getNthDayOfMonth(3, 1, 0, year)) },
        { name: "Groundhog Day", date: `${year}-02-02` },
        { name: "Valentine's Day", date: `${year}-02-14` },
        { name: "Presidents Day", date: formatDateForHoliday(getNthDayOfMonth(3, 1, 1, year)) },
        { name: "St. Patrick's Day", date: `${year}-03-17` },
        { name: "April Fools' Day", date: `${year}-04-01` },
        { name: "Good Friday", date: formatDateForHoliday(goodFriday) },
        { name: "Easter Sunday", date: formatDateForHoliday(easterDate) },
        { name: "Earth Day", date: `${year}-04-22` },
        { name: "Cinco de Mayo", date: `${year}-05-05` },
        { name: "Mother's Day", date: formatDateForHoliday(getNthDayOfMonth(2, 0, 4, year)) },
        { name: "Memorial Day", date: formatDateForHoliday(getLastDayOfMonth(1, 4, year)) },
        { name: "Flag Day", date: `${year}-06-14` },
        { name: "Father's Day", date: formatDateForHoliday(getNthDayOfMonth(3, 0, 5, year)) },
        { name: "Labor Day", date: formatDateForHoliday(getNthDayOfMonth(1, 1, 8, year)) },
        { name: "Patriot Day", date: `${year}-09-11` },
        { name: "Indigenous Peoples' Day", date: formatDateForHoliday(getNthDayOfMonth(2, 1, 9, year)) },
        { name: "Halloween", date: `${year}-10-31` },
        { name: "Thanksgiving Day", date: formatDateForHoliday(thanksgiving) },
        { name: "Black Friday", date: formatDateForHoliday(blackFriday) },
        { name: "Christmas Eve", date: `${year}-12-24` },
        { name: "New Year's Eve", date: `${year}-12-31` },
    ];
};

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK_DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ICONS
const ChevronLeftIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>;
const ChevronRightIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>;
const PlusIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>;
const TrashIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" /></svg>;
const EditIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" /></svg>;
const AlarmIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const AiIcon = () => <span className="font-extrabold text-lg text-gray-200" style={{fontFamily: "'Inter', sans-serif"}}>AI</span>;
const PlayIcon = () => <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>;
const PauseIcon = () => <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 00-1 1v2a1 1 0 102 0V9a1 1 0 00-1-1zm5 0a1 1 0 00-1 1v2a1 1 0 102 0V9a1 1 0 00-1-1z" clipRule="evenodd" /></svg>;
const StopIcon = () => <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" /></svg>;
const XIcon = () => <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
const NotebookIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto" viewBox="0 0 20 20" fill="currentColor"><path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 16c1.255 0 2.443-.29 3.5-.804V4.804zM14.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 0114.5 16c1.255 0 2.443-.29 3.5-.804v-10A7.968 7.968 0 0014.5 4z" /></svg>;
const SidebarToggleIcon = ({ collapsed }: { collapsed: boolean }) => collapsed ?
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg> :
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>;


// FIX: Extracted Stopwatch into a self-contained component to prevent re-rendering the entire App on every frame.
// This resolves the UI freezing issue by isolating high-frequency state updates.
const Stopwatch: React.FC<{ aiAction: { action: string, timestamp: number } | null }> = ({ aiAction }) => {
    const [stopwatchTime, setStopwatchTime] = useState(0);
    const [stopwatchRunning, setStopwatchRunning] = useState(false);
    const [laps, setLaps] = useState<number[]>([]);
    const requestRef = useRef<number>();
    const startTimeRef = useRef<number>(0);

    const handleStopwatchStartStop = useCallback(() => {
        if (!stopwatchRunning) {
            startTimeRef.current = Date.now() - stopwatchTime;
        }
        setStopwatchRunning(prev => !prev);
    }, [stopwatchRunning, stopwatchTime]);

    const handleStopwatchLap = useCallback(() => {
        if (stopwatchRunning) {
            setLaps(prev => [stopwatchTime, ...prev]);
        }
    }, [stopwatchRunning, stopwatchTime]);

    const handleStopwatchReset = useCallback(() => {
        setStopwatchRunning(false);
        setStopwatchTime(0);
        setLaps([]);
    }, []);
    
    useEffect(() => {
        if (stopwatchRunning) {
            const tick = () => {
                setStopwatchTime(Date.now() - startTimeRef.current);
                requestRef.current = requestAnimationFrame(tick);
            };
            requestRef.current = requestAnimationFrame(tick);
        }
        return () => {
            if (requestRef.current) {
                cancelAnimationFrame(requestRef.current);
            }
        };
    }, [stopwatchRunning]);

    // This effect handles commands from the AI assistant.
    useEffect(() => {
        if (!aiAction) return;

        switch (aiAction.action) {
            case 'start':
                if (!stopwatchRunning) handleStopwatchStartStop();
                break;
            case 'stop':
                if (stopwatchRunning) handleStopwatchStartStop();
                break;
            case 'lap':
                handleStopwatchLap();
                break;
            case 'reset':
                handleStopwatchReset();
                break;
        }
        // This is intentionally not exhaustive to prevent re-triggering from user actions.
    }, [aiAction]);
    
    return (
        <div className="p-4 md:p-8 space-y-6 h-full overflow-y-auto custom-scrollbar flex flex-col items-center justify-center bg-gray-900/50">
            <div className="flex flex-col items-center w-full max-w-md">
                <h2 className="text-3xl font-bold text-gray-50 mb-8">Stopwatch</h2>
                
                <div className="p-6 mb-8 bg-gray-800 rounded-lg shadow-sm w-full">
                    <p className="text-6xl text-center font-mono font-bold text-gray-50">{formatStopwatch(stopwatchTime)}</p>
                </div>

                <div className="flex justify-center gap-4 w-full">
                    <button onClick={handleStopwatchStartStop} className={`px-6 py-3 w-28 text-lg rounded-md font-semibold text-white transition-colors ${stopwatchRunning ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}>{stopwatchRunning ? 'Stop' : 'Start'}</button>
                    <button onClick={handleStopwatchLap} disabled={!stopwatchRunning} className="px-6 py-3 w-28 text-lg rounded-md font-semibold text-white bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">Lap</button>
                    <button onClick={handleStopwatchReset} disabled={stopwatchTime === 0 && !stopwatchRunning} className="px-6 py-3 w-28 text-lg rounded-md font-semibold text-white bg-blue-500 hover:bg-blue-600 disabled:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">Reset</button>
                </div>
            </div>
            
            {laps.length > 0 && (
                <div className="p-4 mt-8 bg-gray-700/50 rounded-lg max-h-64 overflow-y-auto custom-scrollbar w-full max-w-md">
                    <ul className="space-y-2">
                        {laps.map((lap, index) => (
                            <li key={index} className="flex justify-between items-center text-sm font-mono p-2 bg-gray-700 rounded">
                                <span className="font-semibold text-gray-300">Lap {laps.length - index}</span>
                                <span className="text-gray-100">{formatStopwatch(lap)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

// Helper function to get all reminders for a given date, including recurring ones
const getRemindersForDate = (date: Date, calendarData: CalendarData): (Reminder & { originalDateKey?: string })[] => {
    const dateKey = formatDate(date);
    const dayData = calendarData[dateKey] || { reminders: [], note: null, checklist: [], completedRecurringItemIds: [] };
    const dailyReminders = dayData.reminders.map(r => ({ ...r, originalDateKey: dateKey }));

    const recurringReminders: (Reminder & { originalDateKey: string })[] = [];

    Object.entries(calendarData).forEach(([startDateKey, data]) => {
        data.reminders.forEach(reminder => {
            if (reminder.recurrence && reminder.recurrence.type !== 'none') {
                const startDate = new Date(`${startDateKey}T00:00:00`);
                if (date < startDate || startDateKey === dateKey) return;

                let shouldInclude = false;
                const { type, daysOfWeek, dayOfMonth, monthOfYear } = reminder.recurrence;
                switch (type) {
                    case 'daily': shouldInclude = true; break;
                    case 'weekly': if (daysOfWeek?.includes(date.getDay())) shouldInclude = true; break;
                    case 'monthly': if (date.getDate() === dayOfMonth) shouldInclude = true; break;
                    case 'yearly': if (date.getMonth() === monthOfYear && date.getDate() === dayOfMonth) shouldInclude = true; break;
                }
                if (shouldInclude) {
                    recurringReminders.push({ ...reminder, id: `${reminder.id}-recurring-${dateKey}`, originalDateKey: startDateKey });
                }
            }
        });
    });
    return [...dailyReminders, ...recurringReminders].sort((a, b) => a.time.localeCompare(b.time));
};

const getAlarmsForDate = (date: Date, alarms: Alarm[]): Alarm[] => {
    const dayOfWeek = date.getDay();
    const dateKey = formatDate(date);
    return alarms.filter(alarm => alarm.enabled && (alarm.days.includes(dayOfWeek) || alarm.targetDate === dateKey)).sort((a, b) => a.time.localeCompare(b.time));
};

// --- Child Components ---

const MonthDaySelector: React.FC<{ selectedDay: number; onDaySelect: (day: number) => void; maxDay?: number; }> = ({ selectedDay, onDaySelect, maxDay = 31 }) => { const days = Array.from({ length: maxDay }, (_, i) => i + 1); return ( <div className="grid grid-cols-7 gap-1 p-2 bg-gray-700/50 rounded-md"> {days.map(day => ( <button key={day} type="button" onClick={() => onDaySelect(day)} className={`flex items-center justify-center w-8 h-8 text-xs rounded-full ${selectedDay === day ? 'bg-blue-500 text-white' : 'bg-gray-700 text-gray-200 hover:bg-blue-900/40'}`} > {day} </button> ))} </div> ); };
const MonthSelector: React.FC<{ selectedMonth: number; onMonthSelect: (month: number) => void; }> = ({ selectedMonth, onMonthSelect }) => ( <div className="grid grid-cols-4 gap-2 p-2 bg-gray-700/50 rounded-md"> {MONTHS.map((month, index) => ( <button key={month} type="button" onClick={() => onMonthSelect(index)} className={`px-2 py-2 text-xs rounded-md ${selectedMonth === index ? 'bg-blue-500 text-white' : 'bg-gray-700 text-gray-200 hover:bg-blue-900/40'}`} > {month.substring(0, 3)} </button> ))} </div> );

interface ChecklistProps {
  title: string;
  items: (ChecklistItem & { isRecurring?: boolean })[];
  onAddItem: (text: string) => void;
  onToggleItem: (id: string) => void;
  onDeleteItem: (id: string) => void;
}
const Checklist: React.FC<ChecklistProps> = ({ title, items, onAddItem, onToggleItem, onDeleteItem }) => {
  const [newItemText, setNewItemText] = useState('');
  const handleAddItem = (e: React.FormEvent) => { e.preventDefault(); if (newItemText.trim()) { onAddItem(newItemText.trim()); setNewItemText(''); } };
  return (
    <div className="space-y-3"><h3 className="text-lg font-semibold text-gray-100">{title}</h3><form onSubmit={handleAddItem} className="flex gap-2"><input type="text" value={newItemText} onChange={(e) => setNewItemText(e.target.value)} placeholder="Add a new item..." className="flex-grow w-full px-3 py-2 text-sm bg-gray-700 text-gray-100 border border-transparent rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none" /><button type="submit" className="flex-shrink-0 p-2 text-white bg-blue-500 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"><PlusIcon /></button></form><ul className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">{items.map((item) => (<li key={item.id} className="flex items-center gap-2 group"><input type="checkbox" checked={item.completed} onChange={() => onToggleItem(item.id)} className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500" /><span className={`flex-grow text-sm ${item.completed ? 'line-through text-gray-400' : 'text-gray-300'}`}>{item.text}</span><button onClick={() => onDeleteItem(item.id)} className="text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500 disabled:opacity-0" disabled={item.isRecurring}><TrashIcon /></button></li>))}</ul></div>
  );
};

interface RemindersSectionProps { allRemindersForSelectedDate: (Reminder & { originalDateKey?: string })[]; handleReminderUpdate: (action: 'add' | 'toggle' | 'delete', payload: any) => void; selectedDateKey: string; }
const RemindersSection: React.FC<RemindersSectionProps> = ({ allRemindersForSelectedDate, handleReminderUpdate, selectedDateKey }) => { const [text, setText] = useState(''); const [time, setTime] = useState('12:00'); const [recurrence, setRecurrence] = useState<RecurrenceRule>({ type: 'none' }); const handleAdd = (e: React.FormEvent) => { e.preventDefault(); if (!text.trim()) return; let finalRecurrence = { ...recurrence }; if (finalRecurrence.type !== 'weekly') delete finalRecurrence.daysOfWeek; if (finalRecurrence.type !== 'monthly' && finalRecurrence.type !== 'yearly') delete finalRecurrence.dayOfMonth; if (finalRecurrence.type !== 'yearly') delete finalRecurrence.monthOfYear; if (finalRecurrence.type === 'weekly' && (!finalRecurrence.daysOfWeek || finalRecurrence.daysOfWeek.length === 0)) { alert('Please select at least one day for weekly recurrence.'); return; } handleReminderUpdate('add', { id: Date.now().toString(), text: text.trim(), time, completed: false, recurrence: finalRecurrence, completedDates: [] }); setText(''); setRecurrence({ type: 'none' }); }; const handleWeeklyDayToggle = (dayIndex: number) => { const currentDays = new Set(recurrence.daysOfWeek || []); if (currentDays.has(dayIndex)) { currentDays.delete(dayIndex); } else { currentDays.add(dayIndex); } setRecurrence(prev => ({ ...prev, daysOfWeek: Array.from(currentDays).sort() })); }; return ( <div className="space-y-3"> <h3 className="text-lg font-semibold text-gray-100">Reminders</h3> <form onSubmit={handleAdd} className="p-2 -m-2 space-y-3 border border-transparent focus-within:border-gray-700 focus-within:bg-gray-900/20 rounded-lg"> <div className="flex gap-2"> <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="New reminder..." className="flex-grow w-full px-3 py-2 text-sm bg-gray-700 text-gray-100 border border-transparent rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"/> <input type="time" value={time} onChange={e => setTime(e.target.value)} className="px-3 py-2 text-sm bg-gray-700 text-gray-100 border border-transparent rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"/> </div> <div className="flex gap-2 items-start"> <select value={recurrence.type} onChange={e => setRecurrence({ type: e.target.value as any, daysOfWeek: [], dayOfMonth: 1, monthOfYear: 0 })} className="flex-grow w-full px-3 py-2 text-sm bg-gray-700 text-gray-100 border border-transparent rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"> <option value="none">Does not repeat</option> <option value="daily">Daily</option> <option value="weekly">Weekly</option> <option value="monthly">Monthly</option> <option value="yearly">Yearly</option> </select> <button type="submit" className="flex-shrink-0 p-2 text-white bg-blue-500 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 mt-auto"><PlusIcon /></button> </div> {recurrence.type === 'weekly' && ( <div className="p-2 bg-gray-700/50 rounded-md"> <p className="text-xs font-medium text-gray-400 mb-2">Repeat on:</p> <div className="flex justify-around"> {WEEK_DAYS.map((day, index) => ( <button key={day} type="button" onClick={() => handleWeeklyDayToggle(index)} className={`w-8 h-8 text-xs rounded-full ${recurrence.daysOfWeek?.includes(index) ? 'bg-blue-500 text-white' : 'bg-gray-700 hover:bg-blue-900/40'}`}>{day.charAt(0)}</button>))} </div> </div> )} {recurrence.type === 'monthly' && ( <div className="space-y-2"> <p className="text-xs font-medium text-gray-400 px-2">Day of month:</p> <MonthDaySelector selectedDay={recurrence.dayOfMonth || 1} onDaySelect={day => setRecurrence(prev => ({...prev, dayOfMonth: day}))} /> </div> )} {recurrence.type === 'yearly' && ( <div className="space-y-2"> <p className="text-xs font-medium text-gray-400 px-2">Month:</p> <MonthSelector selectedMonth={recurrence.monthOfYear || 0} onMonthSelect={month => setRecurrence(prev => ({...prev, monthOfYear: month}))} /> <p className="text-xs font-medium text-gray-400 px-2">Day of month:</p> <MonthDaySelector selectedDay={recurrence.dayOfMonth || 1} onDaySelect={day => setRecurrence(prev => ({...prev, dayOfMonth: day}))} /> </div> )} </form> <ul className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar"> {allRemindersForSelectedDate.map(r => { const isRecurringInstance = r.id.includes('-recurring-'); const isCompleted = isRecurringInstance ? (r.completedDates || []).includes(selectedDateKey) : r.completed; return ( <li key={r.id} className="flex items-center gap-2 group"> <input type="checkbox" checked={isCompleted} onChange={() => handleReminderUpdate('toggle', r)} className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"/> <div className="flex-grow"> <span className={`text-sm ${isCompleted ? 'line-through text-gray-400' : 'text-gray-300'}`}>{r.text}</span> <span className="block text-xs text-gray-500">{formatTime12Hour(r.time)}</span> </div> {!isRecurringInstance && <button onClick={() => handleReminderUpdate('delete', r.id)} className="text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500"><TrashIcon/></button>} </li> ) })} </ul> </div> ); };

interface NoteSectionProps {
  note: Note | null;
  onUpdate: (content: string) => void;
  placeholder: string;
  noteKey: string;
}
const NoteSection: React.FC<NoteSectionProps> = ({ note, onUpdate, placeholder, noteKey }) => {
    const [content, setContent] = useState('');

    // FIX: Sync local state with prop ONLY when the key changes (i.e., user selects a new day/week/month).
    // This prevents parent re-renders from overwriting user input during typing.
    useEffect(() => {
        setContent(note?.content || '');
    }, [noteKey]);

    // FIX: Save content only on blur to prevent UI instability from rapid state updates.
    const handleBlur = () => {
        onUpdate(content);
    };
    
    return (<div className="space-y-3"><h3 className="text-lg font-semibold text-gray-100">Notes</h3><textarea value={content} onChange={e => setContent(e.target.value)} onBlur={handleBlur} placeholder={placeholder} className="w-full h-24 px-3 py-2 text-sm bg-gray-700 text-gray-100 border border-transparent rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none" /></div>);
};

interface RecurringChecklistProps {
  items: RecurringChecklistItem[];
  onAddItem: (text: string, recurrence: ChecklistRecurrenceRule) => void;
  onDeleteItem: (id: string) => void;
}
const RecurringChecklistSection: React.FC<RecurringChecklistProps> = ({ items, onAddItem, onDeleteItem }) => {
  const [text, setText] = useState('');
  const [recurrence, setRecurrence] = useState<ChecklistRecurrenceRule>({ type: 'daily' });

  const handleWeeklyDayToggle = (dayIndex: number) => {
    const currentDays = new Set(recurrence.daysOfWeek || []);
    if (currentDays.has(dayIndex)) {
      currentDays.delete(dayIndex);
    } else {
      currentDays.add(dayIndex);
    }
    setRecurrence(prev => ({ ...prev, daysOfWeek: Array.from(currentDays).sort() }));
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    
    let finalRule = { ...recurrence };
    if (finalRule.type !== 'weekly') delete finalRule.daysOfWeek;
    if (finalRule.type !== 'monthly' && finalRule.type !== 'yearly') delete finalRule.dayOfMonth;
    if (finalRule.type !== 'yearly') delete finalRule.monthOfYear;

    if (finalRule.type === 'weekly' && (!finalRule.daysOfWeek || finalRule.daysOfWeek.length === 0)) {
        alert('Please select at least one day for weekly recurrence.');
        return;
    }

    onAddItem(text.trim(), finalRule);
    setText('');
    setRecurrence({ type: 'daily' });
  };

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-gray-100">Recurring Checklist</h3>
      <form onSubmit={handleAdd} className="space-y-2">
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="New recurring item..."
          className="w-full px-3 py-2 text-sm bg-gray-700 text-gray-100 border border-transparent rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
        <div className="flex gap-2">
          <select
            value={recurrence.type}
            onChange={e => setRecurrence({ type: e.target.value as any, daysOfWeek: [], dayOfMonth: 1, monthOfYear: 0 })}
            className="flex-grow w-full px-3 py-2 text-sm bg-gray-700 text-gray-100 border border-transparent rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          <button type="submit" className="flex-shrink-0 p-2 text-white bg-blue-500 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
            <PlusIcon />
          </button>
        </div>
        {recurrence.type === 'weekly' && (
           <div className="p-2 bg-gray-700/50 rounded-md"> <p className="text-xs font-medium text-gray-400 mb-2">Repeat on:</p> <div className="flex justify-around"> {WEEK_DAYS.map((day, index) => ( <button key={day} type="button" onClick={() => handleWeeklyDayToggle(index)} className={`w-8 h-8 text-xs rounded-full ${recurrence.daysOfWeek?.includes(index) ? 'bg-blue-500 text-white' : 'bg-gray-700 hover:bg-blue-900/40'}`}>{day.charAt(0)}</button>))} </div> </div>
        )}
        {recurrence.type === 'monthly' && (
             <div className="space-y-2"> <p className="text-xs font-medium text-gray-400 px-2">Day of month:</p> <MonthDaySelector selectedDay={recurrence.dayOfMonth || 1} onDaySelect={day => setRecurrence(prev => ({...prev, dayOfMonth: day}))} /> </div>
        )}
        {recurrence.type === 'yearly' && (
            <div className="space-y-2"> <p className="text-xs font-medium text-gray-400 px-2">Month:</p> <MonthSelector selectedMonth={recurrence.monthOfYear || 0} onMonthSelect={month => setRecurrence(prev => ({...prev, monthOfYear: month}))} /> <p className="text-xs font-medium text-gray-400 px-2">Day of month:</p> <MonthDaySelector selectedDay={recurrence.dayOfMonth || 1} onDaySelect={day => setRecurrence(prev => ({...prev, dayOfMonth: day}))} /> </div>
        )}
      </form>
      <ul className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 p-2 bg-gray-700/50 rounded-md group">
            <span className="flex-grow text-sm text-gray-300">{item.text}</span>
            <span className="text-xs text-gray-400 capitalize">{item.recurrence.type}</span>
            <button onClick={() => onDeleteItem(item.id)} className="text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500">
              <TrashIcon />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

interface CalendarHeaderProps { mainView: MainView; currentDate: Date; selectedDate: Date; navigate: (offset: number) => void; setCurrentDate: (date: Date) => void; setSelectedDate: (date: Date) => void; setMainView: (view: MainView) => void; }
const CalendarHeader: React.FC<CalendarHeaderProps> = ({ mainView, currentDate, selectedDate, navigate, setCurrentDate, setSelectedDate, setMainView }) => { const title = useMemo(() => { switch (mainView) { case 'year': return currentDate.getFullYear(); case 'month': return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(currentDate); case 'week': const startOfWeek = getWeekDays(currentDate)[0]; const endOfWeek = getWeekDays(currentDate)[6]; return `${startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`; case 'day': return selectedDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); } }, [mainView, currentDate, selectedDate]); return (<header className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-2xl font-bold text-gray-50">{title}</h1><div className="flex items-center gap-4"><div className="flex items-center gap-1 p-1 bg-gray-700 rounded-lg">{(['day', 'week', 'month', 'year'] as MainView[]).map(view => (<button key={view} onClick={() => setMainView(view)} className={`px-3 py-1 text-sm font-semibold rounded-md capitalize ${mainView === view ? 'bg-gray-800 text-blue-400 shadow-sm' : 'text-gray-300 hover:bg-gray-600'}`}>{view}</button>)) }</div><div className="flex items-center gap-2"><button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-gray-700"><ChevronLeftIcon /></button><button onClick={() => { setCurrentDate(new Date()); setSelectedDate(new Date()); }} className="px-4 py-2 text-sm font-semibold border border-gray-600 rounded-md hover:bg-gray-700">Today</button><button onClick={() => navigate(1)} className="p-2 rounded-full hover:bg-gray-700"><ChevronRightIcon /></button></div></div></header>); };

interface ViewProps { currentDate: Date; selectedDate: Date; mainView: MainView; calendarData: CalendarData; alarms: Alarm[]; holidays: { [dateKey: string]: Holiday[] }; selectedDateKey: string; recurringChecklistItems: RecurringChecklistItem[]; handleDateClick: (date: Date) => void; handleMonthClick: (month: number) => void; }
const DayView: React.FC<Pick<ViewProps, 'selectedDate' | 'calendarData' | 'alarms' | 'holidays'>> = ({ selectedDate, calendarData, alarms, holidays }) => { const dayReminders = getRemindersForDate(selectedDate, calendarData); const dayAlarms = getAlarmsForDate(selectedDate, alarms); const dayHolidays = holidays[formatDate(selectedDate)] || []; const hours = Array.from({ length: 16 }, (_, i) => i + 7); const events = [...dayReminders.map(r => ({ ...r, type: 'reminder' as const })), ...dayAlarms.map(a => ({ ...a, id: a.id, text: a.label, type: 'alarm' as const})), ...dayHolidays.map(h => ({ ...h, time: 'all-day', type: 'holiday' as const }))].sort((a,b) => a.time.localeCompare(b.time)); return (<div className="min-h-full bg-gray-800"><div className="relative pl-16"><div className="absolute top-0 left-8 w-px h-full bg-gray-700"></div>{hours.map(hour => (<div key={hour} className="relative h-16"><div className="absolute -left-2 top-0 pr-4 text-xs text-right w-16 text-gray-500">{hour % 12 || 12} {hour < 12 || hour === 24 ? 'AM' : 'PM'}</div><div className="absolute top-0 left-8 w-full border-t border-gray-700"></div></div>))}{events.map((event, i) => { if (event.type === 'holiday') return <div key={`${event.name}-${i}`} className="absolute -top-1 left-16 right-0 p-2 text-sm font-semibold text-center bg-green-900/50 text-green-300 rounded-lg">{event.name}</div>; const [h, m] = event.time.split(':').map(Number); const top = (h - 7 + m / 60) * 4; const isAlarm = event.type === 'alarm'; return (<div key={event.id} style={{ top: `${top}rem` }} className={`absolute left-20 right-4 p-2 rounded-r-lg ${isAlarm ? 'bg-red-900/50 border-l-4 border-red-500' : 'bg-blue-900/50 border-l-4 border-blue-500'}`}><p className={`text-sm font-semibold ${isAlarm ? 'text-red-200' : 'text-blue-200'}`}>{event.text}</p><p className={`text-xs ${isAlarm ? 'text-red-400' : 'text-blue-400'}`}>{formatTime12Hour(event.time)}</p></div>); })}</div></div>); };
const WeekView: React.FC<Pick<ViewProps, 'currentDate' | 'calendarData' | 'alarms' | 'holidays' | 'handleDateClick' | 'recurringChecklistItems'>> = ({ currentDate, calendarData, alarms, holidays, handleDateClick, recurringChecklistItems }) => { const weekDates = getWeekDays(currentDate); return (<div className="flex flex-col h-full border-t border-gray-700"><div className="grid grid-cols-7 border-l border-gray-700 flex-shrink-0">{weekDates.map(day => (<div key={day.toISOString()} className="p-2 text-center font-semibold text-sm text-gray-300 border-r border-b border-gray-700">{day.toLocaleDateString('en-US', { weekday: 'short' })} <span className="text-gray-400">{day.getDate()}</span></div>))}</div><div className="grid grid-cols-7 flex-grow border-l border-gray-700 h-0">{weekDates.map(day => { const dayKey = formatDate(day); const dayData = calendarData[dayKey]; const dayReminders = getRemindersForDate(day, calendarData); const dayAlarms = getAlarmsForDate(day, alarms); const dayHolidays = holidays[dayKey] || []; const dayNote = dayData?.note; const completedIds = new Set(dayData?.completedRecurringItemIds || []); const dayRecurringItems = recurringChecklistItems.filter(item => { const { type, daysOfWeek, dayOfMonth, monthOfYear } = item.recurrence; if (type === 'daily') return true; if (type === 'weekly' && daysOfWeek?.includes(day.getDay())) return true; if (type === 'monthly' && dayOfMonth === day.getDate()) return true; if (type === 'yearly' && monthOfYear === day.getMonth() && dayOfMonth === day.getDate()) return true; return false; }); const dailyCombinedChecklistItems = [...(dayRecurringItems.map(item => ({ ...item, completed: completedIds.has(item.id), isRecurring: true }))), ...((dayData?.checklist || []).map(item => ({...item, isRecurring: false })))]; return (<div key={day.toISOString()} onClick={() => handleDateClick(day)} className="relative flex flex-col border-r border-gray-700 cursor-pointer hover:bg-blue-900/20"><div className="flex-grow overflow-y-auto p-2 space-y-2 custom-scrollbar">{dayHolidays.map(h => (<div key={h.name} className="p-1 text-xs text-center bg-green-900/50 text-green-300 rounded-md">{h.name}</div>))}{dayAlarms.map(a => (<div key={a.id} className="p-1 text-xs text-white bg-red-500 rounded-md"><p className="font-semibold truncate flex items-center gap-1"><AlarmIcon/>{a.label}</p><p>{formatTime12Hour(a.time)}</p></div>))}{dayReminders.map(r => (<div key={r.id} className="p-1 text-xs text-white bg-blue-500 rounded-md"><p className="font-semibold truncate">{r.text}</p><p>{formatTime12Hour(r.time)}</p></div>))}{dayNote?.content && (<div><h4 className="text-xs font-bold text-gray-400 mt-2">Note</h4><p className="text-xs text-gray-300 bg-gray-700/50 p-1 rounded whitespace-pre-wrap break-words">{dayNote.content}</p></div>)}{dailyCombinedChecklistItems.length > 0 && (<div><h4 className="text-xs font-bold text-gray-400 mt-2">Checklist</h4><ul className="space-y-1">{dailyCombinedChecklistItems.map(item => (<li key={item.id} className="flex items-center gap-1.5"><input type="checkbox" checked={item.completed} readOnly className="w-3 h-3 text-blue-600 bg-gray-600 border-gray-500 rounded focus:ring-blue-500 pointer-events-none" /><span className={`text-xs ${item.completed ? 'line-through text-gray-500' : 'text-gray-300'}`}>{item.text}</span></li>))}</ul></div>)}</div></div>); })}</div></div>); };
const YearView: React.FC<Pick<ViewProps, 'currentDate' | 'holidays' | 'handleDateClick' | 'handleMonthClick'>> = ({ currentDate, holidays, handleDateClick, handleMonthClick }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
    {Array.from({ length: 12 }).map((_, monthIndex) => {
      const monthName = MONTHS[monthIndex];
      const daysInMonth = getDaysInMonth(currentDate.getFullYear(), monthIndex);
      const firstDay = getFirstDayOfMonth(currentDate.getFullYear(), monthIndex);
      const grid = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
      return (
        <div key={monthIndex}>
          <h3 className="text-lg font-semibold text-center mb-2 cursor-pointer hover:text-blue-400" onClick={() => handleMonthClick(monthIndex)}>{monthName}</h3>
          <div className="grid grid-cols-7 gap-px text-center text-xs text-gray-400">
            <div>S</div><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div>
            {grid.map((day, dayIndex) => {
              const date = day ? new Date(currentDate.getFullYear(), monthIndex, day) : null;
              const dateKey = date ? formatDate(date) : '';
              const isToday = dateKey === formatDate(new Date());
              const hasHoliday = date && holidays[dateKey] && holidays[dateKey].length > 0;
              return (
                <div key={dayIndex} onClick={() => date && handleDateClick(date)} className={`relative p-1 rounded-full ${date ? 'cursor-pointer' : ''} ${isToday ? 'bg-blue-500 text-white' : date ? 'hover:bg-gray-700' : ''}`}>
                  {day}
                  {hasHoliday && <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-green-500 rounded-full"></div>}
                </div>
              );
            })}
          </div>
        </div>
      );
    })}
  </div>
);
const MonthView: React.FC<ViewProps> = ({ currentDate, selectedDate, mainView, calendarData, holidays, selectedDateKey, handleDateClick }) => { const year = currentDate.getFullYear(); const month = currentDate.getMonth(); const calendarGrid = useMemo(() => { const daysInMonth = getDaysInMonth(year, month); const firstDay = getFirstDayOfMonth(year, month); const grid = []; for (let i = 0; i < firstDay; i++) { grid.push(null); } for (let i = 1; i <= daysInMonth; i++) { grid.push(new Date(year, month, i)); } return grid; }, [year, month]); return (<div className="grid grid-cols-7 gap-px text-xs font-semibold text-center text-gray-400 bg-gray-700 border border-gray-700">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (<div key={day} className="py-2 bg-gray-800">{day}</div>))}{calendarGrid.map((day, index) => { if (!day) return <div key={index} className="bg-gray-800/50"></div>; const dayKey = formatDate(day); const isToday = dayKey === formatDate(new Date()); const isSelected = dayKey === selectedDateKey; const dayReminders = getRemindersForDate(day, calendarData); const dayHolidays = holidays[dayKey] || []; const hasData = dayReminders.length > 0 || (calendarData[dayKey] && (calendarData[dayKey].checklist.length > 0 || calendarData[dayKey].note)); return (<div key={index} className={`relative flex flex-col p-2 bg-gray-800 h-24 md:h-32 lg:h-40 overflow-hidden ${day ? 'cursor-pointer hover:bg-blue-900/20' : ''}`} onClick={() => handleDateClick(day)}><span className={`self-end w-7 h-7 flex items-center justify-center rounded-full text-sm ${isToday ? 'bg-blue-500 text-white' : ''} ${isSelected && mainView === 'day' ? 'ring-2 ring-blue-500' : ''}`}>{day.getDate()}</span>{hasData && <div className="absolute w-1.5 h-1.5 bg-blue-500 rounded-full top-2 left-2"></div>}<div className="mt-1 space-y-1 overflow-hidden">{dayHolidays.map(h => (<div key={h.name} className="px-1 py-0.5 text-xs bg-green-900/50 text-green-300 rounded-sm truncate">{h.name}</div>))}{dayReminders.slice(0, 2).map(r => (<div key={r.id} className="px-1 py-0.5 text-xs text-white bg-blue-400 rounded-sm truncate">{r.text}</div>))}</div></div>); })}</div>); };

// --- Main App Component ---

const App: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [mainView, setMainView] = useState<MainView>('month');
  const [appView, setAppView] = useState<AppView>('calendar');
  const [sidebarContent, setSidebarContent] = useState<MainView | 'recurring'>('month');
  const [calendarData, setCalendarData] = useState<CalendarData>({});
  const [monthlyChecklists, setMonthlyChecklists] = useState<MonthlyChecklists>({});
  const [weeklyChecklists, setWeeklyChecklists] = useState<WeeklyChecklists>({});
  const [yearlyChecklists, setYearlyChecklists] = useState<YearlyChecklists>({});
  const [recurringChecklistItems, setRecurringChecklistItems] = useState<RecurringChecklistItem[]>([]);
  const [weeklyNotes, setWeeklyNotes] = useState<WeeklyNotes>({});
  const [monthlyNotes, setMonthlyNotes] = useState<MonthlyNotes>({});
  const [yearlyNotes, setYearlyNotes] = useState<YearlyNotes>({});
  const [holidays, setHolidays] = useState<{ [dateKey: string]: Holiday[] }>({});
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [timers, setTimers] = useState<Timer[]>([]);
  const [notebookPages, setNotebookPages] = useState<NotebookPage[]>([]);
  const [activeNotebookPageId, setActiveNotebookPageId] = useState<string | null>(null);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(Notification.permission);
  const beepIntervalRef = useRef<number | null>(null);
  const [ringingAlarms, setRingingAlarms] = useState<Set<string>>(new Set());
  const [ringingTimers, setRingingTimers] = useState<Set<string>>(new Set());
  const [aiStopwatchAction, setAiStopwatchAction] = useState<{ action: string, timestamp: number } | null>(null);
  
  const startLoopingBeep = useCallback(() => { if (beepIntervalRef.current) clearInterval(beepIntervalRef.current); beepIntervalRef.current = window.setInterval(playBeep, 1200); }, []);
  const stopLoopingBeep = useCallback(() => { if (beepIntervalRef.current) { clearInterval(beepIntervalRef.current); beepIntervalRef.current = null; } }, []);
  
  useEffect(() => {
    const isRinging = ringingAlarms.size > 0 || ringingTimers.size > 0;
    if (isRinging && !beepIntervalRef.current) {
        startLoopingBeep();
    } else if (!isRinging && beepIntervalRef.current) {
        stopLoopingBeep();
    }
  }, [ringingAlarms, ringingTimers, startLoopingBeep, stopLoopingBeep]);
  
  const handleRequestNotification = () => { if ('Notification' in window && Notification.permission !== 'granted') { Notification.requestPermission().then(setNotificationPermission); } };
  useEffect(handleRequestNotification, []);
  
  useEffect(() => { const interval = setInterval(() => { if (notificationPermission !== 'granted') return; const now = new Date(); const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`; const remindersForToday = getRemindersForDate(now, calendarData); remindersForToday.forEach(reminder => { const isCompleted = reminder.recurrence.type !== 'none' ? (reminder.completedDates || []).includes(formatDate(now)) : reminder.completed; if (reminder.time === currentTime && !isCompleted) { new Notification('Calendar Reminder', { body: reminder.text, icon: '/favicon.ico' }); } }); }, 30000); return () => clearInterval(interval); }, [notificationPermission, calendarData]);
  
  useEffect(() => {
    const alarmInterval = setInterval(() => {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const todayKey = formatDate(now);
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      
      const alarmsToRing: string[] = [];
      const alarmsToDisable: string[] = [];

      alarms.forEach(alarm => {
        if (!alarm.enabled || ringingAlarms.has(alarm.id)) return;
        
        const isRepeating = alarm.days.length > 0 && alarm.days.includes(dayOfWeek);
        const isOneTime = alarm.isOneTime && alarm.targetDate === todayKey;

        if ((isRepeating || isOneTime) && alarm.time === currentTime) {
          new Notification('Alarm', { body: alarm.label, requireInteraction: true });
          alarmsToRing.push(alarm.id);
          if(isOneTime) {
            alarmsToDisable.push(alarm.id);
          }
        }
      });
      
      if(alarmsToRing.length > 0) {
        setRingingAlarms(prev => new Set([...prev, ...alarmsToRing]));
      }
      if(alarmsToDisable.length > 0) {
        setAlarms(prev => prev.map(a => alarmsToDisable.includes(a.id) ? { ...a, enabled: false } : a));
      }

    }, 1000 * 30); // Check every 30 seconds
    return () => clearInterval(alarmInterval);
  }, [alarms, ringingAlarms]);

  useEffect(() => {
    const activeTimers = timers.filter(t => t.status === 'running');
    if (activeTimers.length === 0) return;

    const timerInterval = setInterval(() => {
        setTimers(prevTimers => prevTimers.map(timer => {
            if (timer.status === 'running' && timer.timeLeft > 0) {
                return { ...timer, timeLeft: timer.timeLeft - 1 };
            } else if (timer.status === 'running' && timer.timeLeft <= 0) {
                new Notification('Timer Finished!', { body: timer.label, requireInteraction: true });
                setRingingTimers(prev => new Set(prev).add(timer.id));
                return { ...timer, status: 'stopped', timeLeft: 0 };
            }
            return timer;
        }));
    }, 1000);

    return () => clearInterval(timerInterval);
  }, [timers]);

  useEffect(() => {
    if (appView === 'notebook') {
      if (notebookPages.length === 0) {
        const newPage: NotebookPage = {
          id: Date.now().toString(),
          title: 'My First Note',
          content: 'Welcome to your notebook! You can create, edit, and delete pages.',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setNotebookPages([newPage]);
        setActiveNotebookPageId(newPage.id);
      } else if (!activeNotebookPageId || !notebookPages.some(p => p.id === activeNotebookPageId)) {
        setActiveNotebookPageId(notebookPages[0]?.id || null);
      }
    }
  }, [appView, notebookPages, activeNotebookPageId]);
  
  const yearForHolidays = useMemo(() => currentDate.getFullYear(), [currentDate]);
  useEffect(() => {
    const fetchHolidays = async () => {
        const fallbackHolidays = () => {
            const holidayData: { [dateKey: string]: Holiday[] } = {};
            const additional = getCalculatedAndObservationalHolidays(yearForHolidays);
            additional.forEach(h => {
                if (!holidayData[h.date]) holidayData[h.date] = [];
                holidayData[h.date].push(h);
            });
            setHolidays(holidayData);
        };

        try {
            const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${yearForHolidays}/US`);
            if (!response.ok) {
                throw new Error(`Holiday API request failed with status ${response.status}.`);
            }
            const data: { date: string; name: string }[] = await response.json();
            const holidayData: { [dateKey: string]: Holiday[] } = {};

            data.forEach((item) => {
                const dateKey = item.date;
                if (!holidayData[dateKey]) holidayData[dateKey] = [];
                holidayData[dateKey].push({ name: item.name, date: dateKey });
            });

            const additional = getCalculatedAndObservationalHolidays(yearForHolidays);
            additional.forEach(h => {
                if (!holidayData[h.date]) holidayData[h.date] = [];
                if (!holidayData[h.date].some(existing => existing.name === h.name)) {
                    holidayData[h.date].push(h);
                }
            });

            setHolidays(holidayData);
        } catch (error) {
            console.error("Error fetching holidays:", error);
            alert("Could not fetch holidays. Please check your network connection. Showing a limited set of holidays.");
            fallbackHolidays();
        }
    };
    fetchHolidays();
  }, [yearForHolidays]);

  const selectedDateKey = useMemo(() => formatDate(selectedDate), [selectedDate]);
  const currentMonthKey = useMemo(() => formatMonthKey(selectedDate), [selectedDate]);
  const currentWeekKey = useMemo(() => formatWeekKey(selectedDate), [selectedDate]);
  const currentYearKey = useMemo(() => selectedDate.getFullYear().toString(), [selectedDate]);

  const selectedDateData = useMemo(() => calendarData[selectedDateKey] || { reminders: [], note: null, checklist: [], completedRecurringItemIds: [] }, [calendarData, selectedDateKey]);
  const currentMonthChecklist = useMemo(() => monthlyChecklists[currentMonthKey] || [], [monthlyChecklists, currentMonthKey]);
  const currentWeekChecklist = useMemo(() => weeklyChecklists[currentWeekKey] || [], [weeklyChecklists, currentWeekKey]);
  const currentYearChecklist = useMemo(() => yearlyChecklists[currentYearKey] || [], [yearlyChecklists, currentYearKey]);
  const currentWeekNote = useMemo(() => weeklyNotes[currentWeekKey] || null, [weeklyNotes, currentWeekKey]);
  const currentMonthNote = useMemo(() => monthlyNotes[currentMonthKey] || null, [monthlyNotes, currentMonthKey]);
  const currentYearNote = useMemo(() => yearlyNotes[currentYearKey] || null, [yearlyNotes, currentYearKey]);
  const allRemindersForSelectedDate = useMemo(() => getRemindersForDate(selectedDate, calendarData), [selectedDate, calendarData]);
  
  const dailyCombinedChecklistItems = useMemo(() => {
    const completedIds = new Set(selectedDateData.completedRecurringItemIds || []);
    const todaysRecurringItems = recurringChecklistItems.filter(item => {
        const { type, daysOfWeek, dayOfMonth, monthOfYear } = item.recurrence;
        if (type === 'daily') return true;
        if (type === 'weekly' && daysOfWeek?.includes(selectedDate.getDay())) return true;
        if (type === 'monthly' && dayOfMonth === selectedDate.getDate()) return true;
        if (type === 'yearly' && monthOfYear === selectedDate.getMonth() && dayOfMonth === selectedDate.getDate()) return true;
        return false;
    });
    const recurringItems = todaysRecurringItems.map(item => ({ ...item, completed: completedIds.has(item.id), isRecurring: true }));
    const dailyItems = selectedDateData.checklist.map(item => ({...item, isRecurring: false }));
    return [...recurringItems, ...dailyItems];
  }, [recurringChecklistItems, selectedDateData, selectedDate]);
  
  const handleAiCommand = async (command: string) => {
    try {
        const result = await processNaturalLanguageCommand(command);
        if (Array.isArray(result)) { // Handle multiple function calls
            for (const call of result) {
                handleFunctionCall(call);
            }
        } else if ('name' in result) { // Handle single function call
            handleFunctionCall(result as FunctionCall);
        } else if ('text' in result) {
            alert(`AI Assistant: ${result.text}`);
        }
    } catch (error) {
        alert((error as Error).message);
    }
  };

  const handleFunctionCall = (call: FunctionCall) => {
    const { name, args } = call;
    switch (name) {
        case 'addReminder': {
            const { date, time, description } = args as { date: string, time: string, description: string };
            if (date && time && description) {
                const newReminder: Reminder = { id: Date.now().toString(), text: description, time, completed: false, recurrence: { type: 'none' } };
                setCalendarData(prev => {
                    const prevDateData = prev[date] || { reminders: [], note: null, checklist: [], completedRecurringItemIds: [] };
                    return { ...prev, [date]: { ...prevDateData, reminders: [...prevDateData.reminders, newReminder] } };
                });
                const newSelectedDate = new Date(`${date}T00:00:00`);
                setCurrentDate(newSelectedDate);
                setSelectedDate(newSelectedDate);
                setAppView('calendar');
                setMainView('day');
            }
            break;
        }
        case 'addAlarm': {
            const { time, label, repeat, days } = args as { time: string, label?: string, repeat: boolean, days?: number[] };
            if (time) {
                let targetDate = null;
                if (!repeat) {
                    const now = new Date();
                    const [alarmHours, alarmMinutes] = time.split(':').map(Number);
                    const alarmTimeToday = new Date().setHours(alarmHours, alarmMinutes, 0, 0);
                    if (alarmTimeToday <= now.getTime()) {
                        now.setDate(now.getDate() + 1); // If time has passed today, set for tomorrow
                    }
                    targetDate = formatDate(now);
                }
                const newAlarm: Alarm = { id: Date.now().toString(), time, label: label?.trim() || 'New Alarm', days: repeat ? (days || []) : [], enabled: true, isOneTime: !repeat, targetDate };
                setAlarms(prev => [...prev, newAlarm]);
                setAppView('alarms');
            }
            break;
        }
        case 'addTimer': {
            const { hours, minutes, seconds, label } = args as { hours: number, minutes: number, seconds: number, label?: string };
            const duration = (hours * 3600) + (minutes * 60) + seconds;
            if (duration > 0) {
                const newTimer: Timer = { id: Date.now().toString(), label: label?.trim() || `Timer`, initialDuration: duration, timeLeft: duration, status: 'running' };
                setTimers(prev => [...prev, newTimer]);
                setAppView('timers');
            }
            break;
        }
        case 'controlStopwatch': {
            const { action } = args as { action: 'start' | 'stop' | 'lap' | 'reset' };
            setAppView('stopwatch');
            setAiStopwatchAction({ action, timestamp: Date.now() });
            break;
        }
    }
};

  
  const updateData = useCallback(<T,>(setter: React.Dispatch<React.SetStateAction<T>>, key: string, updater: (prev: any) => any) => { setter(prev => ({ ...prev, [key]: updater((prev as any)[key] || []) })); }, []);
  const createChecklistHandlers = (key: string, setter: React.Dispatch<React.SetStateAction<any>>) => ({ onAddItem: (text: string) => updateData(setter, key, (prev: ChecklistItem[]) => [...prev, { id: Date.now().toString(), text, completed: false }]), onToggleItem: (id: string) => updateData(setter, key, (prev: ChecklistItem[]) => prev.map(item => item.id === id ? { ...item, completed: !item.completed } : item)), onDeleteItem: (id: string) => updateData(setter, key, (prev: ChecklistItem[]) => prev.filter(item => item.id !== id)), });
  const weeklyChecklistHandlers = createChecklistHandlers(currentWeekKey, setWeeklyChecklists);
  const monthlyChecklistHandlers = createChecklistHandlers(currentMonthKey, setMonthlyChecklists);
  const yearlyChecklistHandlers = createChecklistHandlers(currentYearKey, setYearlyChecklists);
  const recurringChecklistHandlers = {
    onAddItem: (text: string, recurrence: ChecklistRecurrenceRule) => {
        const newItem: RecurringChecklistItem = {
            id: Date.now().toString(),
            text,
            completed: false,
            recurrence,
        };
        setRecurringChecklistItems(prev => [...prev, newItem]);
    },
    onDeleteItem: (id: string) => {
        setRecurringChecklistItems(prev => prev.filter(item => item.id !== id));
    },
  };

  const handleDailyChecklistUpdate = (action: 'add' | 'toggle' | 'delete', payload: any) => {
    const item = dailyCombinedChecklistItems.find(i => i.id === payload);
    if (action === 'toggle') {
        if (item?.isRecurring) {
            setCalendarData(prev => {
                const data = prev[selectedDateKey] || { reminders: [], note: null, checklist: [], completedRecurringItemIds: [] };
                const completed = new Set(data.completedRecurringItemIds);
                completed.has(payload) ? completed.delete(payload) : completed.add(payload);
                return { ...prev, [selectedDateKey]: { ...data, completedRecurringItemIds: Array.from(completed) } };
            });
        } else {
            setCalendarData(prev => {
                const data = prev[selectedDateKey] || { reminders: [], note: null, checklist: [], completedRecurringItemIds: [] };
                const newChecklist = data.checklist.map(i => i.id === payload ? {...i, completed: !i.completed} : i);
                return { ...prev, [selectedDateKey]: { ...data, checklist: newChecklist }};
            });
        }
    } else if (action === 'add') {
        setCalendarData(prev => {
            const data = prev[selectedDateKey] || { reminders: [], note: null, checklist: [], completedRecurringItemIds: [] };
            const newChecklist = [...data.checklist, { id: Date.now().toString(), text: payload, completed: false }];
            return { ...prev, [selectedDateKey]: { ...data, checklist: newChecklist }};
        });
    } else if (action === 'delete') {
        if (item && !item.isRecurring) { // Only allow deleting non-recurring items from daily view
            setCalendarData(prev => {
                const data = prev[selectedDateKey] || { reminders: [], note: null, checklist: [], completedRecurringItemIds: [] };
                const newChecklist = data.checklist.filter(i => i.id !== payload);
                return { ...prev, [selectedDateKey]: { ...data, checklist: newChecklist }};
            });
        }
    }
  };

  const handleReminderUpdate = (action: 'add' | 'toggle' | 'delete', payload: any) => { if (action === 'toggle') { const { id, originalDateKey } = payload; const isRecurring = id.includes('-recurring-'); const originalId = isRecurring ? id.split('-recurring-')[0] : id; setCalendarData(prev => { const sourceDateKey = isRecurring ? originalDateKey : selectedDateKey; const dateData = prev[sourceDateKey]; if (!dateData) return prev; const newReminders = dateData.reminders.map(r => { if (r.id === originalId) { if (isRecurring) { const completedDates = r.completedDates || []; const isCompleted = completedDates.includes(selectedDateKey); return { ...r, completedDates: isCompleted ? completedDates.filter(d => d !== selectedDateKey) : [...completedDates, selectedDateKey] }; } else { return { ...r, completed: !r.completed }; } } return r; }); return { ...prev, [sourceDateKey]: { ...dateData, reminders: newReminders }}; }); return; } setCalendarData(prev => { const prevDateData = prev[selectedDateKey] || { reminders: [], note: null, checklist: [], completedRecurringItemIds: [] }; let newReminders: Reminder[]; switch(action) { case 'add': newReminders = [...prevDateData.reminders, payload]; break; case 'delete': newReminders = prevDateData.reminders.filter(r => r.id !== payload); break; default: newReminders = prevDateData.reminders; } return { ...prev, [selectedDateKey]: { ...prevDateData, reminders: newReminders } }; }); };
  const handleNoteUpdate = useCallback((content: string) => { setCalendarData(prev => { const prevDateData = prev[selectedDateKey] || { reminders: [], note: null, checklist: [], completedRecurringItemIds: [] }; const noteId = prevDateData.note?.id || `note-${selectedDateKey}`; return { ...prev, [selectedDateKey]: { ...prevDateData, note: { id: noteId, content } } }; }); }, [selectedDateKey]);
  const handleWeeklyNoteUpdate = useCallback((content: string) => { setWeeklyNotes(prev => { const prevNote = prev[currentWeekKey]; const noteId = prevNote?.id || `note-${currentWeekKey}`; return { ...prev, [currentWeekKey]: { id: noteId, content }}; }); }, [currentWeekKey]);
  const handleMonthlyNoteUpdate = useCallback((content: string) => { setMonthlyNotes(prev => { const prevNote = prev[currentMonthKey]; const noteId = prevNote?.id || `note-${currentMonthKey}`; return { ...prev, [currentMonthKey]: { id: noteId, content }}; }); }, [currentMonthKey]);
  const handleYearlyNoteUpdate = useCallback((content: string) => { setYearlyNotes(prev => { const prevNote = prev[currentYearKey]; const noteId = prevNote?.id || `note-${currentYearKey}`; return { ...prev, [currentYearKey]: { id: noteId, content }}; }); }, [currentYearKey]);

  const handleUpdateAlarm = (updatedAlarm: Alarm) => {
    setAlarms(prev => prev.map(a => a.id === updatedAlarm.id ? updatedAlarm : a));
  };
  
  const handleAddNotebookPage = () => {
    const now = new Date().toISOString();
    const newPage: NotebookPage = {
      id: Date.now().toString(),
      title: 'Untitled Page',
      content: '',
      createdAt: now,
      updatedAt: now,
    };
    setNotebookPages(prev => [newPage, ...prev]);
    setActiveNotebookPageId(newPage.id);
  };

  const handleUpdateNotebookPage = useCallback((id: string, updates: { title?: string; content?: string }) => {
    setNotebookPages(prev => prev.map(page =>
      page.id === id
        ? { ...page, ...updates, updatedAt: new Date().toISOString() }
        : page
    ));
  }, []);

  const handleDeleteNotebookPage = (id: string) => {
    const pageIndex = notebookPages.findIndex(p => p.id === id);
    if (pageIndex === -1) return;

    if (id === activeNotebookPageId) {
      const newPages = notebookPages.filter(p => p.id !== id);
      if (newPages.length === 0) {
        setActiveNotebookPageId(null);
      } else {
        const nextIndex = Math.max(0, pageIndex - 1);
        setActiveNotebookPageId(newPages[nextIndex].id);
      }
    }
    setNotebookPages(prev => prev.filter(p => p.id !== id));
  };


  const navigate = useCallback((offset: number) => {
    const newDate = new Date(currentDate);
    switch (mainView) {
      case 'day':
        newDate.setDate(newDate.getDate() + offset);
        break;
      case 'week':
        newDate.setDate(newDate.getDate() + offset * 7);
        break;
      case 'month':
        const currentDay = newDate.getDate();
        newDate.setMonth(newDate.getMonth() + offset, 1);
        const daysInNewMonth = getDaysInMonth(newDate.getFullYear(), newDate.getMonth());
        newDate.setDate(Math.min(currentDay, daysInNewMonth));
        break;
      case 'year':
        newDate.setFullYear(newDate.getFullYear() + offset);
        break;
    }
    setCurrentDate(newDate);
    setSelectedDate(newDate); // Always sync selected date with navigation
  }, [currentDate, mainView]);

  const handleDateClick = useCallback((date: Date) => { setSelectedDate(date); setMainView('day'); setSidebarContent('day'); }, []);
  const handleMonthClick = useCallback((month: number) => { const newDate = new Date(currentDate.getFullYear(), month, 1); setCurrentDate(newDate); setSelectedDate(newDate); setMainView('month'); setSidebarContent('month'); }, [currentDate]);
  
  const handleSetMainView = useCallback((view: MainView) => {
    if (view !== mainView) {
      setCurrentDate(new Date(selectedDate));
      setMainView(view);
    }
  }, [selectedDate, mainView]);

  const handleSidebarTabClick = (view: MainView | 'recurring') => { setSidebarContent(view); };
  
  const TopBar: React.FC = () => (
    <div className="flex items-center justify-between p-4 bg-gray-800 border-b border-gray-700">
        <div className="flex-1 flex justify-start">
             <button onClick={() => setIsAiModalOpen(true)} className="p-2 rounded-full hover:bg-gray-700"><AiIcon/></button>
        </div>
        <div className="flex-1 flex items-center justify-center gap-2 md:gap-4">
            {(['calendar', 'alarms', 'timers', 'stopwatch', 'notebook'] as AppView[]).map(view => (
            <button key={view} onClick={() => setAppView(view)} className={`px-4 py-2 text-sm font-semibold rounded-lg capitalize ${appView === view ? 'bg-blue-900/50 text-blue-400' : 'text-gray-300 hover:bg-gray-700'}`}>
                {view}
            </button>
            ))}
        </div>
        <div className="flex-1 flex justify-end">
            {/* Theme toggle removed */}
        </div>
    </div>
  );

  const AiModal: React.FC<{onClose: () => void; onCommand: (command: string) => Promise<void>;}> = ({ onClose, onCommand }) => {
    const [command, setCommand] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const handleSubmit = async (e: React.FormEvent) => { e.preventDefault(); if (!command.trim()) return; setIsLoading(true); try { await onCommand(command.trim()); setCommand(''); onClose(); } catch (error) { console.error(error); } finally { setIsLoading(false); } };
    
    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
                <form onSubmit={handleSubmit} className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-4 text-gray-500"><AiIcon/></div>
                    <input autoFocus type="text" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="e.g., 'Set a 15 minute timer for pizza'" disabled={isLoading} className="w-full pl-12 pr-24 py-4 text-lg bg-transparent text-gray-100 border-0 rounded-lg focus:ring-0 focus:outline-none" />
                    <button type="submit" disabled={isLoading} className="absolute inset-y-0 right-0 flex items-center justify-center px-6 m-2 font-semibold text-white bg-blue-500 rounded-md hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed">{isLoading ? 'Processing...' : 'Ask'}</button>
                </form>
            </div>
        </div>
    );
  };
  
const EditAlarmModal: React.FC<{ alarm: Alarm; onSave: (alarm: Alarm) => void; onClose: () => void; }> = ({ alarm, onSave, onClose }) => {
    const [time, setTime] = useState(alarm.time);
    const [label, setLabel] = useState(alarm.label);
    const [days, setDays] = useState<number[]>(alarm.days);
    const [repeat, setRepeat] = useState(!alarm.isOneTime);

    const handleDayToggle = (dayIndex: number) => {
      setDays(prev => prev.includes(dayIndex) ? prev.filter(d => d !== dayIndex) : [...prev, dayIndex].sort());
    };

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        if (repeat && days.length === 0) {
            alert('Please select at least one day for repeating alarms.');
            return;
        }

        let newTargetDate = alarm.targetDate;
        if (!alarm.isOneTime && !repeat) { // Switched from repeating to one-time
            const now = new Date();
            const [alarmHours, alarmMinutes] = time.split(':').map(Number);
            const alarmTimeToday = new Date();
            alarmTimeToday.setHours(alarmHours, alarmMinutes, 0, 0);
            if (alarmTimeToday.getTime() <= now.getTime()) {
                now.setDate(now.getDate() + 1);
            }
            newTargetDate = formatDate(now);
        } else if (alarm.isOneTime && repeat) { // Switched from one-time to repeating
            newTargetDate = null;
        }

        onSave({
            ...alarm,
            time,
            label: label.trim() || 'New Alarm',
            days: repeat ? days : [],
            isOneTime: !repeat,
            targetDate: newTargetDate,
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <form onSubmit={handleSave} className="bg-gray-800 rounded-lg shadow-xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-semibold text-gray-100">Edit Alarm</h3>
                <div className="flex flex-wrap items-center gap-4">
                    <input type="time" value={time} onChange={e => setTime(e.target.value)} className="px-3 py-2 text-base bg-gray-700 text-gray-100 border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
                    <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Alarm label" className="flex-grow min-w-0 px-3 py-2 text-base bg-gray-700 text-gray-100 border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-300 text-sm">Repeat</span>
                        <button type="button" onClick={() => setRepeat(!repeat)} className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors ${repeat ? 'bg-blue-600' : 'bg-gray-600'}`}>
                            <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${repeat ? 'translate-x-6' : 'translate-x-1'}`}/>
                        </button>
                    </div>
                </div>
                {repeat && (
                    <div className="p-2 bg-gray-700/50 rounded-md">
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                            {WEEK_DAYS_FULL.map((day, index) => (
                                <button key={day} type="button" onClick={() => handleDayToggle(index)} className={`px-2 py-2 text-sm rounded-md ${days.includes(index) ? 'bg-blue-500 text-white' : 'bg-gray-600 text-gray-200 hover:bg-gray-500'}`}>{day}</button>
                            ))}
                        </div>
                    </div>
                )}
                <div className="flex justify-end gap-4 pt-4">
                    <button type="button" onClick={onClose} className="px-4 py-2 font-semibold text-gray-300 bg-gray-600 rounded-md hover:bg-gray-500">Cancel</button>
                    <button type="submit" className="px-4 py-2 font-semibold text-white bg-blue-500 rounded-md hover:bg-blue-600">Save Changes</button>
                </div>
            </form>
        </div>
    );
};
  
  const AlarmsView: React.FC<{
      alarms: Alarm[];
      setAlarms: React.Dispatch<React.SetStateAction<Alarm[]>>;
      ringingAlarms: Set<string>;
      setRingingAlarms: React.Dispatch<React.SetStateAction<Set<string>>>;
      onUpdateAlarm: (updatedAlarm: Alarm) => void;
  }> = ({ alarms, setAlarms, ringingAlarms, setRingingAlarms, onUpdateAlarm }) => {
    const [time, setTime] = useState('07:00');
    const [label, setLabel] = useState('');
    const [days, setDays] = useState<number[]>([]);
    const [repeat, setRepeat] = useState(false);
    const [editingAlarm, setEditingAlarm] = useState<Alarm | null>(null);
    
    const handleDayToggle = (dayIndex: number) => {
      setDays(prev => prev.includes(dayIndex) ? prev.filter(d => d !== dayIndex) : [...prev, dayIndex].sort());
    };

    const handleAddAlarm = (e: React.FormEvent) => {
        e.preventDefault();
        if (repeat && days.length === 0) {
            alert('Please select at least one day for repeating alarms.');
            return;
        }

        let targetDate = null;
        if (!repeat) {
            const now = new Date();
            const [alarmHours, alarmMinutes] = time.split(':').map(Number);
            const alarmTimeToday = new Date();
            alarmTimeToday.setHours(alarmHours, alarmMinutes, 0, 0);

            if (alarmTimeToday.getTime() <= now.getTime()) {
                now.setDate(now.getDate() + 1); // If time has passed today, set for tomorrow
            }
            targetDate = formatDate(now);
        }

        setAlarms(prev => [...prev, { id: Date.now().toString(), time, label: label.trim() || 'New Alarm', days: repeat ? days : [], enabled: true, isOneTime: !repeat, targetDate }]);
        setLabel('');
        setDays([]);
        setRepeat(false);
    };
    
    const handleToggleAlarm = (id: string) => {
        setAlarms(prev => prev.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a));
    };

    const handleDeleteAlarm = (id: string) => {
        setAlarms(prev => prev.filter(a => a.id !== id));
        setRingingAlarms(prev => {
            const newSet = new Set(prev);
            newSet.delete(id);
            return newSet;
        });
    };
    
    const handleDismissAlarm = (id: string) => {
        setRingingAlarms(prev => {
            const newSet = new Set(prev);
            newSet.delete(id);
            return newSet;
        });
    };
    
    return (
      <div className="p-4 md:p-8 space-y-8 h-full overflow-y-auto custom-scrollbar bg-gray-900/50">
        <h2 className="text-3xl font-bold text-gray-50">Alarms</h2>
        <form onSubmit={handleAddAlarm} className="p-4 space-y-4 bg-gray-800 rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold text-gray-100">Add New Alarm</h3>
          <div className="flex flex-wrap items-center gap-4">
            <input type="time" value={time} onChange={e => setTime(e.target.value)} className="px-3 py-2 text-base bg-gray-700 text-gray-100 border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
            <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Alarm label (optional)" className="flex-grow min-w-0 px-3 py-2 text-base bg-gray-700 text-gray-100 border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-300 text-sm">Repeat</span>
              <button type="button" onClick={() => setRepeat(!repeat)} className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors ${repeat ? 'bg-blue-600' : 'bg-gray-600'}`}>
                <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${repeat ? 'translate-x-6' : 'translate-x-1'}`}/>
              </button>
            </div>
          </div>
          {repeat && (
            <div className="p-2 bg-gray-700/50 rounded-md">
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                {WEEK_DAYS_FULL.map((day, index) => (
                    <button key={day} type="button" onClick={() => handleDayToggle(index)} className={`px-2 py-2 text-sm rounded-md ${days.includes(index) ? 'bg-blue-500 text-white' : 'bg-gray-600 text-gray-200 hover:bg-gray-500'}`}>{day}</button>
                ))}
                </div>
            </div>
          )}
          <button type="submit" className="w-full px-4 py-2 font-semibold text-white bg-blue-500 rounded-md hover:bg-blue-600">Add Alarm</button>
        </form>
        <div className="space-y-4">
          {alarms.map(alarm => (
            <div key={alarm.id} className={`flex items-center justify-between p-4 rounded-lg shadow-sm ${ringingAlarms.has(alarm.id) ? 'bg-yellow-900/40 animate-pulse' : 'bg-gray-800'}`}>
              <div>
                <p className="text-2xl font-bold text-gray-100">{formatTime12Hour(alarm.time)}</p>
                <p className="text-gray-300">{alarm.label}</p>
                <p className="text-sm text-gray-500">{alarm.isOneTime ? `One-time on ${alarm.targetDate}` : alarm.days.map(d => WEEK_DAYS[d]).join(', ')}</p>
              </div>
              <div className="flex items-center gap-4">
                {ringingAlarms.has(alarm.id) ? (
                    <button onClick={() => handleDismissAlarm(alarm.id)} className="px-4 py-2 text-sm font-semibold text-white bg-red-500 rounded-md hover:bg-red-600">Dismiss</button>
                ) : (
                    <>
                    <button onClick={() => handleToggleAlarm(alarm.id)} className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors ${alarm.enabled ? 'bg-blue-600' : 'bg-gray-600'}`}>
                        <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${alarm.enabled ? 'translate-x-6' : 'translate-x-1'}`}/>
                    </button>
                    <button onClick={() => setEditingAlarm(alarm)} className="text-gray-400 hover:text-blue-400"><EditIcon/></button>
                    <button onClick={() => handleDeleteAlarm(alarm.id)} className="text-gray-400 hover:text-red-500"><TrashIcon/></button>
                    </>
                )}
              </div>
            </div>
          ))}
        </div>
        {editingAlarm && <EditAlarmModal alarm={editingAlarm} onSave={onUpdateAlarm} onClose={() => setEditingAlarm(null)} />}
      </div>
    );
  };
  
  const TimeInput: React.FC<{label: string, value: string, setValue: (v: string) => void, max: number, placeholder?: string}> = ({label, value, setValue, max, placeholder}) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        if (val === '') {
            setValue('');
            return;
        }
        let num = parseInt(val, 10);
        if (!isNaN(num)) {
            if (num > max) num = max;
            if (num < 0) num = 0;
            setValue(num.toString());
        }
    };
    const handleBlur = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.value === '') {
            setValue('0');
        }
    };
    return (
        <div className="flex-1 flex flex-col items-center">
            <label className="text-sm text-gray-400 mb-1">{label}</label>
            <input
                type="number"
                value={value}
                onChange={handleChange}
                onBlur={handleBlur}
                placeholder={placeholder || '0'}
                min="0"
                max={max}
                className="w-full p-2 text-center text-xl bg-gray-700 text-gray-100 border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
        </div>
    );
  };

  const TimersView: React.FC = () => {
    const [label, setLabel] = useState('');
    const [hours, setHours] = useState('0');
    const [minutes, setMinutes] = useState('5');
    const [seconds, setSeconds] = useState('0');

    const handleAddTimer = (e: React.FormEvent) => {
        e.preventDefault();
        const h = parseInt(hours, 10) || 0;
        const m = parseInt(minutes, 10) || 0;
        const s = parseInt(seconds, 10) || 0;
        const duration = (h * 3600) + (m * 60) + s;
        if (duration <= 0) {
            alert('Please set a duration greater than zero.');
            return;
        }
        setTimers(prev => [...prev, { id: Date.now().toString(), label: label.trim() || `Timer`, initialDuration: duration, timeLeft: duration, status: 'running' }]);
        setLabel(''); setHours('0'); setMinutes('5'); setSeconds('0');
    };
    
    const handleTimerAction = (id: string, action: 'start' | 'pause' | 'reset' | 'delete' | 'dismiss') => {
        if(action === 'dismiss') {
             handleDeleteTimer(id);
            return;
        }

        setTimers(prev => {
            if (action === 'delete') return prev.filter(t => t.id !== id);
            return prev.map(t => {
                if (t.id !== id) return t;
                switch (action) {
                    case 'start': return { ...t, status: 'running' };
                    case 'pause': return { ...t, status: 'paused' };
                    case 'reset': return { ...t, status: 'stopped', timeLeft: t.initialDuration };
                    default: return t;
                }
            });
        });
    };
    
    const handleDeleteTimer = (id: string) => {
        setTimers(prev => prev.filter(t => t.id !== id));
        setRingingTimers(prev => {
            const newSet = new Set(prev);
            newSet.delete(id);
            return newSet;
        });
    };

    return (
        <div className="p-4 md:p-8 space-y-6 h-full overflow-y-auto custom-scrollbar bg-gray-900/50">
            <div>
                <h2 className="text-3xl font-bold text-gray-50">Timers</h2>
                <form onSubmit={handleAddTimer} className="p-4 mt-4 space-y-4 bg-gray-800 rounded-lg shadow-sm">
                    <h3 className="text-lg font-semibold text-gray-100">Add New Timer</h3>
                    <div className="flex items-end gap-2">
                        <TimeInput label="Hours" value={hours} setValue={setHours} max={99}/>
                        <span className="text-2xl font-bold pb-2 text-gray-400">:</span>
                        <TimeInput label="Minutes" value={minutes} setValue={setMinutes} max={59}/>
                        <span className="text-2xl font-bold pb-2 text-gray-400">:</span>
                        <TimeInput label="Seconds" value={seconds} setValue={setSeconds} max={59}/>
                    </div>
                    <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Timer label (optional)" className="w-full px-3 py-2 text-base bg-gray-700 text-gray-100 border border-gray-600 rounded-md"/>
                    <button type="submit" className="w-full px-4 py-2 font-semibold text-white bg-blue-500 rounded-md hover:bg-blue-600">Add & Start Timer</button>
                </form>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {timers.map(timer => (
                    <div key={timer.id} className={`p-4 rounded-lg shadow-sm flex flex-col items-center justify-center ${ringingTimers.has(timer.id) ? 'bg-yellow-900/40 animate-pulse' : 'bg-gray-800'}`}>
                        <p className="font-semibold text-gray-100">{timer.label}</p>
                        <p className="text-5xl font-mono font-bold my-4 text-gray-50">{formatTimer(timer.timeLeft)}</p>
                        {ringingTimers.has(timer.id) ? (
                            <button onClick={() => handleTimerAction(timer.id, 'dismiss')} className="px-4 py-2 text-sm font-semibold text-white bg-red-500 rounded-md hover:bg-red-600">Dismiss</button>
                        ) : (
                            <div className="flex items-center gap-2">
                                {timer.status !== 'running' ? 
                                    <button onClick={() => handleTimerAction(timer.id, 'start')} className="p-2 text-green-500 hover:text-green-700"><PlayIcon/></button> :
                                    <button onClick={() => handleTimerAction(timer.id, 'pause')} className="p-2 text-yellow-500 hover:text-yellow-700"><PauseIcon/></button>
                                }
                                <button onClick={() => handleTimerAction(timer.id, 'reset')} className="p-2 text-blue-500 hover:text-blue-700"><StopIcon/></button>
                                <button onClick={() => handleDeleteTimer(timer.id)} className="p-2 text-red-500 hover:text-red-700"><TrashIcon/></button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
  };
  
  const StopwatchView: React.FC = () => {
    return <Stopwatch aiAction={aiStopwatchAction} />;
  };

  const NotebookView: React.FC<{
    pages: NotebookPage[];
    activePageId: string | null;
    onAddPage: () => void;
    onSelectPage: (id: string) => void;
    onUpdatePage: (id: string, updates: { title?: string; content?: string }) => void;
    onDeletePage: (id: string) => void;
    }> = ({ pages, activePageId, onAddPage, onSelectPage, onUpdatePage, onDeletePage }) => {
      const activePage = useMemo(() => pages.find(p => p.id === activePageId), [pages, activePageId]);
      
      const [currentTitle, setCurrentTitle] = useState('');
      const [currentContent, setCurrentContent] = useState('');

      const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
      const [searchQuery, setSearchQuery] = useState('');
  
      // FIX: Sync local state with props ONLY when the activePageId changes.
      // This is the core fix that prevents re-renders from the parent from overwriting user input,
      // which solves the focus jumping, sidebar instability, and other related UI bugs.
      useEffect(() => {
        if (activePage) {
            setCurrentTitle(activePage.title);
            setCurrentContent(activePage.content);
        } else {
            setCurrentTitle('');
            setCurrentContent('');
        }
      }, [activePageId]);

      // FIX: Save content on blur for stability. This avoids rapid updates that were
      // causing the component to remount and reset its state (like the sidebar).
      const handleTitleBlur = () => {
        if (activePageId) {
            onUpdatePage(activePageId, { title: currentTitle });
        }
      };

      const handleContentBlur = () => {
        if (activePageId) {
            onUpdatePage(activePageId, { content: currentContent });
        }
      };
  
      const formatNotebookDate = (isoString: string): string => {
        const date = new Date(isoString);
        const month = MONTHS[date.getMonth()].substring(0, 3);
        const day = date.getDate();
        const year = date.getFullYear();
        let hour = date.getHours();
        const minute = date.getMinutes().toString().padStart(2, '0');
        const ampm = hour >= 12 ? 'PM' : 'AM';
        hour = hour % 12;
        hour = hour || 12; // Handle midnight
        return `${month} ${day}, ${year}, ${hour}:${minute} ${ampm}`;
      };

      const filteredPages = useMemo(() => {
        const sortedPages = [...pages].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        if (!searchQuery.trim()) {
            return sortedPages;
        }
        return sortedPages.filter(page =>
            page.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            page.content.toLowerCase().includes(searchQuery.toLowerCase())
        );
      }, [pages, searchQuery]);
  
      return (
          <div className="flex h-full bg-gray-900/50 text-gray-200">
              <aside className={`custom-scrollbar bg-gray-800 border-r border-gray-700 flex flex-col overflow-y-auto transition-all duration-300 ease-in-out ${isSidebarCollapsed ? 'w-0 p-0' : 'w-full md:w-64 lg:w-72 p-4'}`}>
                  <div className={`space-y-4 ${isSidebarCollapsed ? 'hidden' : 'block'}`}>
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-gray-50">Pages</h2>
                        <button onClick={onAddPage} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-white bg-blue-500 rounded-md hover:bg-blue-600">
                            <PlusIcon /> New
                        </button>
                    </div>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search pages..."
                      className="w-full px-3 py-2 text-sm bg-gray-700 text-gray-100 border border-transparent rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    <ul className="space-y-1">
                        {filteredPages.map(page => (
                            <li key={page.id} className="group">
                               <button onClick={() => onSelectPage(page.id)} className={`w-full text-left flex items-center justify-between p-2 rounded-md ${page.id === activePageId ? 'bg-blue-900/50' : 'hover:bg-gray-700'}`}>
                                    <span className="truncate text-sm font-medium">{page.title || 'Untitled Page'}</span>
                                    <button onClick={(e) => { e.stopPropagation(); onDeletePage(page.id); }} className="text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500 ml-2 flex-shrink-0">
                                        <TrashIcon />
                                    </button>
                               </button>
                            </li>
                        ))}
                    </ul>
                  </div>
              </aside>
              <main className="relative flex-1 flex flex-col">
                  <button 
                      onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} 
                      className="absolute top-4 left-4 z-20 p-2 bg-gray-700/50 rounded-full hover:bg-gray-600 text-gray-200"
                      aria-label={isSidebarCollapsed ? 'Open sidebar' : 'Collapse sidebar'}
                  >
                      <SidebarToggleIcon collapsed={isSidebarCollapsed} />
                  </button>
                  {activePage ? (
                      <div className="flex-1 flex flex-col p-4 md:p-8 overflow-hidden">
                          <input
                              type="text"
                              value={currentTitle}
                              onChange={(e) => setCurrentTitle(e.target.value)}
                              onBlur={handleTitleBlur}
                              placeholder="Untitled Page"
                              className="w-full text-3xl font-bold bg-transparent text-gray-50 border-none focus:ring-0 p-2 -mx-2 mb-4 mt-12"
                          />
                          <textarea
                              value={currentContent}
                              onChange={(e) => setCurrentContent(e.target.value)}
                              onBlur={handleContentBlur}
                              placeholder="Start writing..."
                              className="custom-scrollbar flex-1 w-full text-base bg-transparent text-gray-300 border-none focus:ring-0 p-2 -mx-2 resize-none"
                          />
                           <div className="text-xs text-gray-500 mt-4 text-right">
                              Last updated: {formatNotebookDate(activePage.updatedAt)}
                          </div>
                      </div>
                  ) : (
                      <div className="flex-1 flex items-center justify-center text-gray-500">
                          <div className="text-center">
                              <NotebookIcon />
                              <p className="mt-2">Select a page or create a new one.</p>
                          </div>
                      </div>
                  )}
              </main>
          </div>
      );
  };
  
  const CalendarView: React.FC = () => {
    const renderMainView = () => {
      const viewProps = { currentDate, selectedDate, mainView, calendarData, alarms, holidays, selectedDateKey, recurringChecklistItems, handleDateClick, handleMonthClick };
      switch (mainView) {
        case 'year': return <YearView {...viewProps} />;
        case 'month': return <MonthView {...viewProps} />;
        case 'week': return <WeekView {...viewProps} />;
        case 'day': return <DayView {...viewProps} />;
        default: return <MonthView {...viewProps} />;
      }
    };
    return (
      <div className="flex h-full bg-gray-900/50 text-gray-200 relative">
        <main className="flex-1 flex flex-col bg-gray-800 shadow-sm overflow-hidden">
          <div className="p-4 md:p-6 lg:p-8 border-b border-gray-700">
            <CalendarHeader mainView={mainView} currentDate={currentDate} selectedDate={selectedDate} navigate={navigate} setCurrentDate={setCurrentDate} setSelectedDate={setSelectedDate} setMainView={handleSetMainView}/>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {renderMainView()}
          </div>
        </main>
        <aside className="custom-scrollbar w-full md:w-96 lg:w-[400px] bg-gray-800 border-l border-gray-700 flex-shrink-0 p-6 space-y-6 overflow-y-auto absolute md:relative h-full inset-0 z-10 md:z-auto">
          <div>
            <h2 className="text-xl font-bold text-gray-50 mb-1">{selectedDate.toLocaleDateString('en-US', { weekday: 'long' })}</h2>
            <p className="text-gray-400 mb-4">{selectedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
            <div className="flex border-b border-gray-700">
              {(['day', 'week', 'month', 'year', 'recurring'] as (MainView | 'recurring')[]).map(view => (
                  <button key={view} onClick={() => handleSidebarTabClick(view)} className={`px-4 py-2 text-sm font-medium capitalize ${sidebarContent === view ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}>{view}</button>
              ))}
            </div>
          </div>
          <div className="space-y-6">
              {sidebarContent === 'day' && (<div className="space-y-6"><RemindersSection allRemindersForSelectedDate={allRemindersForSelectedDate} handleReminderUpdate={handleReminderUpdate} selectedDateKey={selectedDateKey} /><NoteSection note={selectedDateData.note} onUpdate={handleNoteUpdate} placeholder="Add a note for this day..." noteKey={selectedDateKey} /><Checklist title="Checklist" items={dailyCombinedChecklistItems} onAddItem={(text) => handleDailyChecklistUpdate('add', text)} onToggleItem={(id) => handleDailyChecklistUpdate('toggle', id)} onDeleteItem={(id) => handleDailyChecklistUpdate('delete', id)}/></div>)}
              {sidebarContent === 'week' && (<div className="space-y-6"><NoteSection note={currentWeekNote} onUpdate={handleWeeklyNoteUpdate} placeholder="Add a note for this week..." noteKey={currentWeekKey} /><Checklist title="Weekly Checklist" items={currentWeekChecklist} onAddItem={weeklyChecklistHandlers.onAddItem} onToggleItem={weeklyChecklistHandlers.onToggleItem} onDeleteItem={weeklyChecklistHandlers.onDeleteItem}/></div>)}
              {sidebarContent === 'month' && (<div className="space-y-6"><NoteSection note={currentMonthNote} onUpdate={handleMonthlyNoteUpdate} placeholder="Add a note for this month..." noteKey={currentMonthKey} /><Checklist title="Monthly Checklist" items={currentMonthChecklist} onAddItem={monthlyChecklistHandlers.onAddItem} onToggleItem={monthlyChecklistHandlers.onToggleItem} onDeleteItem={monthlyChecklistHandlers.onDeleteItem}/></div>)}
              {sidebarContent === 'year' && (<div className="space-y-6"><NoteSection note={currentYearNote} onUpdate={handleYearlyNoteUpdate} placeholder="Add a note for this year..." noteKey={currentYearKey} /><Checklist title="Yearly Checklist" items={currentYearChecklist} onAddItem={yearlyChecklistHandlers.onAddItem} onToggleItem={yearlyChecklistHandlers.onToggleItem} onDeleteItem={yearlyChecklistHandlers.onDeleteItem}/></div>)}
              {sidebarContent === 'recurring' && (<RecurringChecklistSection items={recurringChecklistItems} onAddItem={recurringChecklistHandlers.onAddItem} onDeleteItem={recurringChecklistHandlers.onDeleteItem}/>)}
          </div>
        </aside>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-200">
      <TopBar/>
      <div className="flex-1 overflow-hidden">
        {appView === 'calendar' && <CalendarView />}
        {appView === 'alarms' && <AlarmsView alarms={alarms} setAlarms={setAlarms} ringingAlarms={ringingAlarms} setRingingAlarms={setRingingAlarms} onUpdateAlarm={handleUpdateAlarm} />}
        {appView === 'timers' && <TimersView />}
        {appView === 'stopwatch' && <StopwatchView />}
        {appView === 'notebook' && 
            <NotebookView
                pages={notebookPages}
                activePageId={activeNotebookPageId}
                onAddPage={handleAddNotebookPage}
                onSelectPage={setActiveNotebookPageId}
                onUpdatePage={handleUpdateNotebookPage}
                onDeletePage={handleDeleteNotebookPage}
            />
        }
      </div>
      {isAiModalOpen && <AiModal onClose={() => setIsAiModalOpen(false)} onCommand={handleAiCommand} />}
    </div>
  );
};

export default App;