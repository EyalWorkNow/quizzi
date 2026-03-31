import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiFetchJson } from './api.ts';
import { UI_STRINGS } from './translations.ts';

export type AppLanguage = 'en' | 'he' | 'ar';

const APP_LANGUAGE_KEY = 'quizzi.app.language';
const TEACHER_SETTINGS_KEY = 'quizzi.teacher.settings';
const TRANSLATION_CACHE_PREFIX = 'quizzi.translation.v3.cache';

const HEBREW_CHARACTERS = /[\u0590-\u05FF]/;
const ARABIC_CHARACTERS = /[\u0600-\u06FF]/;
const BRAND_EXACT_VALUES = new Set(['Quiz', 'zi', 'Quizzi']);
const ATTRIBUTE_NAMES = ['placeholder', 'title', 'aria-label', 'alt'] as const;
const TRANSLATION_SEPARATOR = '[[QZ_SEP_42]]';

type TranslationRecord = {
  original: string;
  translated?: string;
};

export type AppLanguageContextValue = {
  language: AppLanguage;
  direction: 'ltr' | 'rtl';
  setLanguage: (language: AppLanguage) => void;
  t: (key: string, params?: Record<string, string>) => string;
};

const AppLanguageContext = createContext<AppLanguageContextValue | null>(null);

