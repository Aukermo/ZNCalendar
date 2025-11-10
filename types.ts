export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface ChecklistRecurrenceRule {
  type: 'daily' | 'weekly' | 'monthly' | 'yearly';
  daysOfWeek?: number[]; // 0-6 for weekly
  dayOfMonth?: number; // 1-31 for monthly
  monthOfYear?: number; // 0-11 for yearly
}

export interface RecurringChecklistItem extends ChecklistItem {
  recurrence: ChecklistRecurrenceRule;
}

export interface RecurrenceRule {
  type: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  daysOfWeek?: number[]; // For weekly, 0 (Sun) - 6 (Sat)
  dayOfMonth?: number;   // For monthly (1-31) and yearly (1-31)
  monthOfYear?: number;  // For yearly, 0 (Jan) - 11 (Dec)
}

export interface Reminder {
  id: string;
  text: string;
  time: string;
  completed: boolean; // For the original instance
  recurrence: RecurrenceRule;
  completedDates?: string[]; // For recurring instances
}

export interface Alarm {
  id: string;
  time: string;
  label: string;
  days: number[]; // 0-6 for Sun-Sat
  enabled: boolean;
  isOneTime: boolean;
  targetDate: string | null; // YYYY-MM-DD for one-time alarms
}

export interface Timer {
    id: string;
    label: string;
    initialDuration: number; // in seconds
    timeLeft: number; // in seconds
    status: 'running' | 'paused' | 'stopped';
    intervalId?: number;
}

export interface Note {
  id: string;
  content: string;
}

export interface DateData {
  reminders: Reminder[];
  note: Note | null;
  checklist: ChecklistItem[]; // Day-specific items
  completedRecurringItemIds: string[]; // IDs of completed recurring items
}

export type CalendarData = {
  [dateKey: string]: DateData;
};

export type MonthlyChecklists = {
  [monthKey:string]: ChecklistItem[];
};

export type WeeklyChecklists = {
  [weekKey: string]: ChecklistItem[];
};

export type YearlyChecklists = {
  [yearKey: string]: ChecklistItem[];
};

export type YearlyNotes = {
  [yearKey: string]: Note | null;
};

export type WeeklyNotes = {
  [weekKey: string]: Note | null;
};

export type MonthlyNotes = {
  [monthKey: string]: Note | null;
};

export interface Holiday {
  name: string;
  date: string; // YYYY-MM-DD
}

export type MainView = 'day' | 'week' | 'month' | 'year';
export type AppView = 'calendar' | 'alarms' | 'timers' | 'stopwatch';