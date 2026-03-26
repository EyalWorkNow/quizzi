# ארכיטקטורה מקיפה לדף תלמיד וחשבון תלמיד

## מטרה

לבנות ל־Quizzi שכבת תלמיד מזוהה עם דוא"ל, כך שלתלמיד תהיה סביבת תלמיד אישית ומתמשכת, בלי לפגוע בזרימת ההצטרפות האנונימית המהירה בסגנון Kahoot.

המטרה היא לא רק "עוד דף", אלא שכבת זהות אמינה שמאפשרת:

- מעקב אמיתי לאורך זמן על אותו תלמיד
- שיוך אמין של תלמיד לכיתות ולמורים
- אנליטיקות מהימנות יותר
- תרגול אדפטיבי, זיכרון תלמיד, ומשחקי המשך על בסיס זהות יציבה
- חוויית תלמיד מקצועית עם כניסה, היסטוריה, משימות והתקדמות

## עקרונות תכנון

### 1. אנונימי נשאר קיים

הצטרפות עם `PIN + nickname` חייבת להישאר בדיוק כאופציה קיימת.

זו זרימת ההצטרפות המהירה.

### 2. חשבון תלמיד הוא שכבה נוספת

כניסה עם מייל היא לא תחליף לזרימה האנונימית, אלא שכבת Premium/Professional מעליה:

- תלמיד יכול להמשיך להצטרף אנונימית
- תלמיד יכול גם להתחבר לחשבון אישי
- אם תלמיד מחובר לחשבון, המערכת תחבר את המשחקים לחשבון שלו מאחורי הקלעים

### 3. nickname מפסיק להיות זהות

כיום הרבה מהלוגיקה נשענת על `nickname` ו־`identity_key`.

במערכת החדשה:

- `nickname` הוא רק שם תצוגה בתוך סשן
- הזהות האמיתית היא `student_user`
- גם `identity_key` נשאר חשוב, אבל רק כ־device/session identity או alias לחשבון

### 4. מעבר הדרגתי ולא שבירת המערכת

המערכת כבר בנויה היטב סביב:

- `participants`
- `identity_key`
- `student_memory_snapshots`
- `practice_attempts`
- `mastery`

לכן לא צריך לשכתב הכל. צריך להוסיף שכבת קנוניזציה וזהות מעל המודל הקיים.

## מצב קיים בקוד

### מה כבר יש היום

- תלמיד מצטרף דרך [Home.tsx](/Users/eyalatiya/Downloads/zip/src/client/pages/Home.tsx)
- ללקוח נוצר `identity_key` מקומי ב־[studentSession.ts](/Users/eyalatiya/Downloads/zip/src/client/lib/studentSession.ts)
- ההצטרפות לסשן נעשית דרך `POST /api/sessions/:pin/join` ב־[api.ts](/Users/eyalatiya/Downloads/zip/src/server/routes/api.ts)
- תלמיד מקבל `participant_token`
- לוח תלמיד קיים כבר ב־[StudentDashboard.tsx](/Users/eyalatiya/Downloads/zip/src/client/pages/StudentDashboard.tsx)
- אנליטיקות כלליות מבוססות על `identity_key` ב־`getOverallStudentAnalytics(...)`
- יש כבר `student_memory_snapshots`, `practice_attempts`, `mastery`

### איפה המודל הקיים לא מספיק

- אין `student account` אמיתי
- אין כניסת תלמיד עם דוא"ל
- אין שיוך אמין בין תלמיד כיתתי לבין חשבון אישי
- הכיתה מחזיקה רק `teacher_class_students.name`
- אין דרך טובה לעקוב אחרי אותו תלמיד אם הוא עבר מכשיר או שינה nickname
- `StudentDashboard` נשען על token של participant ולא על חשבון מתמשך

## החלטה ארכיטקטונית מרכזית

לא להשתמש בטבלת `users` הקיימת עבור תלמידים.