const RUNTIME_TRANSLATIONS: Record<AppLanguage, Record<string, string>> = {
  en: {
    'יצירת חידון': 'Create Quiz',
    'החידונים שלי': 'My Quizzes',
    'גילוי': 'Discover',
    'דוחות': 'Reports',
    'כיתות': 'Classes',
    'הגדרות': 'Settings',
    'מרכז עזרה': 'Help Center',
    'התנתקות': 'Log out',
    'שמור שינויים': 'Save Changes',
    'פרופיל': 'Profile',
    'התראות': 'Notifications',
    'אבטחה': 'Security',
    'מראה': 'Appearance',
    'פרטי הפרופיל אינם מלאים.': 'Profile details are incomplete.',
    'יש למלא את כל שדות האבטחה כדי לעדכן את העדפת הסיסמה.': 'Fill all security fields to update the password preference.',
    'הסיסמה החדשה ושדה האימות אינם תואמים.': 'New password and confirmation do not match.',
    'ההגדרות נשמרו מקומית.': 'Settings saved locally.',
    'פרטי פרופיל': 'Profile Information',
    'החלפת אווטאר': 'Change Avatar',
    'שם פרטי': 'First Name',
    'שם משפחה': 'Last Name',
    'כתובת דוא"ל': 'Email Address',
    'בית ספר / ארגון': 'School / Organization',
    'העדפות התראות': 'Notification Preferences',
    'עדכוני מייל על פיצרים חדשים': 'Email updates on new features',
    'דוחות שבועיים על ביצועי הכיתה': 'Weekly class performance reports',
    'התראות על הצטרפות תלמידים': 'Student join alerts',
    'מיילים שיווקיים וקידומיים': 'Marketing and promotional emails',
    'הגדרות אבטחה': 'Security Settings',
    'בגרסת הדמו הזו ההעדפה נשמרת מקומית. כדי לאכוף שינויי סיסמה צריך לחבר מנגנון הזדהות אמיתי.': 'This demo saves the preference locally. Connect a real auth backend to enforce password changes.',
    'סיסמה נוכחית': 'Current Password',
    'סיסמה חדשה': 'New Password',
    'אימות סיסמה חדשה': 'Confirm New Password',
    'מראה ושפה': 'Appearance',
    'ערכת העיצוב ושפת הממשק נשמרות מקומית עבור סביבת המורה שלך.': 'Theme and interface language are stored locally for your teacher workspace.',
    'ערכת עיצוב': 'Theme',
    'העדפת ערכת העיצוב נשמרת, וניתן לחבר אותה בהמשך למתג גלובלי.': 'Theme preference is stored and can be wired into a global theme switch later.',
    'בהיר': 'Light',
    'כהה': 'Dark',
    'שפת ממשק': 'Interface Language',
    'בחר אם מסך ההגדרות של המורה יוצג באנגלית או בעברית.': 'Choose whether this teacher settings interface is shown in English or Hebrew.',
    'בחר אם מסך ההגדרות של המורה יוצג באנגלית, בעברית או בערבית.': 'Choose whether this teacher settings interface is shown in English, Hebrew, or Arabic.',
    'אנגלית': 'English',
    'עברית': 'Hebrew',
    'ערבית': 'Arabic',
    'בודק גישת מורה...': 'Checking teacher access...',
  },
  ar: {
    'יצירת חידון': 'إنشاء اختبار',
    'החידונים שלי': 'اختباراتي',
    'גילוי': 'استكشاف',
    'דוחות': 'التقارير',
    'כיתות': 'الصفوف',
    'הגדרות': 'الإعدادات',
    'מרכז עזרה': 'مركز المساعدة',
    'התנתקות': 'تسجيل الخروج',
    'שמור שינויים': 'حفظ التغييرات',
    'פרופיל': 'الملف الشخصي',
    'התראות': 'الإشعارات',
    'אבטחה': 'الأمان',
    'מראה': 'المظهر',
    'אנגלית': 'الإنجليزية',
    'עברית': 'العبرية',
    'ערבית': 'العربية',
    'בודק גישת מורה...': 'جار التحقق من وصول المعلّم...',
    'Are you sure you want to leave the game?': 'هل أنت متأكد أنك تريد مغادرة اللعبة؟',
    'Are you sure you want to end the game early?': 'هل أنت متأكد أنك تريد إنهاء اللعبة مبكرًا؟',
    'Are you sure you want to end practice early?': 'هل أنت متأكد أنك تريد إنهاء التدريب مبكرًا؟',
    'Failed to extract text from file': 'تعذر استخراج النص من الملف',
    'Failed to create adaptive game': 'تعذر إنشاء لعبة تكيفية',
    'Failed to join': 'فشل الانضمام',
  },
  he: {
    'Loading your personal dashboard...': 'טוען את לוח המחוונים האישי שלך...',
    'Student dashboard unavailable': 'לוח המחוונים של התלמיד אינו זמין',
    'No analytics were returned.': 'לא התקבלו נתוני ניתוח.',
    'Back Home': 'חזרה לעמוד הבית',
    'Student Command Center': 'מרכז הבקרה של התלמיד',
    'Latest game:': 'המשחק האחרון:',
    'Overall learning profile': 'פרופיל הלמידה הכולל',
    'Explore Packs': 'עיון בחבילות',
    'Start Adaptive Practice': 'התחל תרגול אדפטיבי',
    'Loading adaptive practice...': 'טוען את התרגול האדפטיבי...',
    'Practice did not load cleanly': 'התרגול לא נטען כראוי',
    'Something interrupted the adaptive practice flow.': 'משהו קטע את רצף התרגול האדפטיבי.',
    'Retry': 'נסה שוב',
    'Back to Dashboard': 'חזרה ללוח המחוונים',
    'complete': 'הושלם',
    'Your mastery scores have been updated and your progress signal has been refreshed.': 'ציוני השליטה שלך עודכנו ואות ההתקדמות שלך רוענן.',
    'Correct': 'נכונות',
    'Answered': 'נענו',
    'Accuracy': 'דיוק',
    'Adaptive Practice': 'תרגול אדפטיבי',
    'A short reset round built to make coming back easy.': 'סבב קצר שנועד לאפשר חזרה חלקה ובטוחה.',
    'A focused sprint aimed at the concepts where confidence is still fragile.': 'ספרינט ממוקד סביב המושגים שבהם תחושת הביטחון עדיין שברירית.',
    'A quick booster to keep your recent gains warm.': 'חיזוק קצר שנועד לשמר את ההתקדמות האחרונה.',
    'Adaptive practice built from your current mastery profile.': 'תרגול אדפטיבי שנבנה מתוך פרופיל השליטה הנוכחי שלך.',
    'Failed to load your adaptive practice set.': 'טעינת סט התרגול האדפטיבי שלך נכשלה.',
    'Your answer could not be submitted. Try again.': 'לא ניתן היה לשלוח את התשובה שלך. נסה שוב.',
    'Point your camera at the host QR code or barcode.': 'כוון את המצלמה אל קוד ה־QR או הברקוד של המורה.',
    'This browser cannot use the in-app scanner. You can still scan the host QR with your device camera or join with the PIN.': 'הדפדפן הזה לא תומך בסורק המובנה. עדיין אפשר לסרוק את קוד ה־QR של המורה דרך מצלמת המכשיר או להצטרף עם הקוד.',
    'This browser does not support automatic code scanning inside the app yet. Use the device camera on the host QR or join with the PIN.': 'הדפדפן הזה עדיין לא תומך בסריקה אוטומטית בתוך האפליקציה. אפשר להשתמש במצלמת המכשיר על קוד ה־QR של המורה או להצטרף עם הקוד.',
    'Detected session': 'זוהה סשן',
    'Joining now...': 'מצטרף עכשיו...',
    'Opening the camera...': 'פותח את המצלמה...',
    'Point the camera at the host QR code or barcode. We will fill the session PIN automatically.': 'כוון את המצלמה אל קוד ה־QR או הברקוד של המורה. נמלא את קוד הסשן אוטומטית.',
    'Camera access is blocked. Allow camera access and try again, or scan the host QR with your device camera.': 'הגישה למצלמה חסומה. אפשר גישה למצלמה ונסה שוב, או סרוק את קוד ה־QR של המורה באמצעות מצלמת המכשיר.',
    'The scanner could not start on this device. You can still use the host QR externally or join with the PIN.': 'לא ניתן היה להפעיל את הסורק במכשיר הזה. עדיין אפשר להשתמש בקוד ה־QR של המורה מחוץ לאפליקציה או להצטרף עם הקוד.',
    'Quick Join Scanner': 'סורק הצטרפות מהירה',
    'Scan the host code and we will pull the session in automatically.': 'סרוק את הקוד של המורה ואנחנו נמשוך את הסשן אוטומטית.',
    'Close scanner': 'סגור סורק',
    'Camera access is blocked.': 'הגישה למצלמה חסומה.',
    'Automatic scan is not available here.': 'הסריקה האוטומטית אינה זמינה כאן.',
    'Use the device camera on the host QR, or go back and type the PIN manually.': 'אפשר להשתמש במצלמת המכשיר על קוד ה־QR של המורה, או לחזור ולהקליד את הקוד ידנית.',
    'Lobby soundtrack': 'פסקול הלובי',
    'Game soundtrack': 'פסקול המשחק',
    'Music muted': 'המוזיקה מושתקת',
    'Enable lobby music': 'הפעל את מוזיקת הלובי',
    'Enable game music': 'הפעל את מוזיקת המשחק',
    'Not run yet': 'טרם הופעל',
    'Recently': 'לאחרונה',
    'Just now': 'הרגע',
    'No answers yet': 'עדיין אין תשובות',
    'Imported your previous local classes into the live workspace.': 'ייבאנו את הכיתות המקומיות הקודמות שלך אל סביבת העבודה החיה.',
    'Failed to load classes.': 'טעינת הכיתות נכשלה.',
    'Failed to load packs.': 'טעינת החבילות נכשלה.',
    'Imported Class': 'כיתה מיובאת',
    'Failed to save class.': 'שמירת הכיתה נכשלה.',
    'Failed to remove class.': 'מחיקת הכיתה נכשלה.',
    'Failed to add student.': 'הוספת התלמיד נכשלה.',
    'Failed to remove student.': 'הסרת התלמיד נכשלה.',
    'Failed to start the live class.': 'הפעלת הכיתה החיה נכשלה.',
    'Failed to delete session.': 'מחיקת הסשן נכשלה.',
    'Failed to copy outreach note.': 'העתקת הודעת הפנייה נכשלה.',
    'Failed to build a rematch pack.': 'יצירת חבילת משחק חוזר נכשלה.',
    'Loading classes...': 'טוען כיתות...',
    'Loading pack editor...': 'טוען את עורך החבילה...',
    'Failed to load this pack for editing.': 'טעינת החבילה לעריכה נכשלה.',
    'Failed to read image file': 'קריאת קובץ התמונה נכשלה',
    'Failed to generate questions. Check your source material and try again.': 'יצירת השאלות נכשלה. בדוק את חומר המקור ונסה שוב.',
    'Pack title and at least one question are required.': 'נדרשים כותרת לחבילה ולפחות שאלה אחת.',
    'Failed to save pack': 'שמירת החבילה נכשלה',
    'Failed to save pack.': 'שמירת החבילה נכשלה.',
    'Failed to start live session': 'הפעלת הסשן החי נכשלה',
    'Failed to launch live session.': 'הפעלת הסשן החי נכשלה.',
    'Question images must be image files.': 'תמונות לשאלות חייבות להיות קובצי תמונה.',
    'Question images must be 3MB or smaller.': 'תמונות לשאלות חייבות להיות עד 3MB.',
    'Failed to attach question image.': 'צירוף תמונת השאלה נכשל.',
    'Mixed Formats': 'פורמטים מעורבים',
    'Level Mix (Recommended)': 'שילוב רמות מומלץ',
    'Primary endpoint failed, loaded fallback data.': 'נקודת הקצה הראשית נכשלה, נטענו נתוני גיבוי.',
    'Failed to load student analytics': 'טעינת ניתוח התלמיד נכשלה',
    'Failed to create adaptive game': 'יצירת המשחק האדפטיבי נכשלה',
    'Failed to copy support snapshot': 'העתקת תקציר התמיכה נכשלה',
    'Pack': 'חבילה',
    'Student': 'תלמיד',
    'Immediate targeted follow-up': 'מעקב מיידי וממוקד',
    'This learner shows a combination of low mastery and unstable decision patterns. A same-material adaptive game is recommended before the next assessment.': 'התלמיד מציג שילוב של שליטה נמוכה ודפוסי החלטה לא יציבים. מומלץ משחק אדפטיבי על אותו חומר לפני ההערכה הבאה.',
    'Reduce last-second overload': 'צמצום עומס בדקות הסיום',
    'Panic swaps were recorded. Reuse the same concept set with clearer distractors or slightly calmer pacing.': 'נרשמו החלפות בלחץ. מומלץ לחזור על אותו סט מושגים עם מסיחים ברורים יותר או בקצב מעט רגוע יותר.',
    'Watch attention stability': 'מעקב אחר יציבות הקשב',
    'The student left the active play context during the session. Keep the follow-up shorter and more tightly scaffolded.': 'התלמיד יצא מהקשר המשחק הפעיל במהלך הסשן. מומלץ להשאיר את ההמשך קצר ומובנה יותר.',
    'Participant authentication required': 'נדרש אימות משתתף',
    'Teacher Help Center': 'מרכז עזרה למורים',
    'Search product guides, reporting explanations and classroom workflows. Everything below is browsable and filterable.': 'חפש מדריכי מוצר, הסברים על דוחות וזרימות עבודה כיתתיות. כל מה שמופיע כאן ניתן לעיון ולסינון.',
    'Classes': 'כיתות',
    'Real class rosters, real pack assignments, and direct links into the live sessions and reports each class actually generated.': 'רשימות כיתה אמיתיות, שיוך חבילות בפועל וקישורים ישירים לסשנים החיים ולדוחות שכל כיתה באמת יצרה.',
    'Refresh Board': 'רענון לוח',
    'New Class': 'כיתה חדשה',
    'Classes did not load cleanly.': 'הכיתות לא נטענו כראוי.',
    'No classes matched this board.': 'לא נמצאו כיתות שמתאימות ללוח הזה.',
    'Class Builder': 'בונה כיתה',
    'Edit Class': 'עריכת כיתה',
    'Create Class': 'יצירת כיתה',
    'Search classes, students, subjects or assigned packs...': 'חפש כיתות, תלמידים, מקצועות או חבילות משויכות...',
    'Assigned Pack': 'חבילה משויכת',
    'No pack assigned yet': 'עדיין אין חבילה משויכת',
    'Color': 'צבע',
    'Notes': 'הערות',
    'Saving...': 'שומר...',
    'Reset': 'איפוס',
    'Room ready for students.': 'החדר מוכן לתלמידים.',
    'Waiting for students to join.': 'ממתין להצטרפות תלמידים.',
    'Teacher Help Center Search product guides, reporting explanations and classroom workflows. Everything below is browsable and filterable.': 'מרכז עזרה למורים חפש מדריכי מוצר, הסברים על דוחות וזרימות עבודה כיתתיות. כל מה שמופיע כאן ניתן לעיון ולסינון.',
    'Copy Support Snapshot': 'העתק תקציר תמיכה',
    'Snapshot Copied': 'התקציר הועתק',
    'Build And Host Adaptive Game': 'בנה וארח משחק אדפטיבי',
    'HIGH RISK': 'סיכון גבוה',
    'Design your questions or let AI help': 'תכנן את השאלות שלך או תן ל־AI לעזור',
    'Edit Quiz Pack': 'עריכת חבילת חידון',
    'Create Quiz Pack': 'יצירת חבילת חידון',
    'Refine questions, keep the classroom flow, and publish a safer revision when needed': 'חדד שאלות, שמור על זרימת הכיתה ופרסם גרסה בטוחה יותר בעת הצורך.',
    'Are you sure you want to leave the game?': 'האם אתה בטוח שברצונך לצאת מהמשחק?',
    'Are you sure you want to end the game early?': 'האם אתה בטוח שברצונך לסיים את המשחק מוקדם?',
    'Are you sure you want to end practice early?': 'האם אתה בטוח שברצונך לסיים את התרגול מוקדם?',
    'Failed to extract text from file': 'נכשל חילוץ הטקסט מהקובץ',
    'Failed to join': 'ההצטרפות נכשלה',
    'Pick an evidence-backed format fast. Every option still runs on the same 4-answer question model you already generate.': 'בחר פורמט מוכח במהירות. כל אפשרות עדיין פועלת על אותו מודל של שאלות אמריקאיות שאתה כבר מייצר.',
    'Quick picks for this pack': 'המלצות מהירות לחבילה זו',
    'Recommended now': 'מומלץ עכשיו',
    'High evidence': 'בסיס מחקרי חזק',
    'Field-tested': 'נבדק בשטח',
    'Selected format': 'הפורמט הנבחר',
    'Best for': 'הכי מתאים עבור',
    'Why it works': 'למה זה עובד',
    'Team Count': 'כמות קבוצות',
    'Teams': 'קבוצות',
    'Launch Setup': 'הגדרות הפעלה',
    'Evidence-backed': 'מבוסס ראיות',
    'Flexible format': 'פורמט גמיש',
    'Launch Format': 'פורמט הפעלה'
    ,
    'Reports': 'דוחות',
    'Refresh': 'רענון',
    'Recent Sessions': 'סשנים אחרונים',
    'Total Players': 'סך שחקנים',
    'Avg Accuracy': 'דיוק ממוצע',
    'Quizzes Hosted': 'חידונים שהורצו',
    'Avg Stress': 'לחץ ממוצע',
    'Across hosted sessions': 'בכלל הסשנים שהורצו',
    'Across tracked answers': 'על פני כל התשובות שנמדדו',
    'Sessions with activity': 'סשנים עם פעילות',
    'Behavior pressure index': 'מדד עומס התנהגותי',
    'Engine Insight': 'תובנת מנוע',
    'Quiz Name': 'שם החידון',
    'Date': 'תאריך',
    'Players': 'שחקנים',
    'Stress': 'לחץ',
    'Action': 'פעולה',
    'View': 'לצפייה',
    'Loading live reports...': 'טוען דוחות חיים...',
    'Deterministic performance summaries generated from answers and behavior telemetry.': 'סיכומי ביצועים דטרמיניסטיים המבוססים על תשובות וטלמטריית התנהגות.',
    'Deterministic summaries built from answers, timing, and behavior telemetry across your live sessions.': 'סיכומים דטרמיניסטיים המבוססים על תשובות, תזמון וטלמטריית התנהגות מכל הסשנים החיים שלך.',
    'Each row is derived from stored answers, timings and focus events.': 'כל שורה נגזרת מתשובות שמורות, זמני תגובה ואירועי פוקוס.',
    'Each row is derived from stored answers, timings, and focus events.': 'כל שורה נגזרת מתשובות שמורות, זמני תגובה ואירועי פוקוס.',
    'No completed sessions yet.': 'עדיין אין סשנים שהושלמו.',
    'Explore': 'גלה',
    'Discover': 'גלה',
    'For Teachers': 'למורים',
    'Contact Us': 'צור קשר',
    'Home': 'בית',
    'Discover High-Signal Packs': 'חבילות איכות לחקר מהיר',
    'Browse Filters': 'מסנני עיון',
    'Sort by': 'מיין לפי',
    'Concept clusters': 'אשכולות מושגים',
    'All concepts': 'כל המושגים',
    'Pack Atlas': 'אטלס החבילות',
    'Pack Intel': 'מודיעין חבילה',
    'Teaching Brief': 'תקציר הוראה',
    'Key points': 'נקודות מפתח',
    'Concept fingerprint': 'טביעת אצבע מושגית',
    'Open In Studio': 'פתח בסטודיו',
    'Open pack intel': 'פתח מודיעין חבילה',
    'Open Pack Intel': 'פתח מודיעין חבילה',
    'Teacher Access': 'כניסת מורה',
    'Create Similar': 'צור דומה',
    'Build New Pack': 'בנה חבילה חדשה',
    'Live Packs': 'חבילות פעילות',
    'Questions': 'שאלות',
    'Avg Token Save': 'חיסכון ממוצע בטוקנים',
    'Languages': 'שפות',
    'Featured Pack': 'חבילה נבחרת',
    'Token Save': 'חיסכון בטוקנים',
    'Words': 'מילים',
    'Language': 'שפה',
    'No packs matched this filter.': 'לא נמצאו חבילות לפי הסינון הזה.',
    'Try another concept, broader search, or reset the filters.': 'נסה מושג אחר, חיפוש רחב יותר, או אפס את המסננים.',
    'Discover is currently unavailable.': 'עמוד הגילוי אינו זמין כרגע.',
    'Newest': 'החדשים ביותר',
    'Most Questions': 'הכי הרבה שאלות',
    'Lean Prompt': 'פרומפט רזה',
    'Student Drill-Down': 'ניתוח עומק לתלמיד',
    'Fallback data loaded': 'נטענו נתוני גיבוי',
    'Loading personal dashboard...': 'טוען לוח אישי...',
    'Back to Class Analytics': 'חזרה לניתוח הכיתה',
    'Session-Specific Read': 'קריאת סשן ממוקדת',
    'Game Accuracy': 'דיוק במשחק',
    'Confidence': 'ביטחון',
    'Focus': 'ריכוז',
    'Game Vs Overall Baseline': 'המשחק מול קו הבסיס הכללי',
    'Accuracy Delta': 'פער דיוק',
    'Stress Delta': 'פער לחץ',
    'Confidence Delta': 'פער ביטחון',
    'Focus Delta': 'פער ריכוז',
    'Overall': 'כללי',
    'Teacher Recommendation': 'המלצת מורה',
    'Weakest Tags': 'תגיות חלשות',
    'Strongest Tags': 'תגיות חזקות',
    'Teacher Moves': 'מהלכי הוראה',
    'Decision Intelligence': 'אינטליגנציית החלטה',
    'Separate content knowledge from hesitation, revision quality, and last-second dependency.': 'הפרד בין שליטה בחומר לבין היסוס, איכות תיקון ותלות בשנייה האחרונה.',
    '1st Choice': 'בחירה ראשונה',
    'Recovered': 'התאושש',
    'Wrong Revision': 'תיקון מזיק',
    'Commit Latency': 'זמן לנעילה',
    'Deadline Dep.': 'תלות בדדליין',
    'Stability': 'יציבות',
    'Verified Correct': 'נכון מאומת',
    'Stayed Wrong': 'נשאר שגוי',
    'Recovery And Fatigue': 'התאוששות ועייפות',
    'Behavior Architecture': 'ארכיטקטורת התנהגות',
    "How this game's behavior compares to the student's longer-term baseline.": 'כך מתנהגות הבחירות במשחק הזה מול קו הבסיס ארוך-הטווח של התלמיד.',
    'Session Flow': 'זרימת הסשן',
    'Momentum': 'מומנטום',
    'Swaps': 'החלפות',
    'Panic Swaps': 'החלפות בלחץ',
    'Focus Loss': 'איבוד פוקוס',
    'Avg Idle': 'חוסר פעילות ממוצע',
    'Cross-Session Trajectory': 'מסלול בין סשנים',
    'No session history yet': 'עדיין אין היסטוריית סשנים',
    'Adaptive Game Studio': 'סטודיו למשחק אדפטיבי',
    'Strategy': 'אסטרטגיה',
    'Build And Host Now': 'בנה והפעל עכשיו',
    'Question-By-Question Lab': 'מעבדת שאלה-אחר-שאלה',
    'Attention Queue': 'תור תשומת לב',
    'Reteach this concept': 'ללמד מחדש את המושג',
    'Stabilize this concept': 'לייצב את המושג',
    'Pace': 'קצב',
    'Revision': 'תיקון',
    'Commit': 'נעילה',
    'Right': 'נכון',
    'Wrong': 'שגוי',
    'Yes': 'כן',
    'No': 'לא',
    'High': 'גבוה',
    'Normal': 'רגיל',
    'Choice Journey': 'מסלול בחירה',
    'First choice:': 'בחירה ראשונה:',
    'Final choice:': 'בחירה סופית:',
    'Started correct': 'התחיל נכון',
    'Started wrong': 'התחיל שגוי',
    'Verified': 'אומת',
    'No extra intervention signal was generated for this student.': 'לא נוצר כרגע אות התערבות נוסף עבור התלמיד הזה.',
    'No per-question chart data is available yet.': 'עדיין אין נתוני גרף לפי שאלה.',
    'No session history is available yet.': 'עדיין אין היסטוריית סשנים.',
    'No revision-category chart is available for this run.': 'אין עדיין גרף קטגוריות תיקון לסשן הזה.',
    'No question status data is available yet.': 'עדיין אין נתוני סטטוס לשאלות.',
    'No mastery chart is available yet.': 'עדיין אין גרף שליטה זמין.',
    'Volatility': 'תנודתיות',
    'Response': 'זמן תגובה',
    'Highest stress': 'הלחץ הגבוה ביותר',
    'Most volatile': 'התנודתיות הגבוהה ביותר',
    'Slowest response': 'התגובה האיטית ביותר',
    'Score': 'ציון',
    'Stable': 'יציב',
    'Shaky': 'מהוסס',
    'Missed': 'שגוי',
    'of questions': 'מהשאלות',
    'Input mix': 'תמהיל קלט',
    'Commit styles': 'סגנונות נעילה',
    'Pace distribution': 'התפלגות קצב',
    'Commit style distribution': 'התפלגות סגנונות נעילה',
    'Signal Distribution': 'התפלגות אותות',
    'Accuracy bands': 'טווחי דיוק',
    'Stress bands': 'טווחי לחץ',
    'Risk bands': 'טווחי סיכון',
    'Choice distribution': 'התפלגות בחירות',
    'Distractor Heatmap': 'מפת חום למסיחים',
    'Top distractor': 'המסיח המרכזי',
    'Secondary distractor': 'מסיח משני',
    'Correct answer': 'התשובה הנכונה',
    'Back to Reports': 'חזרה לדוחות',
    'Getting Started': 'צעדים ראשונים',
    'Onboarding': 'התחלה',
    'Understanding Analytics': 'הבנת הניתוחים',
    'Classroom Workflows': 'זרימות עבודה כיתתיות',
    'Tutorials': 'הדרכות',
    'Support Channels': 'ערוצי תמיכה',
    'Support': 'תמיכה',
    'Create your first pack, host a session and read the first results.': 'צור את החבילה הראשונה שלך, ארח סשן וקרא את התוצאות הראשונות.',
    'Interpret confidence, swaps, panic changes and focus warnings.': 'למד לפרש ביטחון, החלפות תשובה, שינויי לחץ ואזהרות קשב.',
    'Recommended flows for starting fast with multiple classes.': 'תהליכים מומלצים להתחלה מהירה עם כמה כיתות במקביל.',
    'Know when to use Help Center versus Contact Support.': 'מתי להשתמש במרכז העזרה ומתי לפנות ישירות לתמיכה.',
    'Start in Create Quiz, upload material, generate questions, save the pack and host it from the dashboard. After a live session ends, open Reports or the class analytics screen for behavioral breakdowns.': 'התחל במסך יצירת השאלון, העלה חומרי לימוד, צור שאלות, שמור את החבילה וארח אותה מלוח הבקרה. אחרי שסשן חי מסתיים אפשר לפתוח את הדוחות או את מסך ניתוח הכיתה כדי לראות פירוק התנהגותי מלא.',
    'Stress is derived from hesitation, answer swaps, panic changes and focus loss. High confusion alerts usually indicate unclear wording or weak prior knowledge. Use the adaptive practice recommendations right after the session.': 'מדד הלחץ נגזר מהיסוס, החלפות תשובה, שינויים בלחץ ואובדן מיקוד. התרעות בלבול גבוה בדרך כלל מעידות על ניסוח לא ברור או על ידע קודם חלש. מומלץ להפעיל את התרגול האדפטיבי מיד אחרי הסשן.',
    'Create one pack per unit, assign it to a class, and reuse the same class side panel to add students or jump back to the most recent relevant report. This keeps reporting tied to real activity without rebuilding class state every time.': 'צור חבילה אחת לכל יחידת לימוד, שייך אותה לכיתה, והשתמש שוב בפאנל הצד של אותה כיתה כדי להוסיף תלמידים או לחזור ישירות לדוח האחרון והרלוונטי. כך הדיווח נשאר מחובר לפעילות האמיתית בלי לבנות מחדש את מצב הכיתה בכל פעם.',
    'Use the Help Center for self-serve setup, reports and product behavior. Use Contact Support for billing, deployments, integrations or anything that needs a human follow-up.': 'השתמש במרכז העזרה עבור הגדרה עצמית, דוחות והתנהגות המוצר. השתמש ביצירת קשר עם התמיכה עבור חיוב, פריסות, אינטגרציות או כל דבר שדורש המשך טיפול אנושי.',
    'Frequently Asked Questions': 'שאלות נפוצות',
    'Selected Guide': 'המדריך הנבחר',
    'Recent Support Requests': 'פניות תמיכה אחרונות',
    'No guides matched this search.': 'לא נמצאו מדריכים שמתאימים לחיפוש הזה.',
    'No FAQ matched this search.': 'לא נמצאו שאלות נפוצות שמתאימות לחיפוש הזה.',
    'No contact requests have been sent from this browser yet.': 'עדיין לא נשלחו פניות תמיכה מהדפדפן הזה.',
    'Contact Support': 'פנה לתמיכה',
    'ACTIVE CLASSES': 'כיתות פעילות',
    'Live rosters that persist across sessions and reports.': 'רשימות חיות שנשמרות בין סשנים ודוחות.',
    'STUDENTS TRACKED': 'תלמידים במעקב',
    'Roster members tied to your current class structure.': 'חברי הרשימה שמשויכים למבנה הכיתה הנוכחי שלך.',
    'Student Account Coverage': 'כיסוי חשבונות תלמידים',
    'See which rostered students are already linked to a persistent student profile.': 'ראה אילו תלמידים ברשימות הכיתה כבר מחוברים לפרופיל תלמיד קבוע ומתמשך.',
    'This block helps you spot which classes are ready for longitudinal analytics, which students still need to claim an account, and where the board is still relying on session-only reads.': 'הבלוק הזה עוזר לך לזהות אילו כיתות כבר מוכנות לאנליטיקות אורכיות, אילו תלמידים עדיין צריכים לדרוש חשבון, ואיפה הלוח עדיין נשען על קריאה של סשן בודד בלבד.',
    'Open Classes': 'פתח כיתות',
    'Rostered students': 'תלמידים ברוסטר',
    'Across linked class rosters': 'על פני כל רשימות הכיתה המחוברות',
    'Linked Students': 'תלמידים מקושרים',
    'claim coverage': 'כיסוי שיוך',
    'Ready to claim': 'מוכנים לדרישה',
    'Students have an email on the roster but no claimed account yet': 'לתלמידים האלה כבר יש מייל ברשימת הכיתה, אבל עדיין אין להם חשבון שנדרש בפועל.',
    'Classes need attention': 'כיתות שדורשות תשומת לב',
    'Some roster members are still missing an email address': 'לחלק מחברי הרוסטר עדיין חסרה כתובת מייל.',
    'Focus these classes first': 'כדאי להתחיל עם הכיתות האלה קודם',
    'linked': 'מקושרים',
    'missing emails': 'ללא מייל',
    'No classes yet. Add a class to start syncing student accounts with teacher analytics.': 'עדיין אין כיתות. הוסף כיתה כדי להתחיל לסנכרן חשבונות תלמידים עם אנליטיקות המרצה.',
    'Account linked': 'חשבון מקושר',
    'Unclaimed roster': 'רוסטר לא נדרש',
    'Roster matched': 'רוסטר תואם',
    'Session-only': 'סשן בלבד',
    'CLASSES WITH PACK': 'כיתות עם חבילה',
    'Classes that can launch directly into a live session.': 'כיתות שאפשר להפעיל מהן ישירות סשן חי.',
    'WATCHLIST': 'רשימת מעקב',
    'Classes with recent attendance, outreach, or pacing signals.': 'כיתות עם אותות עדכניים של נוכחות, פנייה או קצב.',
    'Loading...': 'טוען...',
    'Pack editor': 'עורך החבילה',
    'This quiz could not be opened for editing.': 'לא ניתן היה לפתוח את החידון הזה לעריכה.',
    'Academic Context': 'הקשר אקדמי',
    'Metadata mapping': 'מיפוי מטא־דאטה',
    'Pack Title': 'כותרת החבילה',
    'e.g. Molecular Biology Quiz': 'למשל: חידון בביולוגיה מולקולרית',
    'Teaching notes & framing...': 'הערות הוראה והקשר...',
    'Gen Parameters': 'פרמטרים ליצירה',
    'AI Tuning': 'כיוונון AI',
    'Question Count': 'כמות שאלות',
    'Difficulty': 'רמת קושי',
    'Items': 'פריטים',
    'Easy': 'קל',
    'Medium': 'בינוני',
    'Classic': 'קלאסי',
    'Advanced Tuning': 'כיוונון מתקדם',
    'Question Style': 'סגנון שאלה',
    'Multiple Choice': 'בחירה מרובה',
    'True / False Only': 'נכון / לא נכון בלבד',
    'Knowledge Depth': 'עומק ידע',
    'Foundational': 'בסיסי',
    'Higher Order Thinking': 'חשיבה מסדר גבוה',
    'Explanations': 'הסברים',
    'Concise Tips': 'טיפים קצרים',
    'Academic Detail': 'פירוט אקדמי',
    'Content Portal': 'פורטל תוכן',
    'UPLOAD DOC': 'העלה קובץ',
    'Feed the AI intelligence': 'הזן את מנוע ה־AI',
    'Drop course materials, slides, or paste core text directly here.': 'גרור חומרי לימוד, שקופיות או הדבק כאן את הטקסט המרכזי ישירות.',
    'Paste material here...': 'הדבק כאן חומר...',
    'Design Board': 'לוח עריכה',
    '+ Add Manually': '+ הוסף ידנית',
    'No questions in board yet.': 'עדיין אין שאלות בלוח.',
    'Enter your question prompt...': 'הזן את נוסח השאלה...',
    'Launch Pad': 'עמדת הפעלה',
    'Discover visibility': 'נראות בגילוי',
    'This pack can appear in Discover': 'החבילה הזו יכולה להופיע בגילוי',
    'This pack stays private by default': 'החבילה הזו נשארת פרטית כברירת מחדל',
    'Selected Format': 'הפורמט הנבחר',
    'Reuse Intelligence': 'שימוש חוזר חכם',
    'Import strong questions from your library': 'ייבא שאלות חזקות מהספרייה שלך',
    'Mission Context': 'הקשר המשימה',
    'Practice Strategy': 'אסטרטגיית תרגול',
    'Adaptive target': 'יעד אדפטיבי',
    'Exit Practice': 'יציאה מהתרגול',
    'No data returned.': 'לא חזרו נתונים.',
    'Fast guesser': 'מנחש במהירות',
    'This learner needs targeted reinforcement before the next live game.': 'התלמיד הזה זקוק לחיזוק ממוקד לפני המשחק החי הבא.',
    'Teacher next move:': 'מהלך ההוראה הבא:',
    'Home / advisor note:': 'הערה לבית / ליועץ:',
    'support snapshot': 'תקציר תמיכה',
    'Recovery Profile': 'פרופיל התאוששות',
    'Deadline Profile': 'פרופיל לחץ זמן',
    'Fatigue Drift': 'שחיקת עייפות',
    'Pattern': 'דפוס',
    'Early Accuracy': 'דיוק בתחילת הסשן',
    'Late Accuracy': 'דיוק בסיום הסשן',
    'Resp Delta': 'פער תגובה',
    'Volatility Delta': 'פער תנודתיות',
    'Pressure Errors': 'שגיאות תחת לחץ',
    'Last-second Success': 'הצלחה ברגע האחרון',
    'Topic behavior profile': 'פרופיל התנהגות לפי נושא',
    'Repeated misconception pattern': 'דפוס שגיאה חוזר',
    'No repeated distractor pattern rose above the minimum confidence threshold.': 'לא זוהה דפוס מסיחים חוזר שעבר את סף הביטחון המינימלי.',
    'Momentum, fatigue, and pressure across the opening, middle, and closing of the game.': 'מומנטום, עייפות ולחץ לאורך פתיחת המשחק, אמצעו וסיומו.',
    'Stress ': 'לחץ ',
    'Whether this session is an anomaly or part of a longer pattern.': 'האם הסשן הזה חריג או חלק מדפוס מתמשך יותר.',
    'Commit Window': 'חלון נעילה',
    'Focus Events': 'אירועי פוקוס',
    'Adaptive same-material follow-up': 'המשך אדפטיבי על אותו חומר',
    'Question ': 'שאלה ',
    'Flip-Flops': 'שינויי כיוון',
    'Revisits': 'חזרות',
    'Deadline Buffer': 'מרווח לפני דדליין',
    'Healthy session': 'סשן יציב',
    'No unstable questions were detected in this game.': 'לא זוהו שאלות לא יציבות במשחק הזה.',
    'Class Position': 'מיקום בכיתה',
    'Rank #': 'מקום #',
    'in this session': 'בסשן הזה',
    'Class Stress': 'לחץ כיתתי',
    'Student Score': 'ציון תלמיד',
    'READY': 'מוכן',
    'ROOM READY': 'החדר מוכן',
    'ROOM PIN': 'קוד החדר',
    'Keep this code visible so students can join.': 'השאר את הקוד הזה גלוי כדי שהתלמידים יוכלו להצטרף.',
    'Copy PIN': 'העתק קוד',
    'Scan to join instantly': 'סרוק כדי להצטרף מיד',
    'PARTICIPANTS': 'משתתפים',
    'Who is in the room': 'מי נמצא בחדר',
    'Print Snapshot': 'הדפס תקציר',
    'HIGHRISK': 'סיכון גבוה',
    'This learner needs targeted reinforcement and pacing support. Use the weak-topic and session-pressure signals together. A student can know the material and still lose points through hesitation.': 'התלמיד הזה זקוק לחיזוק ממוקד ולתמיכה בקצב. מומלץ לשלב יחד את אותות הנושאים החלשים ואת אותות לחץ הסשן. תלמיד יכול להכיר את החומר ועדיין לאבד נקודות בגלל היסוס.',
    'Overall 0': 'כללי 0'
  },
};

