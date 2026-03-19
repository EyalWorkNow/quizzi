import { useMemo } from 'react';
import { useAppLanguage, type AppLanguage } from './appLanguage.tsx';

const EXACT_HEBREW_TRANSLATIONS: Record<string, string> = {
  'Loading class command center...': 'טוען את מרכז הפיקוד של הכיתה...',
  'Analytics unavailable': 'האנליטיקות אינן זמינות',
  'Failed to load analytics': 'טעינת האנליטיקות נכשלה',
  'No analytics payload was returned.': 'לא התקבל payload של אנליטיקות.',
  'Back to Reports': 'חזרה לדוחות',
  'Teacher Command Board': 'לוח הפיקוד של המורה',
  'Session analytics': 'אנליטיקות סשן',
  'Read the class state, locate the misconception, then decide who needs follow-up. This header is intentionally tuned for a fast teaching decision.':
    'קרא את מצב הכיתה, זהה את הטעות המרכזית, ואז החלט מי צריך מעקב. הכותרת הזו בנויה לקבלת החלטת הוראה מהירה.',
  Session: 'סשן',
  Status: 'סטטוס',
  Students: 'תלמידים',
  Questions: 'שאלות',
  Mode: 'מצב',
  'Research Rows': 'שורות מחקר',
  Unknown: 'לא ידוע',
  'Collapse header': 'כווץ כותרת',
  'Expand header': 'הרחב כותרת',
  Refresh: 'רענון',
  'Students CSV': 'CSV תלמידים',
  'Questions CSV': 'CSV שאלות',
  'LMS Gradebook CSV': 'CSV גיליון ציונים',
  'Teams CSV': 'CSV קבוצות',
  'Response Rows CSV': 'CSV שורות תשובה',
  'Class State': 'מצב הכיתה',
  'Top Issue': 'הבעיה המרכזית',
  'Suggested Action': 'פעולה מומלצת',
  'Teacher Workflow': 'זרימת העבודה של המורה',
  'What to do now': 'מה לעשות עכשיו',
  'Three fast moves for this class': 'שלושה צעדים מהירים לכיתה הזו',
  'Focus Mode': 'מצב מיקוד',
  'Simple View': 'תצוגה פשוטה',
  'Advanced View': 'תצוגה מתקדמת',
  'Make the board usable in under a minute': 'להפוך את הלוח לשמיש בפחות מדקה',
  'Simple view keeps the board focused on what to teach, who needs help, and which question to review first.':
    'התצוגה הפשוטה משאירה את הלוח ממוקד במה ללמד, מי צריך עזרה ואיזו שאלה לבדוק קודם.',
  'Advanced view opens the full research layer, detailed distributions, and export-oriented analytics.':
    'התצוגה המתקדמת פותחת את שכבת המחקר המלאה, התפלגויות מפורטות ואנליטיקות שמיועדות גם לייצוא.',
  'Advanced analysis is currently hidden': 'האנליזה המתקדמת מוסתרת כרגע',
  'Simple view is hiding deeper research charts, benchmarks, telemetry tables, and export-heavy diagnostics until you ask for them.':
    'התצוגה הפשוטה מסתירה כרגע גרפי מחקר עמוקים, בנצ׳מרקים, טבלאות טלמטריה ואבחונים כבדים לייצוא עד שתבקש אותם.',
  'Show advanced analysis': 'הצג אנליזה מתקדמת',
  'Quick Navigation': 'ניווט מהיר',
  'Jump to the next teaching decision instead of scanning the whole page.':
    'קפוץ ישירות להחלטת ההוראה הבאה במקום לסרוק את כל העמוד.',
  'Follow-Up': 'המשך',
  'Build the next round from this session': 'בנה את הסבב הבא מתוך הסשן הזה',
  'Follow-Up Engine': 'מנוע ההמשך',
  'Turn this session into the next lesson': 'הפוך את הסשן הזה לשיעור הבא',
  'Pick a ready-made follow-up path, create the pack, or open it live right now from the same analytics board.':
    'בחר מסלול המשך מוכן, צור את החבילה, או פתח אותה חי עכשיו מאותו לוח אנליטיקות.',
  'Focus Tags': 'תגיות מיקוד',
  'Priority Questions': 'שאלות בעדיפות',
  'Student Group': 'קבוצת תלמידים',
  'Create follow-up pack': 'צור חבילת המשך',
  'Create and host now': 'צור והפעל עכשיו',
  'Creating...': 'יוצר...',
  'Follow-up pack created.': 'חבילת ההמשך נוצרה.',
  'Failed to create follow-up pack.': 'יצירת חבילת ההמשך נכשלה.',
  'Whole class': 'כל הכיתה',
  'Target group': 'קבוצת יעד',
  'Confidence rebuild': 'בניית ביטחון מחדש',
  'Whole-Class Reset': 'איפוס כיתתי מלא',
  'Targeted Small Group': 'קבוצה קטנה ממוקדת',
  'Confidence Rebuild': 'חיזוק ביטחון',
  'Rebuild the weakest concept across the full class before the next live run.':
    'חזק מחדש את המושג החלש ביותר בכל הכיתה לפני ההפעלה החיה הבאה.',
  'Pull the highest-need students into a shorter reteach round with calmer pacing.':
    'אסוף את התלמידים שצריכים הכי הרבה עזרה לסבב הוראה מחדש קצר ורגוע יותר.',
  'Re-run the most unstable questions with tighter scaffolding and clearer commitment moments.':
    'הרץ מחדש את השאלות הפחות יציבות עם תמיכה הדוקה יותר ורגעי נעילה ברורים יותר.',
  Overview: 'סקירה',
  Advanced: 'מתקדם',
  'Class Decision': 'החלטה כיתתית',
  'Student Follow-Up': 'המשך לתלמיד',
  'Question Focus': 'מיקוד בשאלה',
  'Open the misconception block': 'פתח את בלוק הטעויות',
  'No student needs immediate follow-up': 'אין תלמיד שדורש כרגע מעקב מיידי',
  'The page is already simplified for a fast teaching read.': 'העמוד כבר מפושט לקריאה הוראתית מהירה.',
  'Jump to question diagnostics': 'קפוץ לאבחון השאלות',
  'No question hotspot has separated from the rest yet.': 'עדיין לא נוצר מוקד שאלה שבולט מעל השאר.',
  'Student Attention': 'תשומת לב לתלמידים',
  'See who needs teacher attention first': 'ראה קודם מי צריך את תשומת לב המורה',
  'Start with the student map and the attention queue. Open the advanced view for revision flow, timing curves, and the deeper research layer.':
    'התחל במפת התלמידים ובתור תשומת הלב. פתח את התצוגה המתקדמת כדי לראות זרימת שינויים, עקומות זמנים ושכבת מחקר עמוקה יותר.',
  'Step 1': 'שלב 1',
  'Step 2': 'שלב 2',
  'Step 3': 'שלב 3',
  'Immediate Read': 'קריאה מיידית',
  'Start with the verdict, not the telemetry': 'מתחילים מהמסקנה, לא מהטלמטריה',
  'This opening block is meant to answer three questions fast: what is happening in the class, what is driving it, and who needs teacher attention first.':
    'הבלוק הפותח נועד לענות מהר על שלוש שאלות: מה קורה בכיתה, מה מניע את זה, ומי צריך קודם את תשומת לב המורה.',
  'Executive Diagnosis': 'אבחון מנהלים',
  'Class snapshot ready': 'תמונת מצב הכיתה מוכנה',
  'We are loading the class narrative and will surface the strongest signal first.':
    'אנו טוענים את סיפור הכיתה ונציג קודם את האות החזק ביותר.',
  Diagnosis: 'אבחון',
  'Why It Matters': 'למה זה חשוב',
  'Recommended Move': 'מהלך מומלץ',
  'Who Needs Attention Now': 'מי צריך תשומת לב עכשיו',
  'Open these students first if you only have a minute.': 'אם יש לך רק דקה, פתח קודם את התלמידים האלה.',
  'No student queue has been produced yet.': 'עדיין לא נוצר תור תלמידים לטיפול.',
  'Critical Alert': 'התראה קריטית',
  'No urgent class-wide alert': 'אין כרגע התראה דחופה ברמת הכיתה',
  'The class does not currently show a single alert that outweighs the rest of the board.':
    'כרגע אין בכיתה התראה אחת שבולטת מעל שאר הלוח.',
  'Academic Mapping': 'מיפוי אקדמי',
  'Keep this session anchored to the course structure, not just the game.':
    'השאר את הסשן הזה מחובר למבנה הקורס, לא רק למשחק.',
  Course: 'קורס',
  Section: 'כיתה',
  Term: 'סמסטר',
  Week: 'שבוע',
  'Not set': 'לא הוגדר',
  'Learning outcomes': 'תוצרי למידה',
  'Bloom coverage': 'כיסוי בלום',
  'Cross-Section Comparison': 'השוואה בין קבוצות',
  'Pack scope': 'טווח החבילה',
  'Accuracy delta': 'פער דיוק',
  'Peer avg accuracy': 'דיוק ממוצע בקבוצות אחרות',
  'Peer avg attendance': 'נוכחות ממוצעת בקבוצות אחרות',
  Main: 'ראשי',
  'Current session': 'הסשן הנוכחי',
  'Unmapped session': 'סשן ללא מיפוי',
  'Instructional Diagnosis': 'אבחון הוראתי',
  'Turn the signal into a teaching move': 'הפוך את האות למהלך הוראה',
  'These sections prioritize verdicts, misconceptions, and revision behavior so the page answers what to reteach, what to slow down, and who to support.':
    'החלקים האלה נותנים עדיפות למסקנות, טעויות חוזרות והתנהגות שינוי תשובה, כדי שהדף יענה מה ללמד מחדש, איפה להאט, ובמי לתמוך.',
  'Decision Intelligence': 'אינטליגנציית החלטה',
  'Three verdicts first, then the evidence underneath.': 'קודם שלוש מסקנות, ואז הראיות שמתחתיהן.',
  'Recovery + Drift': 'התאוששות ושחיקה',
  'Recovery Rate': 'שיעור התאוששות',
  'Commit Window': 'חלון נעילה',
  'Early Accuracy': 'דיוק בתחילת הסשן',
  'Late Accuracy': 'דיוק בסוף הסשן',
  'So what?': 'אז מה זה אומר?',
  'No fatigue read yet': 'עדיין אין קריאת עייפות',
  'There are not enough rows yet to estimate drift.': 'עדיין אין מספיק שורות כדי לאמוד שחיקה.',
  'The main issue is not only fatigue.': 'הבעיה המרכזית היא לא רק עייפות.',
  'Some students fade as the session goes on.': 'חלק מהתלמידים דועכים ככל שהסשן מתקדם.',
  'Recurrent Misconceptions': 'תפיסות שגויות חוזרות',
  'Show the most instruction-worthy confusion clusters first.': 'הצג קודם את אשכולות הבלבול הכי חשובים להוראה.',
  'No misconception cluster repeated enough to outrank the rest.': 'אף אשכול טעות לא חזר מספיק כדי לבלוט מעל השאר.',
  Widespread: 'רחב היקף',
  Recurring: 'חוזר',
  Localized: 'מקומי',
  'Most Widespread': 'הנפוץ ביותר',
  'No repeated misconception cluster outran the noise floor.': 'אף אשכול טעות חוזר לא עבר את רף הרעש.',
  'Treat the weaker items as isolated question problems rather than one repeating class-wide misunderstanding.':
    'התייחס לפריטים החלשים כבעיות נקודתיות של שאלות, ולא כאי-הבנה כיתתית חוזרת.',
  'Keep the top three open by default so the page stays scannable.':
    'השאר את שלושת הראשונים פתוחים כברירת מחדל כדי שהדף יישאר סריק.',
  'Supporting Context': 'הקשר תומך',
  'Session context and attention signals': 'הקשר הסשן ואותות קשב',
  'Open this when you need the quiz format context or the raw attention telemetry behind the verdicts above.':
    'פתח את זה כשצריך את הקשר פורמט החידון או את טלמטריית הקשב הגולמית שמאחורי המסקנות למעלה.',
  'Session Context': 'הקשר הסשן',
  'Research cue': 'אות מחקרי',
  Teams: 'קבוצות',
  'Mode Type': 'סוג מצב',
  Group: 'קבוצתי',
  Solo: 'יחידני',
  Rows: 'שורות',
  'Attention Signals': 'אותות קשב',
  'Human-readable telemetry': 'טלמטריה קריאה לאדם',
  'Attention Drag': 'גרירת קשב',
  'Interaction / s': 'אינטראקציות / שנייה',
  'Hover Entropy': 'אנטרופיית ריחוף',
  'P75 Drag': 'גרירת P75',
  'Input mix': 'תמהיל קלט',
  'Commit styles': 'סגנונות נעילה',
  'Class Behavior': 'התנהגות כיתתית',
  'Read where the class bent under pressure': 'ראה היכן הכיתה נשברה תחת לחץ',
  'Use these charts after you know the misconception. They explain when the room destabilized, which students stayed resilient, and whether time pressure changed the outcome.':
    'השתמש בגרפים האלה אחרי שהבנת את הטעות המרכזית. הם מסבירים מתי הכיתה התערערה, אילו תלמידים נשארו יציבים, והאם לחץ זמן שינה את התוצאה.',
  'Decision Paths': 'מסלולי החלטה',
  'Decision Revision Flow': 'זרימת שינויי החלטה',
  Revised: 'שינו תשובה',
  'Locked Wrong': 'ננעלו על שגיאה',
  'Student Map': 'מפת תלמידים',
  'Student Pressure Scatter': 'פיזור לחץ תלמידים',
  'Each dot is one student. X = accuracy, Y = stress. The quadrants show who is stable, pressured, or drifting out of control.':
    'כל נקודה היא תלמיד אחד. X = דיוק, Y = לחץ. הרבעים מראים מי יציב, מי בלחץ, ומי מתחיל לאבד שליטה.',
  'High Risk': 'סיכון גבוה',
  Stable: 'יציב',
  'Session Dynamics': 'דינמיקת הסשן',
  'Question-by-question turning points for accuracy, stress, response time, and panic behavior.':
    'נקודות מפנה שאלה-אחר-שאלה עבור דיוק, לחץ, זמן תגובה והתנהגות פאניקה.',
  'Recovery Patterns': 'דפוסי התאוששות',
  'Fatigue / Drift Timeline': 'ציר זמן של עייפות / שחיקה',
  'Rolling accuracy, response time, and hesitation across the run of the game.':
    'דיוק מתגלגל, זמן תגובה והיסוס לאורך מהלך המשחק.',
  'Deadline Dependency Curve': 'עקומת תלות בדדליין',
  'Binned by remaining time, so you can see whether late decisions help or hurt.':
    'מחולק לפי הזמן שנותר, כדי לראות אם החלטות מאוחרות עוזרות או מזיקות.',
  'Deeper Read': 'קריאה עמוקה יותר',
  'Student drilldown and statistical detail': 'ניתוח עומק תלמיד ופרטים סטטיסטיים',
  'Open this layer when you need richer student context, correlation reads, or the slower diagnostic charts below.':
    'פתח את השכבה הזו כשצריך הקשר עשיר יותר על תלמידים, קריאות מתאם או את גרפי האבחון המפורטים למטה.',
  Stats: 'סטטיסטיקות',
  Correlations: 'מתאמים',
  'Descriptive Statistics': 'סטטיסטיקה תיאורית',
  'Mean, spread, and quartiles for the main instructional and behavioral signals in this session.':
    'ממוצע, פיזור ורבעונים עבור אותות ההוראה וההתנהגות המרכזיים בסשן הזה.',
  'Std Dev': 'סטיית תקן',
  Median: 'חציון',
  Range: 'טווח',
  'Correlation Lab': 'מעבדת מתאמים',
  'Selected Student': 'התלמיד הנבחר',
  'No student selected': 'לא נבחר תלמיד',
  Accuracy: 'דיוק',
  Stress: 'לחץ',
  Confidence: 'ביטחון',
  Focus: 'ריכוז',
  '1st Choice': 'בחירה ראשונה',
  Recovery: 'התאוששות',
  Commit: 'נעילה',
  Stability: 'יציבות',
  'Recommended move': 'מהלך מומלץ',
  'Open Personal Dashboard': 'פתח לוח אישי',
  'No student data available.': 'אין נתוני תלמיד זמינים.',
  'Commitment Behavior': 'התנהגות נעילה',
  'A histogram of commitment latency, so mean values do not hide different solving styles.':
    'היסטוגרמה של זמן עד נעילה, כדי שממוצעים לא יסתירו סגנונות פתרון שונים.',
  'Re-engagement Outcomes': 'תוצאות חזרה לקשב',
  'Whether quick or prolonged returns from blur actually hurt the class.':
    'האם חזרה מהירה או ממושכת מטשטוש/יציאה אכן פגעה בכיתה.',
  'Supporting Analysis': 'ניתוח תומך',
  'Benchmarks, clusters, and deeper telemetry': 'בנצ׳מרקים, אשכולות וטלמטריה עמוקה יותר',
  'Open this layer when you want the fuller statistical context behind the main read.':
    'פתח את השכבה הזו כשצריך את ההקשר הסטטיסטי המלא מאחורי הקריאה המרכזית.',
  Quartiles: 'רבעונים',
  Clusters: 'אשכולות',
  'Cohort Benchmarks': 'בנצ׳מרקים לקבוצה',
  'Behavior Research': 'מחקר התנהגות',
  'Pace distribution': 'התפלגות קצב',
  'Commit style distribution': 'התפלגות סגנונות נעילה',
  'Volatility Mean': 'ממוצע תנודתיות',
  'Median Commit': 'חציון נעילה',
  'Median Buffer': 'חציון מרווח זמן',
  'Clusters and Outliers': 'אשכולות וחריגים',
  'Team BI Board': 'לוח BI קבוצתי',
  Score: 'ציון',
  'Mode Bonus': 'בונוס מצב',
  Coverage: 'כיסוי',
  Consensus: 'קונצנזוס',
  'Student Telemetry Table': 'טבלת טלמטריה של תלמידים',
  Drag: 'גרירה',
  Blur: 'יציאה מפוקוס',
  Intensity: 'עוצמה',
  Entropy: 'אנטרופיה',
  'Concept Heatmap': 'מפת חום של מושגים',
  'These are the concept clusters that generated the weakest outcomes across the class.':
    'אלו אשכולות המושגים שהניבו את התוצאות החלשות ביותר בכיתה.',
  Concept: 'מושג',
  'Avg TFI': 'ממוצע TFI',
  Corrected: 'תוקן',
  'Wrong Revision': 'תיקון שגוי',
  Deadline: 'דדליין',
  Panic: 'פאניקה',
  'Teacher Alerts': 'התראות למורה',
  'No urgent class-level alerts were produced for this session.': 'לא הופקו התראות דחופות ברמת הכיתה עבור הסשן הזה.',
  'Signal Distribution': 'התפלגות אותות',
  'Accuracy bands': 'טווחי דיוק',
  'Stress bands': 'טווחי לחץ',
  'Risk bands': 'טווחי סיכון',
  'Question Diagnostics': 'אבחון שאלות',
  'Open with the hardest items first. The rest stay tucked behind a single click so the page keeps its hierarchy.':
    'התחל מהפריטים הקשים ביותר. השאר נשמרים מאחורי פתיחה אחת כדי לשמור על היררכיה ברורה בדף.',
  'Export Diagnostics CSV': 'ייצוא CSV של אבחון',
  Difficulty: 'קושי',
  Discrimination: 'הבחנה',
  Response: 'תגובה',
  'Top vs Bottom Gap': 'פער בין חזקים לחלשים',
  Recovered: 'התאושש',
  'Top distractor': 'המסיח המרכזי',
  'No single wrong option emerged as a dominant misconception on this question.':
    'אף אפשרות שגויה לא בלטה כטעות מרכזית בשאלה הזו.',
  'Choice distribution': 'התפלגות בחירות',
  'No single distractor dominated this item.': 'אף מסיח אחד לא שלט בפריט הזה.',
  'Distractor Heatmap': 'מפת חום למסיחים',
  'See whether errors are scattered or whether the same distractors are repeatedly seducing the class.':
    'בדוק אם הטעויות מפוזרות או שאותם מסיחים חוזרים שוב ושוב ומושכים את הכיתה.',
  'Question Pressure Map': 'מפת לחץ לפי שאלה',
  'Every item is scored on both mastery and behavioral pressure.':
    'כל פריט מדורג גם לפי שליטה בחומר וגם לפי לחץ התנהגותי.',
  'Attention Queue': 'תור תשומת לב',
  'Data Pack': 'חבילת נתונים',
  'Research export ready': 'ייצוא המחקר מוכן',
  'Exported response rows include timing, swaps, focus-loss, commit window, volatility, and question metadata so the session can be reused later for statistical analysis.':
    'שורות התשובות המיוצאות כוללות זמנים, החלפות, איבודי פוקוס, חלון נעילה, תנודתיות ומטא-נתוני שאלה, כך שאפשר יהיה לעשות שימוש חוזר בסשן לניתוח סטטיסטי בהמשך.',
  'Student Command Center': 'מרכז הפיקוד של התלמידים',
  'Select a student for quick insight, then drill into the personal dashboard to build a same-material follow-up game.':
    'בחר תלמיד כדי לקבל תובנה מהירה, ואז היכנס ללוח האישי כדי לבנות משחק המשך מאותו חומר.',
  'Open individual dashboard': 'פתח לוח תלמיד',
  'No sequence data available for this session.': 'אין נתוני רצף זמינים לסשן הזה.',
  'Lowest mastery moment': 'רגע השפל של השליטה',
  'Highest pressure point': 'נקודת הלחץ הגבוהה ביותר',
  'Strongest recovery': 'ההתאוששות החזקה ביותר',
  'Sharpest drop': 'הצניחה החדה ביותר',
  'Response Bars': 'עמודות תגובה',
  'Struggling + unstable': 'מתקשים ולא יציבים',
  'Pressured but correct': 'נכונים אבל בלחץ',
  'Quiet underperformance': 'ביצוע חסר שקט',
  'Stable high performers': 'חזקים ויציבים',
  'Wrong and visibly overloaded.': 'טועים ונראים מוצפים.',
  'Knows enough, but not calmly.': 'יודעים מספיק, אבל לא בנחת.',
  'Low mastery without overt stress.': 'שליטה נמוכה בלי לחץ בולט.',
  'Strong and under control.': 'חזקים ובשליטה.',
  Watch: 'למעקב',
  'Selected student': 'התלמיד הנבחר',
  'No choice-distribution data available.': 'אין נתוני התפלגות בחירה זמינים.',
  'No revision-flow data available yet.': 'עדיין אין נתוני זרימת תיקונים זמינים.',
  'Started Correct': 'התחילו נכון',
  'Started Wrong': 'התחילו שגוי',
  'Did Not Change': 'לא שינו',
  'Finished Correct': 'סיימו נכון',
  'Finished Wrong': 'סיימו שגוי',
  'First choice': 'בחירה ראשונה',
  Revision: 'שינוי תשובה',
  'Final answer': 'תשובה סופית',
  'Helpful path': 'מסלול מועיל',
  'Neutral path': 'מסלול ניטרלי',
  'Harmful path': 'מסלול מזיק',
  'Strong path': 'מסלול חזק',
  'Watch path': 'מסלול למעקב',
  'Risk path': 'מסלול סיכון',
  'A stronger instructional checkpoint.': 'זו נקודת ביקורת הוראתית חזקה יותר.',
  'Needs context to know whether the change helped.': 'צריך הקשר כדי להבין אם השינוי עזר.',
  'This path deserves the fastest teacher response.': 'המסלול הזה דורש את התגובה המהירה ביותר של המורה.',
  'No recovery transitions were available for this session.': 'לא היו מעברי התאוששות זמינים לסשן הזה.',
  'Students missed one item and recovered immediately on the next question.':
    'התלמידים טעו בפריט אחד והתאוששו מיד בשאלה הבאה.',
  'Students recovered, but only after a slower and less stable follow-up.':
    'התלמידים התאוששו, אבל רק אחרי המשך איטי ופחות יציב.',
  'The mistake carried into the next question with no visible reset.':
    'הטעות נמשכה גם לשאלה הבאה ללא איפוס נראה לעין.',
  'The post-error pattern escalated into non-response under pressure.':
    'דפוס שאחרי הטעות החמיר עד לאי-תגובה תחת לחץ.',
  'Students sped up after the error, but the faster move stayed wrong.':
    'אחרי הטעות התלמידים האיצו, אבל המהלך המהיר נשאר שגוי.',
  'No drift timeline is available yet.': 'עדיין אין ציר זמן של שחיקה.',
  'Rolling Accuracy': 'דיוק מתגלגל',
  'Rolling Response': 'תגובה מתגלגלת',
  'Rolling Hesitation': 'היסוס מתגלגל',
  'No deadline dependency data is available.': 'אין נתוני תלות בדדליין זמינים.',
  'Changed Answer': 'שינו תשובה',
  Volatility: 'תנודתיות',
  'No commitment-latency distribution is available yet.': 'עדיין אין התפלגות של זמן עד נעילה.',
  responses: 'תשובות',
  'No re-engagement pattern was detected in this session.': 'לא זוהה דפוס חזרה לקשב בסשן הזה.',
  'No distractor heatmap is available for this session.': 'אין מפת חום למסיחים עבור הסשן הזה.',
  'Correct key': 'התשובה הנכונה',
  'No option': 'אין אפשרות',
  'Secondary distractor': 'מסיח משני',
  'Correct answer': 'התשובה הנכונה',
  'No distribution data.': 'אין נתוני התפלגות.',
  'High confusion detected': 'זוהה בלבול גבוה',
  'Last-second switching spike': 'זינוק בהחלפות ברגע האחרון',
  'Focus instability in session': 'חוסר יציבות קשבי בסשן',
  'Students need targeted follow-up': 'תלמידים זקוקים להמשך ממוקד',
  'Low class mastery': 'שליטה כיתתית נמוכה',
  'Not all responses were captured': 'לא כל התשובות נקלטו',
  'Strong mastery with low friction': 'שליטה חזקה עם מעט חיכוך',
  'The class answered confidently and with stable decision patterns.':
    'הכיתה ענתה בביטחון ובדפוסי החלטה יציבים.',
  'Mixed mastery, review a few pressure points': 'שליטה מעורבת, כדאי לבדוק כמה נקודות לחץ',
  'Most students are on track, but a small set of questions produced hesitation.':
    'רוב התלמידים במסלול, אבל קבוצה קטנה של שאלות יצרה היסוס.',
  'Conceptual reset recommended': 'מומלץ לבצע איפוס מושגי',
  'Accuracy and behavior signals both indicate the class needs a guided recap before the next assessment.':
    'גם אותות הדיוק וגם אותות ההתנהגות מצביעים על כך שהכיתה צריכה חזרה מונחית לפני ההערכה הבאה.',
  'No session drift yet.': 'עדיין אין דפוס שחיקה בסשן.',
  'There are not enough answered questions to estimate fatigue drift.':
    'אין עדיין מספיק שאלות שנענו כדי להעריך שחיקה.',
  'Performance faded in the back half.': 'הביצוע נחלש בחצי השני.',
  'Later questions were less accurate and more effortful, which is consistent with fatigue or overload.':
    'השאלות המאוחרות היו פחות מדויקות ודרשו יותר מאמץ, דבר שתואם עייפות או עומס.',
  'Performance improved as the session progressed.': 'הביצוע השתפר ככל שהסשן התקדם.',
  'The later half was more accurate without a matching volatility spike, suggesting the learner settled in.':
    'החצי המאוחר היה מדויק יותר בלי עלייה מקבילה בתנודתיות, מה שמרמז שהתלמיד התייצב.',
  'Decision-making became more stable over time.': 'קבלת ההחלטות נעשתה יציבה יותר לאורך הזמן.',
  'Later questions showed calmer commitment patterns even without a large accuracy jump.':
    'השאלות המאוחרות הראו דפוסי נעילה רגועים יותר גם בלי קפיצה גדולה בדיוק.',
  'No strong fatigue drift emerged.': 'לא הופיעה שחיקה חזקה.',
  'Accuracy, pace, and volatility stayed within a relatively narrow band across the session.':
    'הדיוק, הקצב והתנודתיות נשארו בתוך טווח יחסית צר לאורך הסשן.',
  'Review the concept and simplify distractors before reusing this item.':
    'כדאי לחזור על המושג ולפשט את המסיחים לפני שמשתמשים שוב בפריט הזה.',
  'The class knew the concept but looked rushed. Keep it, but consider slightly more time.':
    'הכיתה ידעה את המושג אבל נראתה לחוצה. אפשר לשמור את הפריט, אך לשקול מעט יותר זמן.',
  'The question triggered visible disengagement. Consider splitting the prompt or shortening it.':
    'השאלה יצרה ניתוק גלוי. כדאי לשקול לפצל או לקצר את הניסוח.',
  'This item looks reusable without changes.': 'נראה שאפשר להשתמש שוב בפריט הזה בלי שינויים.',
  'Not enough data yet': 'עדיין אין מספיק נתונים',
  'Play one session to unlock your profile.': 'שחק סשן אחד כדי לפתוח את הפרופיל שלך.',
  'Once you answer real questions, the engine will map confidence, focus and pacing patterns.':
    'אחרי שתענה על שאלות אמיתיות, המנוע ימפה דפוסי ביטחון, ריכוז וקצב.',
  'Careful re-checker': 'בודק שוב בזהירות',
  'You think before you commit.': 'אתה חושב לפני שאתה ננעל.',
  'Your answers show deliberate thinking, but the extra re-checking is costing fluency. Aim to lock sooner when you already know the concept.':
    'התשובות שלך מראות חשיבה מכוונת, אבל הבדיקות החוזרות פוגעות בשטף. נסה להינעל מוקדם יותר כשאתה כבר יודע את המושג.',
  'Fast guesser': 'ממהר לנחש',
  'You move fast, sometimes too fast.': 'אתה מתקדם מהר, לפעמים מהר מדי.',
  'Your first click often arrives before the reasoning is settled. Pause for one more pass before locking.':
    'הלחיצה הראשונה שלך מגיעה לא פעם לפני שהחשיבה התייצבה. עצור לעוד מבט אחד לפני הנעילה.',
  'Decisive solver': 'פותר החלטי',
  'Your decisions look stable.': 'ההחלטות שלך נראות יציבות.',
  'You answer with high confidence and low friction. Keep that rhythm and push on weaker topics.':
    'אתה עונה בביטחון גבוה ובמעט חיכוך. שמור על הקצב הזה והמשך לעבוד על נושאים חלשים.',
  'Balanced solver': 'פותר מאוזן',
  'Your pace is mostly balanced.': 'הקצב שלך ברובו מאוזן.',
  'You are close to a steady pattern. Reducing answer swaps will improve both confidence and speed.':
    'אתה קרוב לדפוס יציב. הפחתת החלפות תשובה תשפר גם את הביטחון וגם את המהירות.',
  'Student accuracy': 'דיוק תלמיד',
  'Student stress index': 'מדד לחץ תלמיד',
  'Student focus score': 'ציון ריכוז תלמיד',
  'Student confidence': 'ביטחון תלמיד',
  'Response time': 'זמן תגובה',
  'Think-first interval': 'זמן חשיבה ראשוני',
  'First-choice correctness': 'נכונות בבחירה ראשונה',
  'Commitment latency': 'זמן עד נעילה',
  'Decision volatility': 'תנודתיות בהחלטה',
  'Interaction intensity': 'עוצמת אינטראקציה',
  'Option exploration entropy': 'אנטרופיית חקר אפשרויות',
  'Accuracy vs Stress': 'דיוק מול לחץ',
  'Accuracy vs Focus': 'דיוק מול ריכוז',
  'Accuracy vs Confidence': 'דיוק מול ביטחון',
  'Accuracy vs Response Time': 'דיוק מול זמן תגובה',
  'Score vs Stress': 'ציון מול לחץ',
  'Think Time vs Confidence': 'זמן חשיבה מול ביטחון',
  'Accuracy vs Blur Time': 'דיוק מול זמן יציאה מפוקוס',
  'Focus vs Attention Drag': 'ריכוז מול גרירת קשב',
  'Confidence vs Option Exploration': 'ביטחון מול חקר אפשרויות',
  strong: 'חזק',
  medium: 'בינוני',
  weak: 'חלש',
  positive: 'חיובי',
  negative: 'שלילי',
  flat: 'שטוח',
  'Stable Mastery': 'שליטה יציבה',
  'High accuracy with low pressure. These students can be stretched or used as peer anchors.':
    'דיוק גבוה עם לחץ נמוך. אפשר לאתגר את התלמידים האלה או להשתמש בהם כעוגנים לחברים.',
  'Accurate Under Pressure': 'מדויקים תחת לחץ',
  'Conceptual mastery is there, but behavior suggests high internal load while solving.':
    'השליטה המושגית קיימת, אבל ההתנהגות מצביעה על עומס פנימי גבוה בזמן הפתרון.',
  'Pressure Collapse': 'קריסה תחת לחץ',
  'Low accuracy and high stress suggest overload, fragile confidence, or unclear item design.':
    'דיוק נמוך ולחץ גבוה מצביעים על עומס, ביטחון שברירי או ניסוח לא ברור של הפריט.',
  'Focus Fragile': 'ריכוז שברירי',
  'Performance is likely being dragged down by unstable attention more than content alone.':
    'נראה שהביצוע נפגע יותר בגלל קשב לא יציב מאשר רק בגלל התוכן.',
  'Developing Middle': 'אמצע מתפתח',
  'These students are in the mixed middle: partially on track, but not yet behaviorally stable.':
    'התלמידים האלה נמצאים באמצע המעורב: חלקית על המסלול, אבל עדיין לא יציבים התנהגותית.',
  'Highest stress student': 'התלמיד עם הלחץ הגבוה ביותר',
  'Lowest accuracy student': 'התלמיד עם הדיוק הנמוך ביותר',
  'Slowest average responder': 'המגיב האיטי ביותר בממוצע',
  'Focus drift outlier': 'חריגת שחיקת קשב',
  'Most difficult item': 'הפריט הקשה ביותר',
  'Highest pressure item': 'הפריט עם הלחץ הגבוה ביותר',
  'Strongest relationship': 'הקשר החזק ביותר',
  'This item had the lowest class accuracy and is the strongest reteach candidate.':
    'לפריט הזה היה הדיוק הכיתתי הנמוך ביותר והוא המועמד החזק ביותר ללימוד מחדש.',
  'This item produced the strongest hesitation/focus pressure combination.':
    'הפריט הזה יצר את השילוב החזק ביותר של היסוס ולחץ קשבי.',
  'Top quartile': 'הרבעון העליון',
  'Middle band': 'הטווח האמצעי',
  'Bottom quartile': 'הרבעון התחתון',
  Pointer: 'עכבר',
  Keyboard: 'מקלדת',
  Touch: 'מגע',
  rapid: 'מהיר',
  steady: 'יציב',
  extended: 'ממושך',
  'last-moment': 'רגע אחרון',
  'active-checking': 'בדיקה פעילה',
  'locked-early': 'נעילה מוקדמת',
  'Correct locked in': 'ננעל נכון',
  'Correct verified': 'אומת כנכון',
  'Correct to incorrect': 'מנכון לשגוי',
  'Incorrect to correct': 'משגוי לנכון',
  'Incorrect to incorrect': 'משגוי לשגוי',
  'No focus loss': 'ללא איבוד פוקוס',
  'Quick return': 'חזרה מהירה',
  'Prolonged return': 'חזרה ממושכת',
  'Error -> Correct': 'טעות -> נכון',
  'Error -> Error': 'טעות -> טעות',
  'Error -> Deadline Wrong': 'טעות -> שגיאה תחת דדליין',
  'Error -> Rushed Wrong': 'טעות -> שגיאה מואצת',
  'Error -> Hesitant Correct': 'טעות -> נכון מהוסס',
  'No class-wide issue rose above the current threshold.': 'לא עלתה כרגע בעיה כיתתית שעברה את הסף.',
  'No single issue dominates the board': 'אין כרגע בעיה אחת ששולטת בלוח',
  'Stable mastery, low friction': 'שליטה יציבה עם מעט חיכוך',
  'Mixed confidence, high pressure': 'ביטחון מעורב ולחץ גבוה',
  'Mixed mastery, uneven confidence': 'שליטה מעורבת וביטחון לא אחיד',
  'Keep the next activity on the same track': 'השאר את הפעילות הבאה באותו כיוון',
  'The class is stable enough for a brief practice round without a full reset.':
    'הכיתה יציבה מספיק לסבב תרגול קצר בלי איפוס מלא.',
  'Pull a short targeted follow-up group': 'אסוף קבוצה קצרה להמשך ממוקד',
  'Intervene with the late-fading group': 'התערב מול הקבוצה שנחלשת מאוחר',
  'Students can recover, but too late for fluent mastery.': 'התלמידים מסוגלים להתאושש, אבל מאוחר מדי בשביל שליטה שוטפת.',
  'The class is not correcting itself reliably enough.': 'הכיתה לא מתקנת את עצמה באופן מספיק עקבי.',
  'Class-wide fatigue stayed limited, so the bigger teaching move is conceptual clarification plus calmer pacing.':
    'העייפות ברמת הכיתה נשארה מוגבלת, ולכן מהלך ההוראה המרכזי הוא הבהרה מושגית עם קצב רגוע יותר.',
  'Reteach the concept boundary across the repeated questions.': 'למד מחדש את גבול המושג על פני השאלות החוזרות.',
  'Keep the top trouble spots visible by default, and open the rest only when you need item-level follow-up.':
    'השאר את מוקדי הקושי הבולטים גלויים כברירת מחדל, ופתח את השאר רק כשצריך מעקב ברמת פריט.',
  signal: 'אות',
  high: 'גבוה',
  low: 'נמוך',
  'Stable cluster': 'אשכול יציב',
  'High accuracy without visible pressure drag.': 'דיוק גבוה בלי גרירת לחץ נראית לעין.',
  'Pressured correctors': 'מצליחים תחת לחץ',
  'Still right, but spending cognitive budget to get there.': 'עדיין נכונים, אבל משלמים מאמץ קוגניטיבי כדי להגיע לשם.',
  'Struggling unstable': 'מתקשים ולא יציבים',
  'Low accuracy with high pressure and likely collapse risk.': 'דיוק נמוך עם לחץ גבוה וסיכון סביר לקריסה.',
  'Not visibly stressed, but still landing wrong.': 'לא נראים לחוצים, אבל עדיין טועים.',
  'High/medium accuracy with controlled stress.': 'דיוק גבוה או בינוני עם לחץ בשליטה.',
  'Mixed profile that needs teacher attention.': 'פרופיל מעורב שדורש תשומת לב של המורה.',
  'Low mastery or high pressure collapse pattern.': 'שליטה נמוכה או דפוס קריסה תחת לחץ.',
  'First Choice': 'בחירה ראשונה',
  'Classic Quiz': 'חידון קלאסי',
  'Practice testing with immediate feedback': 'תרגול שליפה עם משוב מיידי',
  'Individual quiz flow with direct scoring, low friction, and the clearest path from question to feedback.':
    'זרימת חידון אישית עם ניקוד ישיר, מעט חיכוך והמסלול הברור ביותר משאלה למשוב.',
  'Rapid retrieval': 'שליפה מהירה',
  'Low setup overhead': 'מעט הכנה',
  'Clear individual ranking': 'דירוג אישי ברור',
  'Speed Sprint': 'ספרינט מהירות',
  'Repeated fast recall under short windows': 'שליפה מהירה חוזרת בחלונות זמן קצרים',
  'A compressed solo mode that shortens question windows so students retrieve from memory before they over-deliberate.':
    'מצב יחידני מהודק שמקצר את חלונות הזמן לשאלה, כך שהתלמידים נשלפים מהזיכרון לפני שהם חושבים יתר על המידה.',
  'Fast recall': 'שליפה מהירה',
  'High tempo': 'קצב גבוה',
  'Short attention cycles': 'מחזורי קשב קצרים',
  'Confidence Climb': 'טיפוס ביטחון',
  'Retrieval plus metacognitive confidence judgments': 'שליפה בשילוב שיפוט מטה-קוגניטיבי של ביטחון',
  'Adds a confidence step before submission so students practice recall and calibration together instead of guessing silently.':
    'מוסיף שלב של ביטחון לפני ההגשה, כך שהתלמידים מתרגלים שליפה וכיול במקום ניחוש שקט.',
  'Confidence calibration': 'כיול ביטחון',
  'Reflective retrieval': 'שליפה רפלקטיבית',
  'More deliberate lock-in': 'נעילה מכוונת יותר',
  'Peer Pods': 'פודים עמיתים',
  'Peer instruction with vote, discuss, revote': 'הוראת עמיתים עם הצבעה, דיון והצבעה חוזרת',
  'Small discussion pods first commit to an answer, then compare reasoning and submit a final revote after discussion.':
    'קבוצות דיון קטנות ננעלות קודם על תשובה, ואז משוות נימוקים ומגישות הצבעה סופית אחרי הדיון.',
  'Peer instruction': 'הוראת עמיתים',
  'Explanation-rich rounds': 'סבבים עתירי הסבר',
  'Revision after discussion': 'שינוי אחרי דיון',
  'Team Relay': 'שליחים קבוצתיים',
  'Collaborative retrieval and shared accountability': 'שליפה שיתופית ואחריות משותפת',
  'Students are auto-grouped into teams. The class still answers individually, but the live board and end-state feel team-first.':
    'התלמידים מחולקים אוטומטית לקבוצות. הכיתה עדיין עונה אישית, אבל הלוח החי והחוויה הסופית מרגישים קבוצתיים.',
  'Peer accountability': 'אחריות עמיתים',
  'Collective momentum': 'מומנטום קבוצתי',
  'Low-friction group play': 'משחק קבוצתי עם מעט חיכוך',
  'Mastery Matrix': 'מטריצת שליטה',
  'Interleaving and broad concept coverage': 'שזירה וכיסוי רחב של מושגים',
  'Team competition centered on concept coverage and weak-tag recovery, not only total score.':
    'תחרות קבוצתית שממוקדת בכיסוי מושגים ובהתאוששות על תגיות חלשות, לא רק בציון הכולל.',
  'Concept coverage': 'כיסוי מושגים',
  'Balanced mastery': 'שליטה מאוזנת',
  'Tag-level competition': 'תחרות ברמת תגיות',
  'On track': 'במסלול',
  'Below expected': 'מתחת למצופה',
  'Use this as the headline mastery read.': 'השתמש בזה כקריאת השליטה המרכזית.',
  'First Pass': 'מעבר ראשון',
  'Initial read is solid': 'הקריאה הראשונית טובה',
  'Low initial certainty': 'ודאות ראשונית נמוכה',
  'Harmful Revisions': 'תיקונים מזיקים',
  'Too many reversals': 'יש יותר מדי היפוכים',
  'Reversal rate is contained': 'שיעור ההיפוכים נשלט',
  'Pressure Load': 'עומס לחץ',
  'Most answers landed under pressure': 'רוב התשובות ניתנו תחת לחץ',
  'Pressure stayed limited': 'הלחץ נשאר מוגבל',
  'Focus Drag': 'גרירת קשב',
  'Class attention was unstable': 'קשב הכיתה היה לא יציב',
  'Attention mostly held': 'הקשב ברובו נשמר',
  'Full participation': 'השתתפות מלאה',
  'Some answers were missed': 'חלק מהתשובות הוחמצו',
  'Decision Quality': 'איכות החלטה',
  'Confidence Stability': 'יציבות ביטחון',
  'Revision Efficiency': 'יעילות תיקון',
  'Students usually knew it on the first pass': 'התלמידים בדרך כלל ידעו כבר בבחירה הראשונה',
  'Knowledge is arriving late, not early': 'הידע מגיע מאוחר, לא מוקדם',
  'Students are guessing before reasoning settles': 'התלמידים מנחשים לפני שהחשיבה מתייצבת',
  'Too many students talk themselves out of correct answers': 'יותר מדי תלמידים מוציאים את עצמם מתשובה נכונה',
  'Confidence wobbles, but outright reversals stay limited': 'הביטחון מתנדנד, אבל היפוכים מלאים נשארים מוגבלים',
  'Revisions help more than they hurt': 'השינויים עוזרים יותר משהם מזיקים',
  'Revisions are net helpful but still messy': 'השינויים עוזרים בסך הכול אבל עדיין מבולגנים',
  'Revisions are not rescuing enough of the class': 'השינויים לא מצילים מספיק מהכיתה',
  'Self-correction is visible, but it arrives late': 'התיקון העצמי קיים, אבל מגיע מאוחר',
  'Few students recover once they start wrong': 'מעט תלמידים מתאוששים אחרי התחלה שגויה',
  'Wrong-way revisions are high enough to merit intervention': 'תיקונים בכיוון שגוי גבוהים מספיק כדי להצדיק התערבות',
  'Wrong-way revisions stayed relatively contained': 'תיקונים בכיוון שגוי נשארו יחסית בשליטה',
  'Most choices were made under pressure, not from a calm commit window':
    'רוב הבחירות נעשו תחת לחץ, לא מתוך חלון נעילה רגוע',
  'Only a minority of answers were pressure-driven': 'רק מיעוט מהתשובות הונע מלחץ',
  'Positive revisions': 'תיקונים חיוביים',
  'Harmful revisions': 'תיקונים מזיקים',
  'Stable incorrect': 'שגוי יציב',
  'Stable correct': 'נכון יציב',
  'Attention remained under sustained drag': 'הקשב נשאר תחת גרירה מתמשכת',
  'Attention was mixed, not catastrophic': 'הקשב היה מעורב, אבל לא קרס',
  'Attention stayed relatively stable': 'הקשב נשאר יחסית יציב',
  'Students were very active before locking answers': 'התלמידים היו פעילים מאוד לפני הנעילה',
  'Interaction volume stayed measured': 'נפח האינטראקציה נשאר מדוד',
  'Option scanning widened on harder moments': 'סריקת האפשרויות התרחבה ברגעים קשים',
  'Option scanning stayed narrow': 'סריקת האפשרויות נשארה צרה',
  'No post-error transitions were captured in this run.': 'לא זוהו מעברים אחרי טעות בהרצה הזו.',
  ENDED: 'הסתיים',
  LOBBY: 'לובי',
  QUESTION_ACTIVE: 'שאלה פעילה',
  QUESTION_DISCUSSION: 'דיון על שאלה',
  QUESTION_REVOTE: 'הצבעה חוזרת',
};