### למה

טבלת `users` היום משמשת בפועל מורים:

- `quiz_packs.teacher_id` מצביע ל־`users.id`
- שירותי `teacherUsers` ו־`demoAuth` מניחים ש־`users` היא טבלת מורים

אם נוסיף תלמידים לאותה טבלה, נכניס מורכבות וסיכון גבוה ל־queries קיימים.

### החלטה

ליצור מודל תלמיד נפרד:

- `student_users`
- `student_identity_links`

ובשלבים הבאים לקשור אותו ל־classes, participants, analytics.

## מודל הזהות החדש

### 1. Device Identity

נשאר קיים:

- `identity_key` מקומי כמו `stu_xxx`
- נוצר בלקוח
- משמש אנונימיים

### 2. Account Identity

לכל תלמיד עם חשבון תהיה זהות קנונית:

- `student_user_id`
- `account_identity_key` לדוגמה: `acct_42`

### 3. Identity Link / Alias

כדי לאחד היסטוריה אנונימית עם חשבון:

- תלמיד נכנס עם מייל
- המערכת מזהה שיש במכשיר `identity_key` מקומי
- נוצרת קישוריות בין `stu_xxx` לבין `student_user_id`

כך אפשר לאחד:

- `mastery`
- `practice_attempts`
- `student_memory_snapshots`
- `participants`
- `answers`

בלי למחוק היסטוריה ישנה.

## סכמת נתונים מומלצת

### טבלה חדשה: `student_users`

מטרת הטבלה: חשבון תלמיד קנוני.

שדות מומלצים:

- `id`
- `email`
- `password_hash`
- `display_name`
- `first_name`
- `last_name`
- `avatar_url`
- `preferred_language`
- `status`
- `email_verified_at`
- `last_login_at`
- `created_at`
- `updated_at`

### טבלה חדשה: `student_identity_links`

מטרת הטבלה: למפות בין כמה `identity_key` לבין אותו תלמיד.

שדות מומלצים:

- `id`
- `student_user_id`
- `identity_key`
- `source`
  `anonymous_device`, `claimed_device`, `account_join`, `teacher_merge`
- `is_primary`
- `created_at`
- `updated_at`

### הרחבה לטבלה: `teacher_class_students`

הטבלה כיום שומרת רק שם. זה לא מספיק לניהול אמין לאורך זמן.

להוסיף:

- `email`
- `student_user_id`
- `external_student_key`
- `invite_status`
  `none`, `invited`, `claimed`
- `claimed_at`
- `last_seen_at`

### הרחבה לטבלה: `participants`

להוסיף:

- `student_user_id`
- `class_student_id`
- `join_mode`
  `anonymous`, `account`, `claimed_anonymous`
- `display_name_snapshot`

### הרחבה אופציונלית לטבלאות אנליטיות

לא חובה בשלב הראשון, אבל מומלץ:

- `mastery.student_user_id`
- `practice_attempts.student_user_id`
- `student_memory_snapshots.student_user_id`

בשלב ראשון אפשר גם להמשיך לעבוד דרך `identity_key` בלבד, כל עוד יש טבלת alias טובה.

## מודל הרשאות וסשן

### חשבון תלמיד

להוסיף Cookie/Session נפרד, בדומה למורה:

- Cookie: `quizzi_student_session`
- שירות שרת חדש: `studentAuth.ts`
- שירות משתמשים חדש: `studentUsers.ts`

### Endpoints חדשים

- `POST /api/student-auth/register`
- `POST /api/student-auth/login`
- `POST /api/student-auth/logout`
- `GET /api/student-auth/session`

### בחירת מודל התחברות

למימוש הכי מהיר ויציב עכשיו:

- Email + Password

לשלב עתידי:

- Magic Link
- OTP למייל
- Google sign-in לתלמידים

## זרימות משתמש

### זרימה 1: תלמיד אנונימי

נשארת כפי שהיא היום:

