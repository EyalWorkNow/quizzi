export interface TeacherProfile {
  firstName: string;
  lastName: string;
  email: string;
  school: string;
  avatar: string;
}

export interface TeacherNotifications {
  featureUpdates: boolean;
  weeklyReports: boolean;
  studentJoinAlerts: boolean;
  marketingEmails: boolean;
}

export type TeacherLanguage = 'en' | 'he';

export interface TeacherAppearance {
  theme: 'light' | 'dark';
  language: TeacherLanguage;
}

export interface TeacherSettingsState {
  profile: TeacherProfile;
  notifications: TeacherNotifications;
  appearance: TeacherAppearance;
}

export interface TeacherStudent {
  id: string;
  name: string;
  joinedAt: string;
}

export interface TeacherClass {
  id: string;
  name: string;
  subject: string;
  grade: string;
  color: string;
  packId: number | null;
  notes: string;
  students: TeacherStudent[];
  createdAt: string;
}

export interface ContactSubmission {
  id: string;
  inquiryType: string;
  name: string;
  organization: string;
  email: string;
  message: string;
  createdAt: string;
}

const SETTINGS_KEY = 'quizzi.teacher.settings';
const CLASSES_KEY = 'quizzi.teacher.classes';
const CONTACTS_KEY = 'quizzi.contact.submissions';
const APP_LANGUAGE_KEY = 'quizzi.app.language';

const DEFAULT_SETTINGS: TeacherSettingsState = {
  profile: {
    firstName: 'Sarah',
    lastName: 'Jenkins',
    email: 'teacher@school.edu',
    school: 'Lincoln High School',
    avatar: '👩🏻‍🏫',
  },
  notifications: {
    featureUpdates: true,
    weeklyReports: true,
    studentJoinAlerts: false,
    marketingEmails: false,
  },
  appearance: {
    theme: 'light',
    language: 'en',
  },
};

const DEFAULT_CLASSES: TeacherClass[] = [
  {
    id: 'class-math-101',
    name: 'Math 101',
    subject: 'Math',
    grade: '9th Grade',
    color: 'bg-brand-purple',
    packId: null,
    notes: 'Core numeracy group.',
    createdAt: new Date().toISOString(),
    students: ['Ava', 'Noah', 'Mia', 'Liam', 'Ella'].map((name, index) => ({
      id: `math-101-${index}`,
      name,
      joinedAt: new Date().toISOString(),
    })),
  },
  {
    id: 'class-science-202',
    name: 'Science 202',
    subject: 'Science',
    grade: '10th Grade',
    color: 'bg-brand-orange',
    packId: null,
    notes: 'Lab-heavy section.',
    createdAt: new Date().toISOString(),
    students: ['Mason', 'Leah', 'Emma', 'Daniel'].map((name, index) => ({
      id: `science-202-${index}`,
      name,
      joinedAt: new Date().toISOString(),
    })),
  },
  {
    id: 'class-history-303',
    name: 'History 303',
    subject: 'History',
    grade: '11th Grade',
    color: 'bg-brand-yellow',
    packId: null,
    notes: 'Project-based seminar.',
    createdAt: new Date().toISOString(),
    students: ['Jonah', 'Maya', 'Sofia'].map((name, index) => ({
      id: `history-303-${index}`,
      name,
      joinedAt: new Date().toISOString(),
    })),
  },
];

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function loadTeacherSettings(): TeacherSettingsState {
  const value = readJson<TeacherSettingsState>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const appLanguage =
    typeof window !== 'undefined' && window.localStorage.getItem(APP_LANGUAGE_KEY) === 'he' ? 'he' : 'en';
  return {
    profile: { ...DEFAULT_SETTINGS.profile, ...(value.profile || {}) },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(value.notifications || {}) },
    appearance: {
      ...DEFAULT_SETTINGS.appearance,
      ...(value.appearance || {}),
      language: value.appearance?.language === 'he' ? 'he' : appLanguage,
    },
  };
}

export function saveTeacherSettings(settings: TeacherSettingsState) {
  writeJson(SETTINGS_KEY, settings);
}

export function loadTeacherClasses(): TeacherClass[] {
  return readJson<TeacherClass[]>(CLASSES_KEY, DEFAULT_CLASSES);
}

export function loadStoredTeacherClassesSnapshot(): TeacherClass[] | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(CLASSES_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TeacherClass[]) : null;
  } catch {
    return null;
  }
}

export function saveTeacherClasses(classes: TeacherClass[]) {
  writeJson(CLASSES_KEY, classes);
}

export function clearStoredTeacherClasses() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(CLASSES_KEY);
}

export function createTeacherClass(partial: Partial<TeacherClass>): TeacherClass {
  return {
    id: `class-${Date.now()}`,
    name: partial.name || 'New Class',
    subject: partial.subject || 'General',
    grade: partial.grade || 'Mixed',
    color: partial.color || 'bg-white',
    packId: partial.packId ?? null,
    notes: partial.notes || '',
    students: partial.students || [],
    createdAt: new Date().toISOString(),
  };
}

export function addContactSubmission(submission: Omit<ContactSubmission, 'id' | 'createdAt'>) {
  const current = readJson<ContactSubmission[]>(CONTACTS_KEY, []);
  const next: ContactSubmission[] = [
    {
      id: `contact-${Date.now()}`,
      createdAt: new Date().toISOString(),
      ...submission,
    },
    ...current,
  ];
  writeJson(CONTACTS_KEY, next);
  return next[0];
}

export function loadContactSubmissions(): ContactSubmission[] {
  return readJson<ContactSubmission[]>(CONTACTS_KEY, []);
}
