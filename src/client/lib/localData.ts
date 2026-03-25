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

export type TeacherLanguage = 'en' | 'he' | 'ar';

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

function readStoredAppLanguage(): TeacherLanguage {
  if (typeof window === 'undefined') return 'en';
  return normalizeTeacherLanguage(window.localStorage.getItem(APP_LANGUAGE_KEY), 'en');
}

function buildDefaultSettings(language: TeacherLanguage): TeacherSettingsState {
  const profileByLanguage = {
    he: {
      firstName: 'שרה',
      lastName: 'כהן',
      school: 'תיכון הרצל',
    },
    ar: {
      firstName: 'سارة',
      lastName: 'خليل',
      school: 'ثانوية الأمل',
    },
    en: {
      firstName: 'Sarah',
      lastName: 'Jenkins',
      school: 'Lincoln High School',
    },
  }[language];

  return {
    profile: {
      firstName: profileByLanguage.firstName,
      lastName: profileByLanguage.lastName,
      email: 'teacher@school.edu',
      school: profileByLanguage.school,
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
      language,
    },
  };
}

function buildDefaultClasses(language: TeacherLanguage): TeacherClass[] {
  const defaultClassSets = {
    he: [
      {
        id: 'class-math-101',
        name: 'מתמטיקה 101',
        subject: 'מתמטיקה',
        grade: "כיתה ט'",
        color: 'bg-brand-purple',
        packId: null,
        notes: 'קבוצת ליבה לחיזוק מיומנויות בסיס.',
        students: ['נועה', 'יואב', 'מאיה', 'עידו', 'אלה'],
      },
      {
        id: 'class-science-202',
        name: 'מדעים 202',
        subject: 'מדעים',
        grade: "כיתה י'",
        color: 'bg-brand-orange',
        packId: null,
        notes: 'קבוצה עם דגש על עבודת מעבדה.',
        students: ['איתן', 'ליה', 'אמה', 'דניאל'],
      },
      {
        id: 'class-history-303',
        name: 'היסטוריה 303',
        subject: 'היסטוריה',
        grade: "כיתה י\"א",
        color: 'bg-brand-yellow',
        packId: null,
        notes: 'סמינר מבוסס פרויקטים.',
        students: ['יונה', 'מיה', 'סופיה'],
      },
    ],
    ar: [
      {
        id: 'class-math-101',
        name: 'رياضيات 101',
        subject: 'رياضيات',
        grade: 'الصف التاسع',
        color: 'bg-brand-purple',
        packId: null,
        notes: 'مجموعة أساسية لتعزيز المهارات الحسابية.',
        students: ['آفا', 'نوح', 'مايا', 'ليام', 'إيلا'],
      },
      {
        id: 'class-science-202',
        name: 'علوم 202',
        subject: 'علوم',
        grade: 'الصف العاشر',
        color: 'bg-brand-orange',
        packId: null,
        notes: 'شعبة تركّز على المختبر.',
        students: ['ماسون', 'ليا', 'إيما', 'دانيال'],
      },
      {
        id: 'class-history-303',
        name: 'تاريخ 303',
        subject: 'تاريخ',
        grade: 'الصف الحادي عشر',
        color: 'bg-brand-yellow',
        packId: null,
        notes: 'حلقة دراسية قائمة على المشاريع.',
        students: ['جونا', 'مايا', 'صوفيا'],
      },
    ],
    en: [
      {
        id: 'class-math-101',
        name: 'Math 101',
        subject: 'Math',
        grade: '9th Grade',
        color: 'bg-brand-purple',
        packId: null,
        notes: 'Core numeracy group.',
        students: ['Ava', 'Noah', 'Mia', 'Liam', 'Ella'],
      },
      {
        id: 'class-science-202',
        name: 'Science 202',
        subject: 'Science',
        grade: '10th Grade',
        color: 'bg-brand-orange',
        packId: null,
        notes: 'Lab-heavy section.',
        students: ['Mason', 'Leah', 'Emma', 'Daniel'],
      },
      {
        id: 'class-history-303',
        name: 'History 303',
        subject: 'History',
        grade: '11th Grade',
        color: 'bg-brand-yellow',
        packId: null,
        notes: 'Project-based seminar.',
        students: ['Jonah', 'Maya', 'Sofia'],
      },
    ],
  }[language];

  return defaultClassSets.map((classItem) => ({
    ...classItem,
    createdAt: new Date().toISOString(),
    students: classItem.students.map((name, index) => ({
      id: `${classItem.id}-${index}`,
      name,
      joinedAt: new Date().toISOString(),
    })),
  }));
}

function normalizeTeacherLanguage(value: unknown, fallback: TeacherLanguage = 'en'): TeacherLanguage {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'he' || normalized === 'ar' || normalized === 'en') {
    return normalized;
  }
  return fallback;
}

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
  const appLanguage = readStoredAppLanguage();
  const defaultSettings = buildDefaultSettings(appLanguage);
  const value = readJson<TeacherSettingsState>(SETTINGS_KEY, defaultSettings);
  return {
    profile: { ...defaultSettings.profile, ...(value.profile || {}) },
    notifications: { ...defaultSettings.notifications, ...(value.notifications || {}) },
    appearance: {
      ...defaultSettings.appearance,
      ...(value.appearance || {}),
      language: normalizeTeacherLanguage(value.appearance?.language, appLanguage),
    },
  };
}

export function saveTeacherSettings(settings: TeacherSettingsState) {
  writeJson(SETTINGS_KEY, settings);
}

export function loadTeacherClasses(): TeacherClass[] {
  return readJson<TeacherClass[]>(CLASSES_KEY, buildDefaultClasses(readStoredAppLanguage()));
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
  const language = readStoredAppLanguage();
  const localizedDefaults = {
    he: {
      name: 'כיתה חדשה',
      subject: 'כללי',
      grade: 'רב־שכבתי',
    },
    ar: {
      name: 'صف جديد',
      subject: 'عام',
      grade: 'متعدد المستويات',
    },
    en: {
      name: 'New Class',
      subject: 'General',
      grade: 'Mixed',
    },
  }[language];
  return {
    id: `class-${Date.now()}`,
    name: partial.name || localizedDefaults.name,
    subject: partial.subject || localizedDefaults.subject,
    grade: partial.grade || localizedDefaults.grade,
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