type PatternRule = {
  pattern: RegExp;
  translate: (match: RegExpMatchArray) => string;
};

const HEBREW_PATTERN_RULES: PatternRule[] = [
  {
    pattern: /^Open (.+)$/,
    translate: ([, name]) => `פתח את ${name}`,
  },
  {
    pattern: /^Session #(\d+)$/,
    translate: ([, id]) => `סשן #${id}`,
  },
  {
    pattern: /^Show (\d+) additional misconception patterns$/,
    translate: ([, count]) => `הצג עוד ${count} דפוסי טעות`,
  },
  {
    pattern: /^Show (\d+) more question diagnostics$/,
    translate: ([, count]) => `הצג עוד ${count} אבחוני שאלות`,
  },
  {
    pattern: /^Compare this run against (\d+) prior session(s?) on the same (course code|pack)\.$/,
    translate: ([, count, _plural, basis]) =>
      `השווה את ההרצה הזו מול ${count} סשנים קודמים על אותו ${basis === 'course code' ? 'קוד קורס' : 'חבילה'}.`,
  },
  {
    pattern: /^Avg response (.+) • Session #(\d+)$/,
    translate: ([, duration, sessionId]) => `זמן תגובה ממוצע ${duration} • סשן #${sessionId}`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% accuracy$/,
    translate: ([, value]) => `${value}% דיוק`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% Accuracy$/,
    translate: ([, value]) => `${value}% דיוק`,
  },
  {
    pattern: /^(-?\d+(?:\.\d+)?) ?pts$/,
    translate: ([, value]) => `${value} נק׳`,
  },
  {
    pattern: /^(\d+) students$/,
    translate: ([, count]) => `${count} תלמידים`,
  },
  {
    pattern: /^(\d+) rows$/,
    translate: ([, count]) => `${count} שורות`,
  },
  {
    pattern: /^Q(\d+) dropped to (\d+(?:\.\d+)?)%\.$/,
    translate: ([, question, value]) => `שאלה ${question} ירדה ל-${value}%.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% later corrected themselves\.$/,
    translate: ([, value]) => `${value}% תיקנו את עצמם בהמשך.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% moved from correct to incorrect\.$/,
    translate: ([, value]) => `${value}% עברו מתשובה נכונה לשגויה.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% of pressured answers were still correct\.$/,
    translate: ([, value]) => `${value}% מהתשובות תחת לחץ עדיין היו נכונות.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?) focus events per student on average\.$/,
    translate: ([, value]) => `${value} אירועי פוקוס בממוצע לכל תלמיד.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% completion across (\d+) questions\.$/,
    translate: ([, rate, count]) => `${rate}% השלמה על פני ${count} שאלות.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% first-choice correctness with (\d+(?:\.\d+)?)% later self-correction\.$/,
    translate: ([, firstChoice, recovery]) => `${firstChoice}% נכונות בבחירה ראשונה עם ${recovery}% תיקון עצמי מאוחר יותר.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% ended wrong after touching the correct answer\. (\d+) panic swaps were logged\.$/,
    translate: ([, rate, swaps]) => `${rate}% סיימו בשגיאה אחרי שנגעו בתשובה הנכונה. נרשמו ${swaps} החלפות פאניקה.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% corrected a wrong start, while (\d+(?:\.\d+)?)% reversed away from the right answer\.$/,
    translate: ([, corrected, reversed]) => `${corrected}% תיקנו התחלה שגויה, בעוד ${reversed}% התרחקו מהתשובה הנכונה.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% improved after revision, but (\d+(?:\.\d+)?)% reversed from correct to incorrect\.$/,
    translate: ([, improved, reversed]) => `${improved}% השתפרו אחרי שינוי תשובה, אבל ${reversed}% עברו מנכון לשגוי.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% corrected a wrong start\. (\d+(?:\.\d+)?)% stayed wrong all the way through\.$/,
    translate: ([, recovered, stayedWrong]) => `${recovered}% תיקנו התחלה שגויה. ${stayedWrong}% נשארו שגויים עד הסוף.`,
  },
  {
    pattern: /^(\d+) of (\d+) responses corrected a wrong first move\.$/,
    translate: ([, count, total]) => `${count} מתוך ${total} תגובות תיקנו מהלך ראשון שגוי.`,
  },
  {
    pattern: /^(\d+) responses flipped away from a correct path\.$/,
    translate: ([, count]) => `${count} תגובות סטו ממסלול נכון.`,
  },
  {
    pattern: /^(\d+) responses landed under pressure\. (\d+(?:\.\d+)?)% of wrong answers happened there\.$/,
    translate: ([, count, rate]) => `${count} תגובות התקבלו תחת לחץ. ${rate}% מהתשובות השגויות קרו שם.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?) of (\d+) students were pulled to distractor ([A-Z?]) on Q(\d+)\.$/,
    translate: ([, count, total, label, question]) => `${count} מתוך ${total} תלמידים נמשכו למסיח ${label} בשאלה ${question}.`,
  },
  {
    pattern: /^Run a 2-minute reset on (.+)$/,
    translate: ([, topic]) => `בצע איפוס של שתי דקות על ${topic}`,
  },
  {
    pattern: /^Contrast "(.+)" with the correct idea before the next live question\. Start from Q(\d+)\.$/,
    translate: ([, choice, question]) => `השווה בין "${choice}" לבין הרעיון הנכון לפני השאלה החיה הבאה. התחל משאלה ${question}.`,
  },
  {
    pattern: /^(\d+) students need calmer pacing and same-material re-teaching before the next live run\.$/,
    translate: ([, count]) => `${count} תלמידים צריכים קצב רגוע יותר ולימוד מחדש מאותו חומר לפני ההרצה החיה הבאה.`,
  },
  {
    pattern: /^(\d+) high-risk students show a clear drop late in the session even though the class average stayed flatter\.$/,
    translate: ([, count]) => `${count} תלמידים בסיכון גבוה מראים ירידה ברורה בסוף הסשן, גם כשהממוצע הכיתתי נשאר יציב יותר.`,
  },
  {
    pattern: /^Q(\d+) fell to (\d+(?:\.\d+)?)% accuracy$/,
    translate: ([, question, value]) => `שאלה ${question} ירדה ל-${value}% דיוק`,
  },
  {
    pattern: /^Q(\d+) peaked at (\d+(?:\.\d+)?)% stress$/,
    translate: ([, question, value]) => `שאלה ${question} הגיעה לשיא של ${value}% לחץ`,
  },
  {
    pattern: /^Q(\d+) (rebounded|dropped) by (\d+(?:\.\d+)?) points$/,
    translate: ([, question, direction, value]) =>
      `שאלה ${question} ${direction === 'rebounded' ? 'התאוששה' : 'ירדה'} ב-${value} נקודות`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% stress with (.+) average response time\.$/,
    translate: ([, stress, duration]) => `${stress}% לחץ עם זמן תגובה ממוצע של ${duration}.`,
  },
  {
    pattern: /^(\d+) panic swaps and (\d+(?:\.\d+)?) average revisions\.$/,
    translate: ([, swaps, revisions]) => `${swaps} החלפות פאניקה ו-${revisions} שינויים בממוצע.`,
  },
  {
    pattern: /^This shift came with (.+) response time and (\d+(?:\.\d+)?)% stress\.$/,
    translate: ([, duration, stress]) => `השינוי הזה הגיע עם זמן תגובה של ${duration} ו-${stress}% לחץ.`,
  },
  {
    pattern: /^Question (\d+) landed at (\d+(?:\.\d+)?)% accuracy\. Review wording or reteach the concept\.$/,
    translate: ([, question, value]) => `שאלה ${question} נחתה על ${value}% דיוק. כדאי לבדוק את הניסוח או ללמד מחדש את המושג.`,
  },
  {
    pattern: /^Question (\d+) triggered (\d+) panic swaps\. Distractors may be too similar\.$/,
    translate: ([, question, count]) => `שאלה ${question} יצרה ${count} החלפות פאניקה. ייתכן שהמסיחים דומים מדי.`,
  },
  {
    pattern: /^(\d+) student\(s\) show a combined low-mastery and high-pressure pattern from this session\.$/,
    translate: ([, count]) => `${count} תלמידים מציגים בסשן הזה שילוב של שליטה נמוכה ולחץ גבוה.`,
  },
  {
    pattern: /^Overall accuracy finished at (\d+(?:\.\d+)?)%\. Queue an adaptive follow-up practice set\.$/,
    translate: ([, value]) => `הדיוק הכולל הסתיים על ${value}%. כדאי להכניס סט תרגול אדפטיבי להמשך.`,
  },
  {
    pattern: /^Completion rate reached only (\d+(?:\.\d+)?)%\. Check pacing or connection issues\.$/,
    translate: ([, value]) => `שיעור ההשלמה הגיע רק ל-${value}%. כדאי לבדוק קצב או בעיות חיבור.`,
  },
  {
    pattern: /^Build a same-material follow-up focused on (.+) before the next live session\.$/,
    translate: ([, topics]) => `בנה משחק המשך מאותו חומר שמתמקד ב-${topics} לפני הסשן החי הבא.`,
  },
  {
    pattern: /^Target (.+) for reinforcement and then stretch back into mixed practice\.$/,
    translate: ([, topics]) => `התמקד ב-${topics} לחיזוק ואז חזור לתרגול מעורב.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?) high-risk students still showed late fade even though the class average stayed flatter\.$/,
    translate: ([, count]) => `${count} תלמידים בסיכון גבוה עדיין הראו דעיכה מאוחרת, אף שהממוצע הכיתתי נשאר יציב יותר.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?) students show a fatigue pattern, with (\d+(?:\.\d+)?) of them already in the high-risk group\.$/,
    translate: ([, total, highRisk]) => `${total} תלמידים מראים דפוס עייפות, ומתוכם ${highRisk} כבר בקבוצת הסיכון הגבוהה.`,
  },
  {
    pattern: /^Distractor ([A-Z?]): (.+)$/,
    translate: ([, label, text]) => `מסיח ${label}: ${text}`,
  },
  {
    pattern: /^(\d+) students hit this misconception across (\d+) question(s?)\.$/,
    translate: ([, students, questions]) => `${students} תלמידים נתקלו בטעות הזו על פני ${questions} שאלות.`,
  },
  {
    pattern: /^Contrast distractor ([A-Z?]) with the correct explanation before the next live check\.$/,
    translate: ([, label]) => `השווה בין המסיח ${label} לבין ההסבר הנכון לפני הבדיקה החיה הבאה.`,
  },
  {
    pattern: /^Question (\d+)$/,
    translate: ([, index]) => `שאלה ${index}`,
  },
  {
    pattern: /^Question #(\d+)$/,
    translate: ([, index]) => `שאלה #${index}`,
  },
  {
    pattern: /^Rank #(\d+)$/,
    translate: ([, index]) => `דירוג #${index}`,
  },
  {
    pattern: /^(\d+) students touched this topic$/,
    translate: ([, count]) => `${count} תלמידים נגעו בנושא הזה`,
  },
  {
    pattern: /^(\d+) students across (\d+) questions\.$/,
    translate: ([, students, questions]) => `${students} תלמידים על פני ${questions} שאלות.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% were pulled to distractor ([A-Z?])\.$/,
    translate: ([, rate, label]) => `${rate}% נמשכו למסיח ${label}.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% of students were pulled here\.$/,
    translate: ([, rate]) => `${rate}% מהתלמידים נמשכו לכאן.`,
  },
  {
    pattern: /^Deadline dependency on this item was (\d+(?:\.\d+)?)%\.$/,
    translate: ([, rate]) => `התלות בדדליין בפריט הזה הייתה ${rate}%.`,
  },
  {
    pattern: /^(\d+) follow-up transitions$/,
    translate: ([, count]) => `${count} מעברי המשך`,
  },
  {
    pattern: /^Q1 to Q(\d+)$/,
    translate: ([, count]) => `משאלה 1 עד שאלה ${count}`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% accurate$/,
    translate: ([, value]) => `${value}% דיוק`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% revised · (\d+) rows$/,
    translate: ([, rate, count]) => `${rate}% שינו תשובה · ${count} שורות`,
  },
  {
    pattern: /^(\d+) responses$/,
    translate: ([, count]) => `${count} תשובות`,
  },
  {
    pattern: /^Avg response (\d+(?:\.\d+)?)% of the slowest group · (.+)$/,
    translate: ([, rate, duration]) => `זמן תגובה ממוצע ${rate}% מהקבוצה האיטית ביותר · ${duration}`,
  },
  {
    pattern: /^Option ([A-Z?])$/,
    translate: ([, option]) => `אפשרות ${option}`,
  },
  {
    pattern: /^(\d+) students touched this topic$/,
    translate: ([, count]) => `${count} תלמידים נגעו בנושא הזה`,
  },
  {
    pattern: /^(.+) carried the strongest pressure signal in the room\.$/,
    translate: ([, name]) => `${name} נשא את אות הלחץ החזק ביותר בחדר.`,
  },
  {
    pattern: /^(.+) had the lowest accuracy and should be reviewed first\.$/,
    translate: ([, name]) => `ל-${name} היה הדיוק הנמוך ביותר וכדאי לבדוק אותו ראשון.`,
  },
  {
    pattern: /^(.+) took the longest average response time per item\.$/,
    translate: ([, name]) => `${name} לקח את זמן התגובה הממוצע הארוך ביותר לכל פריט.`,
  },
  {
    pattern: /^(.+) triggered the highest number of focus-loss events\.$/,
    translate: ([, name]) => `${name} יצר את מספר אירועי איבוד הפוקוס הגבוה ביותר.`,
  },
  {
    pattern: /^This was the strongest class-level metric relationship observed in the session \((.+)\)\.$/,
    translate: ([, direction]) => `זה היה הקשר החזק ביותר בין מדדים ברמת הכיתה שנצפה בסשן (${translateTeacherAnalyticsText(direction, 'he')}).`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% accuracy at (\d+(?:\.\d+)?)% stress\. Click the dot again to open the individual dashboard\.$/,
    translate: ([, accuracy, stress]) => `${accuracy}% דיוק עם ${stress}% לחץ. לחץ שוב על הנקודה כדי לפתוח את הלוח האישי.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?) focus events per student with an attention-drag mean of (\d+(?:\.\d+)?)\.$/,
    translate: ([, events, mean]) => `${events} אירועי פוקוס לכל תלמיד עם ממוצע גרירת קשב של ${mean}.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?) interaction events per second on average, which points to (active answer checking|leaner decision paths)\.$/,
    translate: ([, value, outcome]) =>
      `${value} אירועי אינטראקציה בממוצע לשנייה, מה שמצביע על ${outcome === 'active answer checking' ? 'בדיקת תשובות פעילה' : 'מסלולי החלטה יעילים יותר'}.`,
  },
  {
    pattern: /^Hover entropy averaged (\d+(?:\.\d+)?) bits, so the class (looked broadly before committing|stayed relatively direct in its choice search)\.$/,
    translate: ([, value, outcome]) =>
      `אנטרופיית הריחוף הממוצעת הייתה ${value} ביט, כך שהכיתה ${outcome === 'looked broadly before committing' ? 'סרקה אפשרויות בהרחבה לפני הנעילה' : 'נשארה יחסית ישירה בחיפוש אחר הבחירה'}.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% of all response rows followed this path\.$/,
    translate: ([, value]) => `${value}% מכל שורות התשובה הלכו במסלול הזה.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% accuracy with calm pacing across (\d+) students\.$/,
    translate: ([, accuracy, count]) => `${accuracy}% דיוק עם קצב רגוע על פני ${count} תלמידים.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% accuracy with (\d+(?:\.\d+)?)% average pressure\. This class needs a guided reset before the next check\.$/,
    translate: ([, accuracy, pressure]) => `${accuracy}% דיוק עם ${pressure}% לחץ ממוצע. הכיתה הזו צריכה איפוס מונחה לפני הבדיקה הבאה.`,
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% accuracy with pockets of hesitation\. Most students can recover, but not consistently\.$/,
    translate: ([, accuracy]) => `${accuracy}% דיוק עם כיסי היסוס. רוב התלמידים מסוגלים להתאושש, אבל לא בעקביות.`,
  },
  {
    pattern: /^(.+) is the main confusion cluster$/,
    translate: ([, topic]) => `${topic} הוא אשכול הבלבול המרכזי`,
  },
];

export function translateTeacherAnalyticsText(text: string, language: AppLanguage): string {
  if (!text || language !== 'he') return text;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return text;

  const exact = EXACT_HEBREW_TRANSLATIONS[normalized];
  if (exact) return exact;

  for (const rule of HEBREW_PATTERN_RULES) {
    const match = normalized.match(rule.pattern);
    if (match) {
      return rule.translate(match);
    }
  }

  return text;
}

export function useTeacherAnalyticsLanguage() {
  const { language, direction } = useAppLanguage();

  const t = useMemo(() => {
    return (text: string) => translateTeacherAnalyticsText(text, language);
  }, [language]);

  return {
    language,
    direction,
    isRtl: direction === 'rtl',
    t,
  };
}
