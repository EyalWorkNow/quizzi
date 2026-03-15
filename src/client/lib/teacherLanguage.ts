import { useAppLanguage } from './appLanguage.tsx';

const TEACHER_LANGUAGE_COPY = {
  en: {
    nav: {
      createQuiz: 'Create Quiz',
      myQuizzes: 'My Quizzes',
      discover: 'Discover',
      reports: 'Reports',
      classes: 'Classes',
      settings: 'Settings',
      helpCenter: 'Help Center',
      logOut: 'Log out',
    },
    settings: {
      title: 'Settings',
      subtitle: 'Profile, notification and classroom preferences for your teacher workspace.',
      saveChanges: 'Save Changes',
      tabs: {
        profile: 'Profile',
        notifications: 'Notifications',
        security: 'Security',
        appearance: 'Appearance',
      },
      feedback: {
        profileIncomplete: 'Profile details are incomplete.',
        fillSecurity: 'Fill all security fields to update the password preference.',
        passwordsMismatch: 'New password and confirmation do not match.',
        saved: 'Settings saved locally.',
      },
      profile: {
        title: 'Profile Information',
        changeAvatar: 'Change Avatar',
        firstName: 'First Name',
        lastName: 'Last Name',
        email: 'Email Address',
        school: 'School / Organization',
      },
      notifications: {
        title: 'Notification Preferences',
        featureUpdates: 'Email updates on new features',
        weeklyReports: 'Weekly class performance reports',
        studentJoinAlerts: 'Student join alerts',
        marketingEmails: 'Marketing and promotional emails',
      },
      security: {
        title: 'Security Settings',
        description: 'This demo saves the preference locally. Connect a real auth backend to enforce password changes.',
        currentPassword: 'Current Password',
        newPassword: 'New Password',
        confirmPassword: 'Confirm New Password',
      },
      appearance: {
        title: 'Appearance',
        description: 'Theme and interface language are stored locally for your teacher workspace.',
        themeTitle: 'Theme',
        themeDescription: 'Theme preference is stored and can be wired into a global theme switch later.',
        light: 'Light',
        dark: 'Dark',
        languageTitle: 'Interface Language',
        languageDescription: 'Choose whether this teacher settings interface is shown in English or Hebrew.',
        english: 'English',
        hebrew: 'Hebrew',
      },
    },
  },
  he: {
    nav: {
      createQuiz: 'יצירת חידון',
      myQuizzes: 'החידונים שלי',
      discover: 'גילוי',
      reports: 'דוחות',
      classes: 'כיתות',
      settings: 'הגדרות',
      helpCenter: 'מרכז עזרה',
      logOut: 'התנתקות',
    },
    settings: {
      title: 'הגדרות',
      subtitle: 'העדפות פרופיל, התראות וכיתה עבור סביבת המורה שלך.',
      saveChanges: 'שמור שינויים',
      tabs: {
        profile: 'פרופיל',
        notifications: 'התראות',
        security: 'אבטחה',
        appearance: 'מראה',
      },
      feedback: {
        profileIncomplete: 'פרטי הפרופיל אינם מלאים.',
        fillSecurity: 'יש למלא את כל שדות האבטחה כדי לעדכן את העדפת הסיסמה.',
        passwordsMismatch: 'הסיסמה החדשה ושדה האימות אינם תואמים.',
        saved: 'ההגדרות נשמרו מקומית.',
      },
      profile: {
        title: 'פרטי פרופיל',
        changeAvatar: 'החלפת אווטאר',
        firstName: 'שם פרטי',
        lastName: 'שם משפחה',
        email: 'כתובת דוא"ל',
        school: 'בית ספר / ארגון',
      },
      notifications: {
        title: 'העדפות התראות',
        featureUpdates: 'עדכוני מייל על פיצרים חדשים',
        weeklyReports: 'דוחות שבועיים על ביצועי הכיתה',
        studentJoinAlerts: 'התראות על הצטרפות תלמידים',
        marketingEmails: 'מיילים שיווקיים וקידומיים',
      },
      security: {
        title: 'הגדרות אבטחה',
        description: 'בגרסת הדמו הזו ההעדפה נשמרת מקומית. כדי לאכוף שינויי סיסמה צריך לחבר מנגנון הזדהות אמיתי.',
        currentPassword: 'סיסמה נוכחית',
        newPassword: 'סיסמה חדשה',
        confirmPassword: 'אימות סיסמה חדשה',
      },
      appearance: {
        title: 'מראה ושפה',
        description: 'ערכת העיצוב ושפת הממשק נשמרות מקומית עבור סביבת המורה שלך.',
        themeTitle: 'ערכת עיצוב',
        themeDescription: 'העדפת ערכת העיצוב נשמרת, וניתן לחבר אותה בהמשך למתג גלובלי.',
        light: 'בהיר',
        dark: 'כהה',
        languageTitle: 'שפת ממשק',
        languageDescription: 'בחר אם מסך ההגדרות של המורה יוצג באנגלית או בעברית.',
        english: 'אנגלית',
        hebrew: 'עברית',
      },
    },
  },
} as const;

export function useTeacherLanguage() {
  const { language, direction } = useAppLanguage();
  return {
    language,
    direction,
    copy: TEACHER_LANGUAGE_COPY[language],
  };
}
