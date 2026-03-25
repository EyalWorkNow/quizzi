import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Compass,
  ChevronLeft,
  HelpCircle,
  LogOut,
  ChevronRight,
  Library,
  BarChart,
  Users,
  Settings,
  MessageCircle,
  FileText,
  Video,
  Rocket,
  BrainCircuit,
} from 'lucide-react';
import { motion } from 'motion/react';
import { loadContactSubmissions, loadTeacherSettings } from '../lib/localData.ts';
import { isTeacherAuthenticated, refreshTeacherSession } from '../lib/teacherAuth.ts';
import { apiFetchJson } from '../lib/api.ts';
import TeacherSidebar from '../components/TeacherSidebar.tsx';
import { useAppLanguage } from '../lib/appLanguage.tsx';

const HELP_CONTENT = {
  he: {
    allCategory: 'הכול',
    resources: [
      {
        id: 'start',
        title: 'צעדים ראשונים',
        category: 'התחלה',
        description: 'צור את החבילה הראשונה שלך, ארח סשן וקרא את התוצאות הראשונות.',
        body: 'התחל במסך יצירת השאלון, העלה חומרי לימוד, צור שאלות, שמור את החבילה וארח אותה מלוח הבקרה. אחרי שסשן חי מסתיים אפשר לפתוח את הדוחות או את מסך ניתוח הכיתה כדי לראות פירוק התנהגותי מלא.',
        icon: Rocket,
        color: 'bg-brand-yellow',
      },
      {
        id: 'telemetry',
        title: 'הבנת הניתוחים',
        category: 'דוחות',
        description: 'למד לפרש ביטחון, החלפות תשובה, שינויי לחץ ואזהרות קשב.',
        body: 'מדד הלחץ נגזר מהיסוס, החלפות תשובה, שינויים בלחץ ואובדן מיקוד. התרעות בלבול גבוה בדרך כלל מעידות על ניסוח לא ברור או על ידע קודם חלש. מומלץ להפעיל את התרגול האדפטיבי מיד אחרי הסשן.',
        icon: BrainCircuit,
        color: 'bg-brand-purple',
      },
      {
        id: 'videos',
        title: 'זרימות עבודה כיתתיות',
        category: 'הדרכות',
        description: 'תהליכים מומלצים להתחלה מהירה עם כמה כיתות במקביל.',
        body: 'צור חבילה אחת לכל יחידת לימוד, שייך אותה לכיתה, והשתמש שוב בפאנל הצד של אותה כיתה כדי להוסיף תלמידים או לחזור ישירות לדוח האחרון והרלוונטי. כך הדיווח נשאר מחובר לפעילות האמיתית בלי לבנות מחדש את מצב הכיתה בכל פעם.',
        icon: Video,
        color: 'bg-brand-orange',
      },
      {
        id: 'support',
        title: 'ערוצי תמיכה',
        category: 'תמיכה',
        description: 'מתי להשתמש במרכז העזרה ומתי לפנות ישירות לתמיכה.',
        body: 'השתמש במרכז העזרה עבור הגדרה עצמית, דוחות והתנהגות המוצר. השתמש ביצירת קשר עם התמיכה עבור חיוב, פריסות, אינטגרציות או כל דבר שדורש המשך טיפול אנושי.',
        icon: MessageCircle,
        color: 'bg-brand-dark',
      },
    ],
    faqs: [
      {
        id: 'share-quiz',
        question: 'איך משתפים שאלון עם התלמידים?',
        answer: 'מארחים את החבילה מלוח הבקרה של המורה. קוד סשן נוצר מיד, והתלמידים מצטרפים דרך דף הבית.',
        category: 'התחלה',
      },
      {
        id: 'reports',
        question: 'איך מפרשים החלפות תשובה בלחץ?',
        answer: 'אלה שינויים בתשובה סמוך לסיום הטיימר. עלייה חדה בדרך כלל מצביעה על מסיחים דומים מדי או על חוסר ודאות תחת לחץ זמן.',
        category: 'דוחות',
      },
      {
        id: 'classes',
        question: 'מה הדרך המהירה ביותר לנהל כיתות?',
        answer: 'השתמש בדף הכיתות כדי לשמור רשימת תלמידים קלה, לשייך חבילה ולעבור ישירות לניתוח האחרון שמתאים לכיתה.',
        category: 'כיתה',
      },
      {
        id: 'practice',
        question: 'איך נבחר התרגול האדפטיבי?',
        answer: 'המנוע מדרג שליטה לפי תגיות ומעדיף שאלות מהאזורים החלשים ביותר שבהם נרשמה הצלחה נמוכה לאחרונה.',
        category: 'דוחות',
      },
    ],
    faqTitle: 'שאלות נפוצות',
    selectedGuide: 'המדריך הנבחר',
    recentSupport: 'פניות תמיכה אחרונות',
    noGuides: 'לא נמצאו מדריכים שמתאימים לחיפוש הזה.',
    noFaq: 'לא נמצאו שאלות נפוצות שמתאימות לחיפוש הזה.',
    noRequests: 'עדיין לא נשלחו פניות תמיכה מהדפדפן הזה.',
    contactSupport: 'פנה לתמיכה',
  },
  ar: {
    allCategory: 'الكل',
    resources: [
      {
        id: 'start',
        title: 'البداية السريعة',
        category: 'البدء',
        description: 'أنشئ حزمتك الأولى، استضف جلسة، واقرأ أول النتائج.',
        body: 'ابدأ من شاشة إنشاء الاختبار، ارفع المواد التعليمية، أنشئ الأسئلة، احفظ الحزمة واستضفها من لوحة التحكم. بعد انتهاء الجلسة المباشرة يمكنك فتح التقارير أو شاشة تحليلات الصف لمراجعة السلوك بالتفصيل.',
        icon: Rocket,
        color: 'bg-brand-yellow',
      },
      {
        id: 'telemetry',
        title: 'فهم التحليلات',
        category: 'التقارير',
        description: 'افهم الثقة وتبديل الإجابات وتغيرات الضغط وتنبيهات الانتباه.',
        body: 'يُشتق مؤشر الضغط من التردد وتبديل الإجابات وتغيرات الذعر وفقدان التركيز. التنبيهات العالية عادةً تشير إلى صياغة غير واضحة أو ضعف في المعرفة السابقة. يُنصح بتفعيل التدريب التكيّفي مباشرة بعد الجلسة.',
        icon: BrainCircuit,
        color: 'bg-brand-purple',
      },
      {
        id: 'videos',
        title: 'مسارات عمل الصف',
        category: 'الإرشادات',
        description: 'تدفقات موصى بها للانطلاق بسرعة مع عدة صفوف.',
        body: 'أنشئ حزمة لكل وحدة تعليمية، اربطها بصف، واستخدم اللوحة الجانبية نفسها لإضافة الطلاب أو الرجوع مباشرة إلى أحدث تقرير مناسب. بهذه الطريقة تبقى التقارير مرتبطة بالنشاط الفعلي دون إعادة بناء حالة الصف كل مرة.',
        icon: Video,
        color: 'bg-brand-orange',
      },
      {
        id: 'support',
        title: 'قنوات الدعم',
        category: 'الدعم',
        description: 'متى تستخدم مركز المساعدة ومتى تتواصل مع الدعم مباشرة.',
        body: 'استخدم مركز المساعدة للإعداد الذاتي والتقارير وسلوك المنتج. استخدم صفحة الاتصال بالدعم للفوترة أو النشر أو التكاملات أو أي حالة تحتاج إلى متابعة بشرية.',
        icon: MessageCircle,
        color: 'bg-brand-dark',
      },
    ],
    faqs: [
      {
        id: 'share-quiz',
        question: 'كيف أشارك الاختبار مع الطلاب؟',
        answer: 'استضف الحزمة من لوحة تحكم المعلّم. يتم إنشاء رمز الجلسة فورًا وينضم الطلاب من الصفحة الرئيسية.',
        category: 'البدء',
      },
      {
        id: 'reports',
        question: 'كيف أفسر تبديلات الإجابة تحت الضغط؟',
        answer: 'هي تغييرات في الإجابة قرب نهاية المؤقت. الارتفاع الحاد يعني عادةً أن المشتتات متقاربة جدًا أو أن الطلاب كانوا مترددين تحت ضغط الوقت.',
        category: 'التقارير',
      },
      {
        id: 'classes',
        question: 'ما أسرع طريقة لإدارة الصفوف؟',
        answer: 'استخدم صفحة الصفوف للاحتفاظ بقائمة خفيفة، وتعيين حزمة، والانتقال مباشرة إلى أحدث جلسة تحليلات مرتبطة.',
        category: 'الصف',
      },
      {
        id: 'practice',
        question: 'كيف يتم اختيار التدريب التكيّفي؟',
        answer: 'يقيس المحرك مستوى الإتقان بحسب الوسوم ويعطي الأولوية للأسئلة من أضعف المجالات ذات النجاح المنخفض مؤخرًا.',
        category: 'التقارير',
      },
    ],
    faqTitle: 'الأسئلة الشائعة',
    selectedGuide: 'الدليل المختار',
    recentSupport: 'طلبات الدعم الأخيرة',
    noGuides: 'لا توجد أدلة تطابق هذا البحث.',
    noFaq: 'لا توجد أسئلة شائعة تطابق هذا البحث.',
    noRequests: 'لم يتم إرسال أي طلبات دعم من هذا المتصفح بعد.',
    contactSupport: 'تواصل مع الدعم',
  },
  en: {
    allCategory: 'All',
    resources: [
      {
        id: 'start',
        title: 'Getting Started',
        category: 'Onboarding',
        description: 'Create your first pack, host a session and read the first results.',
        body: 'Start in Create Quiz, upload material, generate questions, save the pack and host it from the dashboard. After a live session ends, open Reports or the class analytics screen for behavioral breakdowns.',
        icon: Rocket,
        color: 'bg-brand-yellow',
      },
      {
        id: 'telemetry',
        title: 'Understanding Analytics',
        category: 'Reports',
        description: 'Interpret confidence, swaps, panic changes and focus warnings.',
        body: 'Stress is derived from hesitation, answer swaps, panic changes and focus loss. High confusion alerts usually indicate unclear wording or weak prior knowledge. Use the adaptive practice recommendations right after the session.',
        icon: BrainCircuit,
        color: 'bg-brand-purple',
      },
      {
        id: 'videos',
        title: 'Classroom Workflows',
        category: 'Tutorials',
        description: 'Recommended flows for starting fast with multiple classes.',
        body: 'Create one pack per unit, assign it to a class, and reuse the same class side panel to add students or jump back to the most recent relevant report. This keeps reporting tied to real activity without rebuilding class state every time.',
        icon: Video,
        color: 'bg-brand-orange',
      },
      {
        id: 'support',
        title: 'Support Channels',
        category: 'Support',
        description: 'Know when to use Help Center versus Contact Support.',
        body: 'Use the Help Center for self-serve setup, reports and product behavior. Use Contact Support for billing, deployments, integrations or anything that needs a human follow-up.',
        icon: MessageCircle,
        color: 'bg-brand-dark',
      },
    ],
    faqs: [
      {
        id: 'share-quiz',
        question: 'How do I share a quiz with my students?',
        answer: 'Host the pack from the teacher dashboard. A session PIN is generated immediately and students join from the homepage.',
        category: 'Onboarding',
      },
      {
        id: 'reports',
        question: 'How do I interpret panic swaps?',
        answer: 'Panic swaps are answer changes near the end of the timer. A spike usually means distractors are too close or students were uncertain under time pressure.',
        category: 'Reports',
      },
      {
        id: 'classes',
        question: 'What is the fastest way to manage classes?',
        answer: 'Use the Classes page to keep a lightweight roster, assign a pack and jump directly into the latest matching analytics session.',
        category: 'Classroom',
      },
      {
        id: 'practice',
        question: 'How is adaptive practice chosen?',
        answer: 'The Python engine scores mastery by tag and prioritizes questions from the weakest areas with low recent success.',
        category: 'Reports',
      },
    ],
    faqTitle: 'Frequently Asked Questions',
    selectedGuide: 'Selected Guide',
    recentSupport: 'Recent Support Requests',
    noGuides: 'No guides matched this search.',
    noFaq: 'No FAQ matched this search.',
    noRequests: 'No contact requests have been sent from this browser yet.',
    contactSupport: 'Contact Support',
  },
} as const;