function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function readStoredLanguage(): AppLanguage {
  if (!isBrowser()) return 'en';

  const direct = window.localStorage.getItem(APP_LANGUAGE_KEY);
  if (direct === 'ar') return 'ar';
  if (direct === 'he') return 'he';
  if (direct === 'en') return 'en';

  try {
    const raw = window.localStorage.getItem(TEACHER_SETTINGS_KEY);
    if (!raw) return 'en';
    const parsed = JSON.parse(raw) as { appearance?: { language?: string } };
    if (parsed?.appearance?.language === 'ar') return 'ar';
    return parsed?.appearance?.language === 'he' ? 'he' : 'en';
  } catch {
    return 'en';
  }
}

function writeStoredLanguage(language: AppLanguage) {
  if (!isBrowser()) return;
  window.localStorage.setItem(APP_LANGUAGE_KEY, language);

  try {
    const raw = window.localStorage.getItem(TEACHER_SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, any>) : {};
    parsed.appearance = {
      ...(parsed.appearance || {}),
      language,
    };
    window.localStorage.setItem(TEACHER_SETTINGS_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore malformed local storage state and keep the dedicated app key correct.
  }
}

export function readPreferredAppLanguage(): AppLanguage {
  return readStoredLanguage();
}

export function resolveAppLanguageDirection(language: AppLanguage): 'ltr' | 'rtl' {
  return language === 'en' ? 'ltr' : 'rtl';
}

export function translateAppUiString(language: AppLanguage, key: string, params?: Record<string, string>) {
  const bundle = UI_STRINGS[language] || UI_STRINGS.en;
  let text = bundle[key] || UI_STRINGS.en[key] || key;

  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(`{${k}}`, v);
    });
  }

  return text;
}