1. נכנס לדף הבית
2. מזין PIN + nickname
3. מקבל `participant_token`
4. משחק
5. יכול לראות דף תלמיד זמני לפי token/device

### זרימה 2: תלמיד עם חשבון

1. נכנס ל־`/student/auth`
2. נרשם או מתחבר עם מייל
3. נוצר `quizzi_student_session`
4. עובר ל־`/student/me`
5. יכול להצטרף לסשן דרך PIN כמו תמיד
6. אם הוא מחובר, השרת מחבר את ההשתתפות ל־`student_user_id`

### זרימה 3: תלמיד עם עבר אנונימי שהתחבר עכשיו

1. במכשיר כבר קיים `identity_key`
2. התלמיד יוצר חשבון או מתחבר
3. השרת מזהה את `identity_key`
4. נוצר link ב־`student_identity_links`
5. הפורטל מציג את כל ההיסטוריה המאוחדת

### זרימה 4: תלמיד משויך לכיתה על ידי מורה

1. המורה מוסיף תלמיד לרשימת כיתה עם שם + מייל
2. כשהתלמיד נרשם עם אותו מייל, ה־roster row ננעל עליו
3. המורה רואה `claimed`
4. מכאן אפשר לעקוב אחרי התקדמות התלמיד ברמה אמינה יותר

## שינויים נדרשים ב־Join Flow

### ה־Join Flow לא ישתנה חזותית

בדף הבית נשמור:

- `PIN`
- `nickname`
- לחצן הצטרפות מהירה

### אבל מתחת למכסה המנוע נוסיף

אם יש `student session` פעיל:

- הלקוח עדיין שולח `identity_key`
- השרת בודק גם `student session`
- אם התלמיד מחובר:
  - השרת קובע `student_user_id`
  - השרת משתמש בזהות קנונית של החשבון
  - השרת שומר את ה־participant כשייך לחשבון

### סדר קדימות לזהות

1. אם יש `student session` תקף: החשבון קובע
2. אחרת אם יש `identity_key` מקומי: משתמשים בו
3. אחרת מייצרים `identity_key`

## דף התלמיד החדש

### Route מומלץ

- `GET /student/me`

### עמודים משלימים

- `/student/auth`
- `/student/me`
- `/student/me/classes`
- `/student/me/history`
- `/student/me/practice`

בשלב ראשון מספיק:

- `/student/auth`
- `/student/me`

### מה חייב להופיע בדף תלמיד

#### 1. Hero ברור

- שלום + שם תלמיד
- הכיתה/כיתות שלו
- מה המשימה הבאה
- חיווי אם יש משחק חי שאפשר לחזור אליו

#### 2. שורה תחתונה

- איפה הוא עומד עכשיו
- מה השתפר
- מה דורש חיזוק

#### 3. התקדמות לאורך זמן

- דיוק לאורך סשנים
- יציבות
- לחץ
- התאוששות אחרי טעויות

#### 4. מוקדי חיזוק

- מושגים חלשים
- שאלות שצריך לפתוח מחדש
- תרגול אדפטיבי מוכן

#### 5. כיתות וחבילות

- לאיזו כיתה הוא משויך
- מה החבילה האחרונה
- מה תרגילי ההמשך שמחכים לו

#### 6. היסטוריית עבודה

- סשנים אחרונים
- תרגול אחרון
- רצף פעילות

## שינויים נדרשים בצד מורה

### Teacher Classes

במסך [TeacherClasses.tsx](/Users/eyalatiya/Downloads/zip/src/client/pages/TeacherClasses.tsx):

- כל תלמיד ברשימה יקבל גם מייל
- יוצג סטטוס:
  `anonymous`, `invited`, `claimed`, `active recently`
- אפשר יהיה לחפש לפי שם או מייל

### אנליטיקות כיתה

במסך [TeacherAnalytics.tsx](/Users/eyalatiya/Downloads/zip/src/client/pages/TeacherAnalytics.tsx):