export default function HelpCenter() {
  const { language } = useAppLanguage();
  const navigate = useNavigate();
  const [teacherSignedIn, setTeacherSignedIn] = useState(() => isTeacherAuthenticated());
  const [query, setQuery] = useState('');
  const localizedContent = HELP_CONTENT[language];
  const [activeCategory, setActiveCategory] = useState(localizedContent.allCategory);
  const [openFaqId, setOpenFaqId] = useState<string | null>(localizedContent.faqs[0].id);
  const [selectedResourceId, setSelectedResourceId] = useState<string>(localizedContent.resources[0].id);
  const copy = {
    he: {
      explore: 'גילוי',
      forTeachers: 'למורים',
      contact: 'צור קשר',
      home: 'בית',
      title: 'מרכז עזרה למורים',
      subtitle: 'חפש מדריכי מוצר, הסברים על דוחות וזרימות עבודה כיתתיות. כל מה שמופיע כאן ניתן לעיון ולסינון.',
      searchPlaceholder: 'חפש ניתוחים, אירוח, כיתות או תמיכה...',
      guides: 'מדריכים',
    },
    ar: {
      explore: 'استكشاف',
      forTeachers: 'للمعلّمين',
      contact: 'اتصل بنا',
      home: 'الرئيسية',
      title: 'مركز مساعدة المعلّمين',
      subtitle: 'ابحث عن أدلة المنتج، وشروحات التقارير، وتدفقات العمل الصفية. كل ما هنا قابل للتصفح والتصفية.',
      searchPlaceholder: 'ابحث عن التحليلات أو الاستضافة أو الصفوف أو الدعم...',
      guides: 'الأدلة',
    },
    en: {
      explore: 'Explore',
      forTeachers: 'For Teachers',
      contact: 'Contact Us',
      home: 'Home',
      title: 'Teacher Help Center',
      subtitle: 'Search product guides, reporting explanations and classroom workflows. Everything below is browsable and filterable.',
      searchPlaceholder: 'Search for analytics, hosting, classes, support...',
      guides: 'Guides',
    },
  }[language];
  
  const teacherProfile = loadTeacherSettings().profile;
  const recentContacts = loadContactSubmissions().slice(0, 3);

  useEffect(() => {
    let cancelled = false;
    if (!isTeacherAuthenticated()) {
      setTeacherSignedIn(false);
      return () => {
        cancelled = true;
      };
    }
    refreshTeacherSession()
      .then((session) => {
        if (!cancelled) setTeacherSignedIn(!!session);
      })
      .catch(() => {
        if (!cancelled) setTeacherSignedIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setActiveCategory(localizedContent.allCategory);
    setOpenFaqId(localizedContent.faqs[0]?.id || null);
    setSelectedResourceId(localizedContent.resources[0]?.id || '');
  }, [localizedContent]);

  const categories = [localizedContent.allCategory, ...Array.from(new Set([
    ...localizedContent.resources.map((item) => item.category),
    ...localizedContent.faqs.map((item) => item.category),
  ]))];

  const filteredResources = useMemo(() => {
    return localizedContent.resources.filter((item) => {
      const matchesQuery =
        !query ||
        item.title.toLowerCase().includes(query.toLowerCase()) ||
        item.description.toLowerCase().includes(query.toLowerCase()) ||
        item.body.toLowerCase().includes(query.toLowerCase());
      const matchesCategory = activeCategory === localizedContent.allCategory || item.category === activeCategory;
      return matchesQuery && matchesCategory;
    });
  }, [activeCategory, localizedContent, query]);

  const filteredFaqs = useMemo(() => {
    return localizedContent.faqs.filter((item) => {
      const matchesQuery =
        !query ||
        item.question.toLowerCase().includes(query.toLowerCase()) ||
        item.answer.toLowerCase().includes(query.toLowerCase());
      const matchesCategory = activeCategory === localizedContent.allCategory || item.category === activeCategory;
      return matchesQuery && matchesCategory;
    });
  }, [activeCategory, localizedContent, query]);

  const selectedResource =
    filteredResources.find((item) => item.id === selectedResourceId)
    || filteredResources[0]
    || localizedContent.resources[0];

  return (
    <div className={`min-h-screen bg-brand-bg text-brand-dark font-sans flex overflow-hidden selection:bg-brand-orange selection:text-white`}>
      {teacherSignedIn && <TeacherSidebar />}

      <div className="flex-1 h-screen overflow-y-auto relative">
        <div className="absolute inset-x-0 top-0 h-[430px] bg-[radial-gradient(circle_at_top_left,_rgba(255,90,54,0.16),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(180,136,255,0.18),_transparent_36%)] pointer-events-none" />

        {!teacherSignedIn && (
          <nav className="page-shell-wide relative z-20 flex flex-wrap items-center justify-between gap-4 py-5">
            <div className="text-3xl font-black tracking-tight flex items-center gap-1 cursor-pointer" onClick={() => navigate('/')}>
              <span className="text-brand-orange">Quiz</span>zi
            </div>
            <div className="hidden md:flex items-center gap-10 font-bold text-lg">
              <button onClick={() => navigate('/explore')} className="hover:text-brand-orange transition-colors">{copy.explore}</button>
              <button onClick={() => navigate('/auth')} className="hover:text-brand-orange transition-colors">{copy.forTeachers}</button>
              <button onClick={() => navigate('/contact')} className="hover:text-brand-orange transition-colors">{copy.contact}</button>
            </div>
            <div className="action-row w-full md:w-auto md:justify-end">
              <button onClick={() => navigate('/')} className="font-bold px-8 py-3 rounded-full border-2 border-brand-dark hover:bg-brand-dark hover:text-white transition-colors">
                {copy.home}
              </button>
            </div>
          </nav>
        )}

      <main className={`flex-1 min-h-screen overflow-y-auto p-6 lg:p-8 relative bg-brand-bg ${teacherSignedIn ? '' : 'pt-20'}`}>
        <div className="max-w-[1200px] mx-auto relative z-10">
          <div className="text-center mb-10">
            <h1 className="text-4xl lg:text-5xl font-black tracking-tight mb-4">{copy.title}</h1>
            <p className="text-xl font-bold text-brand-dark/60 max-w-3xl mx-auto">{copy.subtitle}</p>
          </div>

          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 mb-8">
            <div className="relative mb-6">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-dark/40" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.searchPlaceholder}
                className="w-full bg-brand-bg border-2 border-brand-dark rounded-full py-4 pl-14 pr-6 text-lg font-black placeholder:text-brand-dark/40 focus:outline-none focus:ring-4 focus:ring-brand-orange/20"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black ${activeCategory === category ? 'bg-brand-dark text-white' : 'bg-white text-brand-dark'}`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-8">
            <section className="space-y-8">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <FileText className="w-6 h-6 text-brand-purple" />
                  <h2 className="text-3xl font-black">{copy.guides}</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {filteredResources.map((resource) => {
                    const Icon = resource.icon;
                    return (
                      <button
                        key={resource.id}
                        onClick={() => setSelectedResourceId(resource.id)}
                        className={`text-left bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 transition-transform hover:-translate-y-1 ${selectedResource?.id === resource.id ? 'ring-4 ring-brand-orange/20' : ''}`}
                      >
                        <div className={`w-16 h-16 ${resource.color} rounded-full border-4 border-brand-dark flex items-center justify-center mb-5 ${resource.color === 'bg-brand-dark' ? 'text-white' : resource.color === 'bg-brand-purple' || resource.color === 'bg-brand-orange' ? 'text-white' : 'text-brand-dark'}`}>
                          <Icon className="w-7 h-7" />
                        </div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-2">{resource.category}</p>
                        <h3 className="text-2xl font-black mb-2">{resource.title}</h3>
                        <p className="font-bold text-brand-dark/70">{resource.description}</p>
                      </button>
                    );
                  })}
                </div>
                {filteredResources.length === 0 && <EmptyState text={localizedContent.noGuides} />}
              </div>

              <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-8">
                <h2 className="text-3xl font-black mb-6">{localizedContent.faqTitle}</h2>
                <div className="space-y-4">
                  {filteredFaqs.map((faq) => (
                    <FAQItem
                      key={faq.id}
                      question={faq.question}
                      answer={faq.answer}
                      isOpen={openFaqId === faq.id}
                      onToggle={() => setOpenFaqId((current) => (current === faq.id ? null : faq.id))}
                    />
                  ))}
                  {filteredFaqs.length === 0 && <EmptyState text={localizedContent.noFaq} compact />}
                </div>
              </div>
            </section>

            <aside className="space-y-8">
              <div className="bg-brand-dark text-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#FF5A36] p-8">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-white/50 mb-2">{localizedContent.selectedGuide}</p>
                <h2 className="text-3xl font-black mb-3">{selectedResource.title}</h2>
                <p className="font-bold text-white/70 mb-5">{selectedResource.description}</p>
                <p className="font-medium leading-relaxed text-white/80">{selectedResource.body}</p>
              </div>

              <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-8">
                <h2 className="text-2xl font-black mb-4">{localizedContent.recentSupport}</h2>
                <div className="space-y-3">
                  {recentContacts.length > 0 ? recentContacts.map((submission) => (
                    <div key={submission.id} className="rounded-2xl border-2 border-brand-dark/10 bg-brand-bg p-4">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{submission.inquiryType}</p>
                      <p className="font-black">{submission.name} · {submission.organization}</p>
                      <p className="font-medium text-brand-dark/60 mt-1 line-clamp-2">{submission.message || submission.email}</p>
                    </div>
                  )) : (
                    <p className="font-bold text-brand-dark/50">{localizedContent.noRequests}</p>
                  )}
                </div>
                <button onClick={() => navigate('/contact')} className="mt-5 w-full px-6 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black">
                  {localizedContent.contactSupport}
                </button>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  </div>
);
}

function FAQItem({ question, answer, isOpen, onToggle }: any) {
  return (
    <div className="border-2 border-brand-dark rounded-2xl overflow-hidden text-left">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-6 bg-brand-bg hover:bg-brand-yellow/20 transition-colors text-left">
        <span className="text-xl font-black pr-8">{question}</span>
        <div className={`w-8 h-8 rounded-full border-2 border-brand-dark flex items-center justify-center flex-shrink-0 transition-transform ${isOpen ? 'rotate-90 bg-brand-yellow' : 'bg-white'}`}>
          <ChevronRight className="w-5 h-5" />
        </div>
      </button>
      {isOpen && (
        <div className="p-6 bg-white border-t-2 border-brand-dark">
          <p className="text-lg font-bold text-brand-dark/70 leading-relaxed">{answer}</p>
        </div>
      )}
    </div>
  );
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div className={`rounded-2xl border-2 border-dashed border-brand-dark/20 bg-white/50 ${compact ? 'p-4' : 'p-8'} text-center`}>
      <p className="font-bold text-brand-dark/50">{text}</p>
    </div>
  );
}