function loadCache(language: AppLanguage) {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(`${TRANSLATION_CACHE_PREFIX}.${language}`);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveCache(language: AppLanguage, cache: Record<string, string>) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(`${TRANSLATION_CACHE_PREFIX}.${language}`, JSON.stringify(cache));
  } catch {
    // Best effort cache only.
  }
}

function shouldIgnoreValue(value: string, language: AppLanguage) {
  const text = normalizeWhitespace(value);
  if (!text) return true;
  if (BRAND_EXACT_VALUES.has(text)) return true;
  if (/^[\d\s.,:%/()+\-–—#]+$/.test(text)) return true;
  if (/^(EN|HE|AR)$/.test(text)) return true;
  if (/^(https?:\/\/|www\.)/i.test(text)) return true;
  if (language === 'he' && HEBREW_CHARACTERS.test(text)) return true;
  if (language === 'ar' && ARABIC_CHARACTERS.test(text)) return true;
  if (language === 'en' && !HEBREW_CHARACTERS.test(text) && !ARABIC_CHARACTERS.test(text)) return true;
  return false;
}

function chunkTexts(texts: string[]) {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentSize = 0;

  for (const text of texts) {
    const candidateSize = currentSize + text.length + TRANSLATION_SEPARATOR.length;
    if (current.length > 0 && (candidateSize > 1600 || current.length >= 16)) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(text);
    currentSize += text.length + TRANSLATION_SEPARATOR.length;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

async function translateBatch(texts: string[], language: AppLanguage) {
  if (texts.length === 0) return [];
  const payload = await apiFetchJson<{ translations?: string[] }>('/api/translate', {
    method: 'POST',
    body: JSON.stringify({
      targetLanguage: language,
      texts,
    }),
  });
  return Array.isArray(payload.translations) ? payload.translations : texts;
}

function getTextTag(node: Node | null) {
  return node instanceof Element ? node.tagName : '';
}

export function AppLanguageProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [language, setLanguageState] = useState<AppLanguage>(() => readStoredLanguage());
  const translationCacheRef = useRef<Record<string, string>>(loadCache(readStoredLanguage()));
  const textRecordsRef = useRef(new WeakMap<Text, TranslationRecord>());
  const attributeRecordsRef = useRef(new WeakMap<Element, Map<string, TranslationRecord>>());
  const trackedTextNodesRef = useRef(new Set<Text>());
  const trackedElementsRef = useRef(new Set<Element>());
  const scanScheduledRef = useRef(false);
  const scanFrameRef = useRef<number | null>(null);
  const activeScanIdRef = useRef(0);
  const isApplyingTranslationsRef = useRef(false);
  const observerRef = useRef<MutationObserver | null>(null);

  const direction = resolveAppLanguageDirection(language);

  const setLanguage = (nextLanguage: AppLanguage) => {
    writeStoredLanguage(nextLanguage);
    translationCacheRef.current = loadCache(nextLanguage);
    setLanguageState(nextLanguage);
  };

  const ensureTextRecord = (node: Text) => {
    const currentValue = node.nodeValue || '';
    const existing = textRecordsRef.current.get(node);
    if (!existing) {
      const record: TranslationRecord = { original: currentValue };
      textRecordsRef.current.set(node, record);
      trackedTextNodesRef.current.add(node);
      return record;
    }

    if (currentValue !== existing.original && currentValue !== existing.translated) {
      existing.original = currentValue;
      existing.translated = undefined;
    }

    return existing;
  };

  const ensureAttributeRecord = (element: Element, attributeName: string) => {
    const currentValue = element.getAttribute(attributeName) || '';
    let records = attributeRecordsRef.current.get(element);
    if (!records) {
      records = new Map();
      attributeRecordsRef.current.set(element, records);
      trackedElementsRef.current.add(element);
    }

    const existing = records.get(attributeName);
    if (!existing) {
      const record: TranslationRecord = { original: currentValue };
      records.set(attributeName, record);
      return record;
    }

    if (currentValue !== existing.original && currentValue !== existing.translated) {
      existing.original = currentValue;
      existing.translated = undefined;
    }

    return existing;
  };

  const commitTranslationMutation = (apply: () => void) => {
    isApplyingTranslationsRef.current = true;

    try {
      apply();
    } finally {
      isApplyingTranslationsRef.current = false;
    }
  };

  const applyResolvedTranslations = (
    pendingTextNodes: Map<string, Text[]>,
    pendingAttributes: Map<string, Array<{ element: Element; attributeName: string }>>,
    resolveTranslation: (original: string) => string | undefined,
  ) => {
    commitTranslationMutation(() => {
      pendingTextNodes.forEach((nodes, original) => {
        const translated = resolveTranslation(original);
        if (!translated) return;

        nodes.forEach((node) => {
          if (!node.isConnected) return;
          const record = ensureTextRecord(node);
          record.original = record.original || original;
          record.translated = translated;
          if (node.nodeValue !== translated) {
            node.nodeValue = translated;
          }
        });
      });

      pendingAttributes.forEach((entries, original) => {
        const translated = resolveTranslation(original);
        if (!translated) return;

        entries.forEach(({ element, attributeName }) => {
          if (!element.isConnected) return;
          const record = ensureAttributeRecord(element, attributeName);
          record.original = record.original || original;
          record.translated = translated;
          if (element.getAttribute(attributeName) !== translated) {
            element.setAttribute(attributeName, translated);
          }
        });
      });
    });
  };

  const scanAndTranslate = async () => {
    scanScheduledRef.current = false;
    if (!isBrowser()) return;
    if (scanFrameRef.current != null) {
      window.cancelAnimationFrame(scanFrameRef.current);
      scanFrameRef.current = null;
    }
    const scanId = ++activeScanIdRef.current;
    const cacheForLanguage = { ...translationCacheRef.current };

    const pendingTextNodes = new Map<string, Text[]>();
    const pendingAttributes = new Map<string, Array<{ element: Element; attributeName: string }>>();

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[data-no-translate="true"]')) return NodeFilter.FILTER_REJECT;
        const tagName = getTextTag(parent).toUpperCase();
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'].includes(tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        const value = node.nodeValue || '';
        return shouldIgnoreValue(value, language) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const record = ensureTextRecord(node);
      const normalized = normalizeWhitespace(record.original);
      if (!normalized) continue;
      if (shouldIgnoreValue(record.original, language)) {
        record.translated = undefined;
        if (node.nodeValue !== record.original) {
          commitTranslationMutation(() => {
            node.nodeValue = record.original;
          });
        }
        continue;
      }
      if (record.translated && node.nodeValue === record.translated) continue;
      if (!pendingTextNodes.has(normalized)) {
        pendingTextNodes.set(normalized, []);
      }
      pendingTextNodes.get(normalized)!.push(node);
    }

    document.body.querySelectorAll<HTMLElement>('[placeholder], [title], [aria-label], [alt]').forEach((element) => {
      if (element.closest('[data-no-translate="true"]')) return;
      ATTRIBUTE_NAMES.forEach((attributeName) => {
        if (!element.hasAttribute(attributeName)) return;
        const record = ensureAttributeRecord(element, attributeName);
        const normalized = normalizeWhitespace(record.original);
        if (!normalized) return;
        if (shouldIgnoreValue(record.original, language)) {
          record.translated = undefined;
          if (element.getAttribute(attributeName) !== record.original) {
            commitTranslationMutation(() => {
              element.setAttribute(attributeName, record.original);
            });
          }
          return;
        }
        if (record.translated && element.getAttribute(attributeName) === record.translated) return;
        if (!pendingAttributes.has(normalized)) {
          pendingAttributes.set(normalized, []);
        }
        pendingAttributes.get(normalized)!.push({ element, attributeName });
      });
    });

    const uniqueTexts = Array.from(new Set([...pendingTextNodes.keys(), ...pendingAttributes.keys()]));
    const resolveKnownTranslation = (text: string) => RUNTIME_TRANSLATIONS[language][text] || cacheForLanguage[text];

    applyResolvedTranslations(pendingTextNodes, pendingAttributes, resolveKnownTranslation);

    const unresolved = uniqueTexts.filter((text) => !resolveKnownTranslation(text));
    if (unresolved.length === 0) return;

    const batches = chunkTexts(unresolved);
    const translatedBatches = await Promise.all(
      batches.map(async (batch) => {
        try {
          return await translateBatch(batch, language);
        } catch {
          // Do not cache the original text on API failure. This prevents "cache poisoning"
          // where temporary network or rate limit issues cause English text to be permanently
          // saved as translated UI copy in local storage.
          console.warn('Translation batch failed. Skipping cache injection to retry later.');
          return null;
        }
      }),
    );

    if (scanId !== activeScanIdRef.current) return;

    let resolvedAnyBatch = false;
    translatedBatches.forEach((translatedBatch, batchIndex) => {
      if (!translatedBatch) return;
      const batch = batches[batchIndex] || [];
      batch.forEach((text, index) => {
        cacheForLanguage[text] = translatedBatch[index] || text;
      });
      resolvedAnyBatch = true;
    });

    if (resolvedAnyBatch) {
      translationCacheRef.current = cacheForLanguage;
      saveCache(language, cacheForLanguage);
      applyResolvedTranslations(pendingTextNodes, pendingAttributes, (text) => RUNTIME_TRANSLATIONS[language][text] || cacheForLanguage[text]);
    }
  };

  const scheduleScan = (mode: 'deferred' | 'immediate' = 'deferred') => {
    if (!isBrowser()) return;

    if (mode === 'immediate') {
      if (scanFrameRef.current != null) {
        window.cancelAnimationFrame(scanFrameRef.current);
        scanFrameRef.current = null;
      }
      scanScheduledRef.current = false;
      void scanAndTranslate();
      return;
    }

    if (scanScheduledRef.current) return;
    scanScheduledRef.current = true;

    scanFrameRef.current = window.requestAnimationFrame(() => {
      scanFrameRef.current = null;
      void scanAndTranslate();
    });
  };

  useLayoutEffect(() => {
    if (!isBrowser()) return;
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
    document.body.dir = direction;
    translationCacheRef.current = loadCache(language);

    observerRef.current?.disconnect();
    observerRef.current = new MutationObserver(() => {
      if (isApplyingTranslationsRef.current) return;
      scheduleScan();
    });
    observerRef.current.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRIBUTE_NAMES as unknown as string[],
    });

    scheduleScan('immediate');

    return () => {
      if (scanFrameRef.current != null) {
        window.cancelAnimationFrame(scanFrameRef.current);
        scanFrameRef.current = null;
      }
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [direction, language]);

  useLayoutEffect(() => {
    scheduleScan('immediate');
  }, [location.key, location.pathname, location.search]);

  useEffect(() => {
    if (!isBrowser()) return;
    const nativeAlert = window.alert.bind(window);
    const nativeConfirm = window.confirm.bind(window);

    window.alert = (message?: string) => {
      if (typeof message !== 'string' || language === 'en') {
        nativeAlert(message);
        return;
      }
      nativeAlert(RUNTIME_TRANSLATIONS[language][message] || message);
    };

    window.confirm = (message?: string) => {
      if (typeof message !== 'string' || language === 'en') {
        return nativeConfirm(message);
      }
      return nativeConfirm(RUNTIME_TRANSLATIONS[language][message] || message);
    };

    return () => {
      window.alert = nativeAlert;
      window.confirm = nativeConfirm;
    };
  }, [language]);

  const t = (key: string, params?: Record<string, string>) => translateAppUiString(language, key, params);

  const value = useMemo<AppLanguageContextValue>(() => ({
    language,
    direction,
    setLanguage,
    t,
  }), [direction, language]);

  return <AppLanguageContext.Provider value={value}>{children}</AppLanguageContext.Provider>;
}

export function useAppLanguage() {
  const context = useContext(AppLanguageContext);
  if (!context) {
    throw new Error('useAppLanguage must be used within AppLanguageProvider');
  }
  return context;
}

export function useOptionalAppLanguage() {
  return useContext(AppLanguageContext);
}