- לזהות מי תלמיד מזוהה ומי אנונימי
- להראות אם הנתונים של תלמיד "אמינים לאורך זמן" או מבוססי session בלבד
- לתת למורה לראות מי עוד לא claim חשבון

### אנליטיקות תלמיד

במסך [TeacherStudentAnalytics.tsx](/Users/eyalatiya/Downloads/zip/src/client/pages/TeacherStudentAnalytics.tsx):

- להראות אם מדובר בתלמיד account-based או session-only
- להבדיל בין:
  - `session data only`
  - `linked longitudinal profile`

## רפקטור נדרש באנליטיקות

### הבעיה היום

`getOverallStudentAnalytics(...)` עובד על `identityKey` יחיד.

זה לא מספיק כשאותו תלמיד:

- שיחק פעם אנונימי
- אחר כך יצר חשבון
- החליף מכשיר

### הכיוון החדש

לעבור ממודל:

- `identityKey: string`

למודל:

- `studentUserId?: number`
- `identityKeys: string[]`

### לוגיקת איסוף

אם יש `student_user_id`:

1. אוספים את כל ה־identity keys המקושרים
2. קוראים את כל:
   - participants
   - answers
   - mastery
   - practice_attempts
   - memory snapshots
3. בונים dashboard מאוחד

אם אין `student_user_id`:

- fallback ל־identity_key יחיד כמו היום

## API חדש מומלץ

### Student Auth

- `POST /api/student-auth/register`
- `POST /api/student-auth/login`
- `POST /api/student-auth/logout`
- `GET /api/student-auth/session`

### Student Portal

- `GET /api/student/me`
- `GET /api/student/me/classes`
- `GET /api/student/me/history`
- `GET /api/student/me/recommendations`
- `POST /api/student/me/claim-device-history`

### Teacher Roster / Student Linking

- הרחבת `POST /api/teacher/classes/:id/students`
- הרחבת `PUT /api/teacher/classes/:id`
- `POST /api/teacher/classes/:id/students/import`
- `POST /api/teacher/classes/:id/students/:studentId/send-invite`

### Join

להרחיב:

- `POST /api/sessions/:pin/join`

כדי שיקבל גם student account context מאחורי הקלעים.

## עקרונות אבטחה ופרטיות

### עקרון מינימום מידע

לא לשמור כרגע:

- תאריך לידה
- טלפון
- כתובת

כן לשמור:

- מייל
- שם תצוגה
- שיוך לכיתה
- נתוני למידה

### גישה לנתונים

- תלמיד רואה רק את הנתונים של עצמו
- מורה רואה רק תלמידים בכיתות/סשנים שלו
- participant token ממשיך לאשר רק גישה session-based
- student session מאשר גישה לחשבון אישי

### מיזוג זהויות

מיזוג בין זהות אנונימית לחשבון חייב להיות reversible או לפחות audit-friendly.

מומלץ לשמור:

- מי קישר
- מתי
- מאיזה מקור

## שלבי מימוש מומלצים

## שלב 1: Foundation

מימוש שאפשר לבנות עכשיו בלי לשבור את הקיים:

- טבלאות `student_users` ו־`student_identity_links`
- auth תלמיד בסיסי עם email/password
- cookie `quizzi_student_session`
- דף `StudentAuth`
- route `GET /student/me`

### תוצאה

יש חשבון תלמיד אמיתי.

## שלב 2: Student Portal

- דף תלמיד חדש
- endpoint `GET /api/student/me`
- איחוד היסטוריה לפי identity links
- חיבור ל־student memory + practice + session history

### תוצאה

יש סביבת תלמיד אמיתית, לא רק dashboard מקרי לפי nickname.

## שלב 3: Join Integration

- הרחבת `/sessions/:pin/join`
- שיוך participant לחשבון
- auto-claim של identity device

### תוצאה

