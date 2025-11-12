import { GoogleGenAI, FunctionDeclaration, Type, FunctionCall } from '@google/genai';

const addReminderFunctionDeclaration: FunctionDeclaration = {
  name: 'addReminder',
  parameters: {
    type: Type.OBJECT,
    description: 'Adds a reminder for a specific date and time.',
    properties: {
      date: { type: Type.STRING, description: 'The date for the reminder in YYYY-MM-DD format.' },
      time: { type: Type.STRING, description: 'The time for the reminder in HH:MM (24-hour) format.' },
      description: { type: Type.STRING, description: 'The content or description of the reminder.' },
    },
    required: ['date', 'time', 'description'],
  },
};

const addAlarmFunctionDeclaration: FunctionDeclaration = {
  name: 'addAlarm',
  parameters: {
    type: Type.OBJECT,
    description: 'Adds an alarm. It can be a one-time alarm or a repeating one.',
    properties: {
      time: { type: Type.STRING, description: 'The time for the alarm in HH:MM (24-hour) format.' },
      label: { type: Type.STRING, description: 'An optional descriptive label for the alarm.' },
      repeat: { type: Type.BOOLEAN, description: 'Whether the alarm should repeat weekly.' },
      days: {
        type: Type.ARRAY,
        description: 'An array of numbers for the days of the week (0=Sunday, 1=Monday, ..., 6=Saturday). Required if repeat is true.',
        items: { type: Type.NUMBER },
      },
    },
    required: ['time', 'repeat'],
  },
};

const addTimerFunctionDeclaration: FunctionDeclaration = {
  name: 'addTimer',
  parameters: {
    type: Type.OBJECT,
    description: 'Adds and immediately starts a new countdown timer.',
    properties: {
      hours: { type: Type.NUMBER, description: 'Number of hours for the timer.' },
      minutes: { type: Type.NUMBER, description: 'Number of minutes for the timer.' },
      seconds: { type: Type.NUMBER, description: 'Number of seconds for the timer.' },
      label: { type: Type.STRING, description: 'An optional descriptive label for the timer.' },
    },
    required: ['hours', 'minutes', 'seconds'],
  },
};

const controlStopwatchFunctionDeclaration: FunctionDeclaration = {
  name: 'controlStopwatch',
  parameters: {
    type: Type.OBJECT,
    description: 'Controls the stopwatch.',
    properties: {
      action: {
        type: Type.STRING,
        description: "The action to perform: 'start', 'stop', 'lap', or 'reset'.",
      },
    },
    required: ['action'],
  },
};

export const processNaturalLanguageCommand = async (command: string) => {
  const API_KEY = "AIzaSyAfE0cwaIyVrA4xjf4EKdZJ3y-bLQmqZq8";
  if (!API_KEY) {
    throw new Error("Gemini API key is not configured.");
  }
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const today = new Date().toISOString().split('T')[0];
  const systemInstruction = `You are an intelligent assistant integrated into a calendar app. Your task is to interpret user commands and use the available tools to manage their calendar, alarms, timers, and stopwatch. Today's date is ${today}. When a time is mentioned without a date for a reminder, assume it is for today. If a day of the week is mentioned (e.g., 'next Tuesday'), calculate the correct YYYY-MM-DD date based on today's date. For alarms, if the user doesn't specify repeat, assume it's a one-time alarm.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: command,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: [
          addReminderFunctionDeclaration, 
          addAlarmFunctionDeclaration,
          addTimerFunctionDeclaration,
          controlStopwatchFunctionDeclaration
        ] }],
      },
    });

    if (response.functionCalls && response.functionCalls.length > 0) {
      return response.functionCalls; // Return all function calls
    } else {
      return { text: response.text };
    }
  } catch (error) {
    console.error('Error processing command with Gemini:', error);
    throw new Error('Failed to process your request with the AI assistant.');
  }
};