אותו תלמיד מקבל היסטוריה אמינה יותר לאורך זמן.

## שלב 4: Teacher-Class Linking

- להוסיף email לרשימת תלמידים
- claimed status
- שידוך בין roster ל־student account

### תוצאה

הכיתה נהיית entity אמיתית, לא רק רשימת שמות.

## שלב 5: Polished Longitudinal Analytics

- refactor ל־analytics aggregation
- timeline אמיתי לפי תלמיד
- data trust יותר חזק

### תוצאה

אנליטיקות ברמת מוסד, כיתה ותלמיד נהיות הרבה יותר אמינות.

## מה אני יכול לבנות עכשיו מקצה לקצה

על הבסיס הקיים אני יכול לבנות עכשיו בצורה ריאלית:

### 1. חשבון תלמיד בסיסי

- הרשמה
- התחברות
- התנתקות
- session cookie

### 2. דף תלמיד חדש

- `StudentAuth`
- `StudentPortal`
- route חדש ב־App

### 3. שילוב עם ה־Join הקיים

- תלמיד מחובר יצטרף לאותו סשן כמו היום
- אבל ההשתתפות תסומן כשייכת לחשבון

### 4. שיוך anonymous history לחשבון

- קישור אוטומטי של device identity לחשבון תלמיד

### 5. הרחבת roster של כיתה

- שם + מייל + claimed status

## מה לא הייתי עושה בשלב הראשון

כדי לשמור על מימוש נקי ומהיר, לא הייתי דוחף עכשיו:

- magic link
- parent accounts
- multi-tenant school admin
- external SIS sync
- password reset במייל

אלה מעולים, אבל לא שלב ראשון.

## קבצים שכמעט בטוח יידרשו לשינוי

### שרת

- [api.ts](/Users/eyalatiya/Downloads/zip/src/server/routes/api.ts)
- [index.ts](/Users/eyalatiya/Downloads/zip/src/server/db/index.ts)
- [postgresSchema.ts](/Users/eyalatiya/Downloads/zip/src/server/db/postgresSchema.ts)

### שירותים חדשים

- `src/server/services/studentUsers.ts`
- `src/server/services/studentAuth.ts`
- `src/server/services/studentIdentityLinks.ts`

### לקוח

- [App.tsx](/Users/eyalatiya/Downloads/zip/src/App.tsx)
- [Home.tsx](/Users/eyalatiya/Downloads/zip/src/client/pages/Home.tsx)
- [StudentDashboard.tsx](/Users/eyalatiya/Downloads/zip/src/client/pages/StudentDashboard.tsx)
- [TeacherClasses.tsx](/Users/eyalatiya/Downloads/zip/src/client/pages/TeacherClasses.tsx)

### דפים חדשים

- `src/client/pages/StudentAuth.tsx`
- `src/client/pages/StudentPortal.tsx`
- `src/client/lib/studentAuth.ts`

## החלטת מוצר מומלצת

המסלול הכי נכון הוא:

1. לשמור על כניסה אנונימית מהירה
2. להוסיף כניסת תלמיד עם מייל כאופציה שנייה
3. להפוך את החשבון לשכבת זהות קנונית
4. לקשור את כל האנליטיקות והמעקב ארוך הטווח לחשבון הזה

כך נקבל:

- חוויית Kahoot מהירה למי שרוצה
- מערכת מקצועית אמיתית למעקב ארוך טווח למי שצריך

## שורה תחתונה

כן, דף תלמיד הוא לא רק רעיון טוב אלא שכבה כמעט הכרחית אם רוצים:

- ניהול אמין של תלמידים לאורך זמן
- אנליטיקות טובות באמת
- שיוך נכון לכיתה
- מעקב התקדמות מקצועי

והדרך הנכונה לממש אותו כאן היא לא להחליף את הזרימה האנונימית, אלא להוסיף מעליה שכבת `student account + linked identities + student portal`.
