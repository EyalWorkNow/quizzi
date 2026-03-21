import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Calculator,
  Filter,
  FlaskConical,
  Globe,
  History,
  Languages,
  Laptop,
  Music,
  Palette,
  Search,
  Sparkles,
  Trophy,
  XCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { isTeacherAuthenticated, refreshTeacherSession } from '../lib/teacherAuth.ts';
import { apiFetchJson } from '../lib/api.ts';
import TeacherSidebar from '../components/TeacherSidebar.tsx';
import { useAppLanguage } from '../lib/appLanguage.tsx';

const CATEGORY_ICONS: Record<string, any> = {
  Math: Calculator,
  Sports: Trophy,
  Music: Music,
  Science: FlaskConical,
  Art: Palette,
  Languages: Languages,
  History: History,
  Tech: Laptop,
  Geography: Globe,
  General: BookOpen,
};

const SORT_OPTIONS = [
  { id: 'newest' },
  { id: 'questions' },
  { id: 'lean' },
] as const;

const EXPLORE_COPY = {
  en: {
    nav: {
      explore: 'Explore',
      forTeachers: 'For Teachers',
      contact: 'Contact Us',
      home: 'Home',
    },
    heroBadge: 'Discover High-Signal Packs',
    heroTitleBefore: 'Browse packs built from',
    heroTitleAccent: 'compressed course intel',
    heroTitleAfter: ', not raw noise.',
    heroBody:
      'Every pack now carries a deterministic teaching brief, topic fingerprint and token-efficient prompt profile, so you can discover stronger material and generate with less model waste.',
    searchPlaceholder: 'Search packs, concepts, tags, or summaries...',
    searchAria: 'Search collections',
    resetFilters: 'Reset filters',
    buildNewPack: 'Build New Pack',
    statLabels: {
      livePacks: 'Live Packs',
      questions: 'Questions',
      avgTokenSave: 'Avg Token Save',
      languages: 'Languages',
    },
    featured: {
      label: 'Featured Pack',
      questions: 'Questions',
      tokenSave: 'Token Save',
      words: 'Words',
      language: 'Language',
      openIntel: 'Open Pack Intel',
    },
    filters: {
      title: 'Browse Filters',
      sortBy: 'Sort by',
      conceptClusters: 'Concept clusters',
      all: 'All',
      sortLabels: {
        newest: 'Newest',
        questions: 'Most Questions',
        lean: 'Lean Prompt',
      },
    },
    atlas: {
      title: 'Pack Atlas',
      results: 'results',
      allConcepts: 'All concepts',
      openStudio: 'Open Studio',
      teacherAccess: 'Teacher Access',
      unavailable: 'Discover is currently unavailable.',
      noMatches: 'No packs matched this filter.',
      noMatchesBody: 'Try another concept, broader search, or reset the filters.',
    },
    drawer: {
      label: 'Pack Intel',
      questions: 'Questions',
      tokenSave: 'Token Save',
      words: 'Words',
      language: 'Language',
      teachingBrief: 'Teaching Brief',
      keyPoints: 'Key points',
      conceptFingerprint: 'Concept fingerprint',
      openInStudio: 'Open In Studio',
      teacherAccess: 'Teacher Access',
      createSimilar: 'Create Similar',
    },
    packCard: {
      tokenSave: 'Token save',
      words: 'Words',
      prompt: 'Prompt',
      openIntel: 'Open pack intel',
      questionShort: 'Q',
      notAvailable: 'N/A',
    },
  },
  he: {
    nav: {
      explore: 'גלה',
      forTeachers: 'למורים',
      contact: 'צור קשר',
      home: 'בית',
    },
    heroBadge: 'חבילות איכות לחקר מהיר',
    heroTitleBefore: 'עיין בחבילות שנבנו מתוך',
    heroTitleAccent: 'אינטליגנציה דחוסה של חומר הלימוד',
    heroTitleAfter: ', ולא מתוך רעש גולמי.',
    heroBody:
      'כל חבילה כוללת תקציר הוראה דטרמיניסטי, טביעת אצבע נושאית ופרופיל prompt חסכוני, כך שאפשר לגלות חומר חזק יותר ולייצר עם פחות בזבוז מודל.',
    searchPlaceholder: 'חפש חבילות, מושגים, תגיות או תקצירים...',
    searchAria: 'חיפוש מאגרים',
    resetFilters: 'איפוס סינון',
    buildNewPack: 'בנה חבילה חדשה',
    statLabels: {
      livePacks: 'חבילות פעילות',
      questions: 'שאלות',
      avgTokenSave: 'חיסכון ממוצע בטוקנים',
      languages: 'שפות',
    },
    featured: {
      label: 'חבילה נבחרת',
      questions: 'שאלות',
      tokenSave: 'חיסכון בטוקנים',
      words: 'מילים',
      language: 'שפה',
      openIntel: 'פתח מודיעין חבילה',
    },
    filters: {
      title: 'מסנני עיון',
      sortBy: 'מיין לפי',
      conceptClusters: 'אשכולות מושגים',
      all: 'הכול',
      sortLabels: {
        newest: 'החדשים ביותר',
        questions: 'הכי הרבה שאלות',
        lean: 'פרומפט רזה',
      },
    },
    atlas: {
      title: 'אטלס החבילות',
      results: 'תוצאות',
      allConcepts: 'כל המושגים',
      openStudio: 'פתח סטודיו',
      teacherAccess: 'כניסת מורה',
      unavailable: 'עמוד הגילוי אינו זמין כרגע.',
      noMatches: 'לא נמצאו חבילות לפי הסינון הזה.',
      noMatchesBody: 'נסה מושג אחר, חיפוש רחב יותר, או אפס את המסננים.',
    },
    drawer: {
      label: 'מודיעין חבילה',
      questions: 'שאלות',
      tokenSave: 'חיסכון בטוקנים',
      words: 'מילים',
      language: 'שפה',
      teachingBrief: 'תקציר הוראה',
      keyPoints: 'נקודות מפתח',
      conceptFingerprint: 'טביעת אצבע מושגית',
      openInStudio: 'פתח בסטודיו',
      teacherAccess: 'כניסת מורה',
      createSimilar: 'צור דומה',
    },
    packCard: {
      tokenSave: 'חיסכון בטוקנים',
      words: 'מילים',
      prompt: 'פרומפט',
      openIntel: 'פתח מודיעין חבילה',
      questionShort: 'ש',
      notAvailable: 'לא זמין',
    },
  },
  ar: {
    nav: {
      explore: 'استكشاف',
      forTeachers: 'للمعلمين',
      contact: 'اتصل بنا',
      home: 'الرئيسية',
    },
    heroBadge: 'اكتشف الحزم عالية الإشارة',
    heroTitleBefore: 'تصفح الحزم المبنية من',
    heroTitleAccent: 'استخلاص معرفي مضغوط للمقرر',
    heroTitleAfter: '، لا من الضجيج الخام.',
    heroBody:
      'تحمل كل حزمة الآن ملخصًا تدريسيًا حتميًا وبصمة موضوعية وملف توجيه موفرًا للرموز، لتكتشف مواد أقوى وتولّد باستهلاك أقل للنموذج.',
    searchPlaceholder: 'ابحث في الحزم أو المفاهيم أو الوسوم أو الملخصات...',
    searchAria: 'البحث في المجموعات',
    resetFilters: 'إعادة ضبط الفلاتر',
    buildNewPack: 'إنشاء حزمة جديدة',
    statLabels: {
      livePacks: 'حزم نشطة',
      questions: 'أسئلة',
      avgTokenSave: 'متوسط توفير الرموز',
      languages: 'لغات',
    },
    featured: {
      label: 'حزمة مميزة',
      questions: 'أسئلة',
      tokenSave: 'توفير الرموز',
      words: 'كلمات',
      language: 'اللغة',
      openIntel: 'افتح معلومات الحزمة',
    },
    filters: {
      title: 'فلاتر التصفح',
      sortBy: 'الترتيب حسب',
      conceptClusters: 'عناقيد المفاهيم',
      all: 'الكل',
      sortLabels: {
        newest: 'الأحدث',
        questions: 'الأكثر أسئلة',
        lean: 'موجّه رشيق',
      },
    },
    atlas: {
      title: 'أطلس الحزم',
      results: 'نتائج',
      allConcepts: 'كل المفاهيم',
      openStudio: 'افتح الاستوديو',
      teacherAccess: 'دخول المعلم',
      unavailable: 'صفحة الاستكشاف غير متاحة حاليًا.',
      noMatches: 'لم نعثر على حزم بهذا الفلتر.',
      noMatchesBody: 'جرّب مفهومًا آخر أو بحثًا أوسع أو أعد ضبط الفلاتر.',
    },
    drawer: {
      label: 'معلومات الحزمة',
      questions: 'أسئلة',
      tokenSave: 'توفير الرموز',
      words: 'كلمات',
      language: 'اللغة',
      teachingBrief: 'ملخص تدريسي',
      keyPoints: 'نقاط أساسية',
      conceptFingerprint: 'بصمة مفاهيمية',
      openInStudio: 'افتح في الاستوديو',
      teacherAccess: 'دخول المعلم',
      createSimilar: 'أنشئ شبيهًا',
    },
    packCard: {
      tokenSave: 'توفير الرموز',
      words: 'كلمات',
      prompt: 'الموجّه',
      openIntel: 'افتح معلومات الحزمة',
      questionShort: 'س',
      notAvailable: 'غير متاح',
    },
  },
} as const;

// Replaced by central apiFetchJson

export default function Explore() {
  const navigate = useNavigate();
  const { language, direction } = useAppLanguage();
  const copy = EXPLORE_COPY[language as keyof typeof EXPLORE_COPY] || EXPLORE_COPY.en;
  const isRtl = direction === 'rtl';
  const [teacherSignedIn, setTeacherSignedIn] = useState(() => isTeacherAuthenticated());
  const [packs, setPacks] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [selectedPack, setSelectedPack] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetchJson('/api/discover/packs')
      .then((data) => setPacks(Array.isArray(data) ? data : []))
      .catch((loadError: any) => setError(loadError?.message || 'Failed to load packs'))
      .finally(() => setLoading(false));
  }, []);

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
        if (!cancelled) {
          setTeacherSignedIn(!!session);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTeacherSignedIn(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    packs.forEach((pack) => {
      const tags = (pack.top_tags?.length ? pack.top_tags : pack.topic_fingerprint?.slice(0, 2) || ['General']) as string[];
      tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  }, [packs]);

  const filteredPacks = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    const scoped = packs.filter((pack) => {
      const haystack = [
        pack.title,
        pack.source_excerpt,
        pack.teaching_brief,
        ...(pack.top_tags || []),
        ...(pack.topic_fingerprint || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);
      const matchesCategory =
        selectedCategory === 'All' ||
        (pack.top_tags || []).includes(selectedCategory) ||
        (pack.topic_fingerprint || []).includes(selectedCategory);

      return matchesSearch && matchesCategory;
    });

    const sorted = [...scoped];
    sorted.sort((left, right) => {
      if (sortBy === 'questions') {
        return Number(right.question_count || 0) - Number(left.question_count || 0);
      }
      if (sortBy === 'lean') {
        return Number(right.token_savings_pct || 0) - Number(left.token_savings_pct || 0);
      }
      return String(right.created_at || '').localeCompare(String(left.created_at || ''));
    });

    return sorted;
  }, [packs, searchQuery, selectedCategory, sortBy]);

  const featuredPack = filteredPacks[0] || packs[0] || null;

  const stats = useMemo(() => {
    const totalQuestions = packs.reduce((sum, pack) => sum + Number(pack.question_count || 0), 0);
    const avgSavings =
      packs.length > 0
        ? Math.round(
            packs.reduce((sum, pack) => sum + Number(pack.token_savings_pct || 0), 0) / packs.length,
          )
        : 0;
    const languages = new Set(packs.map((pack) => pack.source_language).filter(Boolean)).size;

    return {
      totalPacks: packs.length,
      totalQuestions,
      avgSavings,
      languages,
    };
  }, [packs]);

  return (
    <div
      dir={direction}
      data-no-translate="true"
      className={`min-h-screen bg-brand-bg font-sans text-brand-dark flex overflow-hidden selection:bg-brand-orange selection:text-white`}
    >
      {teacherSignedIn && <TeacherSidebar />}

      <div className="flex-1 h-screen overflow-y-auto relative">
        <div className="absolute inset-x-0 top-0 h-[430px] bg-[radial-gradient(circle_at_top_left,_rgba(255,90,54,0.16),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(180,136,255,0.18),_transparent_36%)] pointer-events-none" />

        {!teacherSignedIn && (
          <nav className="page-shell-wide relative z-20 flex flex-wrap items-center justify-between gap-4 py-5">
            <div className="text-3xl font-black tracking-tight flex items-center gap-1 cursor-pointer" onClick={() => navigate('/')}>
              <span className="text-brand-orange">Quiz</span>zi
            </div>
            <div className="hidden md:flex items-center gap-10 font-bold text-lg">
              <button onClick={() => navigate('/explore')} className="text-brand-orange transition-colors flex items-center gap-1">{copy.nav.explore}</button>
              <button onClick={() => navigate('/auth')} className="hover:text-brand-orange transition-colors">{copy.nav.forTeachers}</button>
              <button onClick={() => navigate('/contact')} className="hover:text-brand-orange transition-colors">{copy.nav.contact}</button>
            </div>
            <div className="action-row w-full md:w-auto md:justify-end">
              <button onClick={() => navigate('/')} className="font-bold px-8 py-3 rounded-full border-2 border-brand-dark hover:bg-brand-dark hover:text-white transition-colors">
                {copy.nav.home}
              </button>
            </div>
          </nav>
        )}

        <main className={`page-shell-wide relative z-10 pb-20 ${teacherSignedIn ? 'pt-8' : ''}`}>
        <section className="pt-8 pb-10">
          <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-8 items-start">
            <div className={isRtl ? 'text-right' : ''}>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border-2 border-brand-dark shadow-[3px_3px_0px_0px_#1A1A1A] text-sm font-black uppercase tracking-[0.18em] mb-6">
                <Sparkles className="w-4 h-4 text-brand-orange" />
                {copy.heroBadge}
              </div>
              <h1 className="mb-5 text-[2.8rem] font-black leading-[0.96] tracking-tight xs:text-[3.2rem] sm:text-[4.6rem]">
                {copy.heroTitleBefore}
                <span className="text-brand-orange"> {copy.heroTitleAccent}</span>
                {copy.heroTitleAfter}
              </h1>
              <p className="mb-8 max-w-3xl text-lg font-bold text-brand-dark/65 sm:text-xl">
                {copy.heroBody}
              </p>

              <div className="mb-8 flex flex-col gap-4 sm:flex-row">
                <div className="relative flex-1">
                  <input
                    id="search-explore"
                    type="text"
                    placeholder={copy.searchPlaceholder}
                    aria-label={copy.searchAria}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className={`w-full rounded-full border-2 border-brand-dark bg-white px-6 py-4 text-base font-bold placeholder:text-brand-dark/35 shadow-[4px_4px_0px_0px_#1A1A1A] focus:outline-none focus:ring-4 focus:ring-brand-purple/20 sm:px-8 sm:py-5 sm:text-xl ${isRtl ? 'pr-12 pl-6 sm:pr-14 sm:pl-8 text-right' : 'pl-12 pr-6 sm:pl-14 sm:pr-8 text-left'}`}
                  />
                  <Search className={`absolute top-1/2 -translate-y-1/2 w-6 h-6 text-brand-dark/40 ${isRtl ? 'right-5' : 'left-5'}`} />
                </div>
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedCategory('All');
                    setSortBy('newest');
                  }}
                  className="h-14 w-full rounded-full border-2 border-brand-dark bg-white shadow-[4px_4px_0px_0px_#1A1A1A] sm:h-16 sm:w-16 flex items-center justify-center"
                  title={copy.resetFilters}
                  aria-label={copy.resetFilters}
                >
                  <Filter className="w-6 h-6" />
                </button>
                <button
                  onClick={() => navigate('/teacher/pack/create')}
                  className={`w-full rounded-full border-2 border-brand-dark bg-brand-purple px-6 py-4 text-lg font-black text-white shadow-[4px_4px_0px_0px_#1A1A1A] sm:w-auto sm:px-8 sm:py-5 sm:text-xl flex items-center justify-center gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}
                >
                  {copy.buildNewPack}
                  <ArrowRight className={`w-5 h-5 ${isRtl ? 'rotate-180' : ''}`} />
                </button>
              </div>

              <div className="safe-grid-4">
                <StatCard label={copy.statLabels.livePacks} value={stats.totalPacks} tone="dark" />
                <StatCard label={copy.statLabels.questions} value={stats.totalQuestions} tone="light" />
                <StatCard label={copy.statLabels.avgTokenSave} value={`${stats.avgSavings}%`} tone="orange" />
                <StatCard label={copy.statLabels.languages} value={stats.languages} tone="purple" />
              </div>
            </div>

            {featuredPack && (
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-brand-dark text-white rounded-[2.8rem] border-4 border-brand-dark shadow-[12px_12px_0px_0px_#FF5A36] p-8 overflow-hidden relative"
              >
                <div className="absolute top-[-30px] right-[-12px] w-52 h-52 rounded-full bg-white/10" />
                <div className="relative z-10">
                  <p className="text-xs font-black uppercase tracking-[0.25em] text-brand-yellow mb-3">{copy.featured.label}</p>
                  <h2 className="mb-3 text-3xl font-black leading-tight sm:text-4xl">{featuredPack.title}</h2>
                  <p className="font-medium text-white/75 mb-6">{featuredPack.source_excerpt}</p>

                  <div className="safe-grid-2 mb-6">
                    <SignalTile label={copy.featured.questions} value={featuredPack.question_count || 0} />
                    <SignalTile label={copy.featured.tokenSave} value={`${featuredPack.token_savings_pct || 0}%`} />
                    <SignalTile label={copy.featured.words} value={featuredPack.source_word_count || 0} />
                    <SignalTile label={copy.featured.language} value={featuredPack.source_language || copy.packCard.notAvailable} />
                  </div>

                  <div className="flex flex-wrap gap-2 mb-6">
                    {(featuredPack.top_tags?.length ? featuredPack.top_tags : featuredPack.topic_fingerprint || []).slice(0, 5).map((tag: string) => (
                      <span key={`hero-${tag}`} className="px-4 py-2 rounded-full bg-white/10 border border-white/15 font-black text-xs uppercase tracking-[0.14em]">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <button
                    onClick={() => setSelectedPack(featuredPack)}
                    className={`px-7 py-4 bg-brand-yellow text-brand-dark rounded-full font-black border-2 border-brand-dark flex items-center gap-2 ${isRtl ? 'flex-row-reverse' : ''}`}
                  >
                    {copy.featured.openIntel}
                    <ArrowRight className={`w-4 h-4 ${isRtl ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-8">
          <aside className="space-y-6">
            <div className="bg-white rounded-[2.2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 xl:sticky xl:top-24">
              <div className="flex items-center gap-3 mb-5">
                <BrainCircuit className="w-6 h-6 text-brand-purple" />
                <h3 className="text-2xl font-black">{copy.filters.title}</h3>
              </div>

              <div className="mb-6">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-3">{copy.filters.sortBy}</p>
                <div className="flex flex-wrap gap-2">
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      onClick={() => setSortBy(option.id)}
                      className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black text-sm ${sortBy === option.id ? 'bg-brand-yellow' : 'bg-brand-bg'}`}
                    >
                      {copy.filters.sortLabels[option.id]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-3">{copy.filters.conceptClusters}</p>
                <div className="space-y-2">
                  <CategoryChip
                    name={copy.filters.all}
                    count={packs.length}
                    active={selectedCategory === 'All'}
                    onClick={() => setSelectedCategory('All')}
                    icon={<BookOpen className="w-4 h-4" />}
                  />
                  {categories.slice(0, 10).map((category) => {
                    const Icon = CATEGORY_ICONS[category.name] || BookOpen;
                    return (
                      <div key={category.name}>
                        <CategoryChip
                          name={category.name}
                          count={category.count}
                          active={selectedCategory === category.name}
                          onClick={() => setSelectedCategory(category.name)}
                          icon={<Icon className="w-4 h-4" />}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </aside>

          <section className="space-y-6 pb-16">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-3xl font-black tracking-tight sm:text-4xl">{copy.atlas.title}</h2>
                <p className="font-bold text-brand-dark/60 mt-2">
                  {filteredPacks.length} {copy.atlas.results} · {selectedCategory === 'All' ? copy.atlas.allConcepts : selectedCategory}
                </p>
              </div>
              <button
                onClick={() => navigate(teacherSignedIn ? '/teacher/dashboard' : '/auth')}
                className="w-full rounded-full bg-white px-5 py-3 font-black shadow-[2px_2px_0px_0px_#1A1A1A] border-2 border-brand-dark sm:w-auto"
              >
                {teacherSignedIn ? copy.atlas.openStudio : copy.atlas.teacherAccess}
              </button>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="h-[320px] rounded-[2rem] border-4 border-brand-dark bg-white animate-pulse shadow-[8px_8px_0px_0px_#1A1A1A]" />
                ))}
              </div>
            ) : error ? (
              <div className="bg-white border-4 border-brand-dark rounded-[2rem] p-10 shadow-[6px_6px_0px_0px_#1A1A1A]">
                <p className="text-2xl font-black mb-2">{copy.atlas.unavailable}</p>
                <p className="font-bold text-brand-dark/60">{error}</p>
              </div>
            ) : filteredPacks.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {filteredPacks.map((pack, index) => (
                  <div key={pack.id}>
                    <PackCard pack={pack} index={index} onOpen={() => setSelectedPack(pack)} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white border-4 border-brand-dark rounded-[2rem] p-12 shadow-[8px_8px_0px_0px_#1A1A1A] text-center">
                <p className="text-3xl font-black mb-3">{copy.atlas.noMatches}</p>
                <p className="font-bold text-brand-dark/60">{copy.atlas.noMatchesBody}</p>
              </div>
            )}
          </section>
        </section>
      </main>

      {selectedPack && (
        <div className="fixed inset-0 z-40 bg-black/30 flex justify-end">
          <div className="w-full max-w-[620px] h-full bg-white border-l-4 border-brand-dark p-4 sm:p-6 overflow-y-auto shadow-[-8px_0_0_0_#1A1A1A]">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{copy.drawer.label}</p>
                <h2 className="text-3xl font-black leading-tight sm:text-4xl">{selectedPack.title}</h2>
              </div>
              <button onClick={() => setSelectedPack(null)} className="w-11 h-11 rounded-full border-2 border-brand-dark flex items-center justify-center">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="safe-grid-2 mb-6">
              <DrawerStat label={copy.drawer.questions} value={selectedPack.question_count || 0} />
              <DrawerStat label={copy.drawer.tokenSave} value={`${selectedPack.token_savings_pct || 0}%`} />
              <DrawerStat label={copy.drawer.words} value={selectedPack.source_word_count || 0} />
              <DrawerStat label={copy.drawer.language} value={selectedPack.source_language || copy.packCard.notAvailable} />
            </div>

            <div className="rounded-[1.8rem] border-2 border-brand-dark bg-brand-bg p-5 mb-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{copy.drawer.teachingBrief}</p>
              <p className="font-medium text-brand-dark/75 whitespace-pre-line">{selectedPack.teaching_brief || selectedPack.source_excerpt}</p>
            </div>

            <div className="mb-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-3">{copy.drawer.keyPoints}</p>
              <div className="space-y-3">
                {(selectedPack.key_points || []).slice(0, 4).map((point: string) => (
                  <div key={point} className="rounded-[1.3rem] border-2 border-brand-dark bg-white p-4 font-medium text-brand-dark/75">
                    {point}
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-8">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-3">{copy.drawer.conceptFingerprint}</p>
              <div className="flex flex-wrap gap-2">
                {(selectedPack.topic_fingerprint?.length ? selectedPack.topic_fingerprint : selectedPack.top_tags || []).slice(0, 8).map((tag: string) => (
                  <span key={tag} className="px-3 py-2 rounded-full bg-brand-purple/10 border-2 border-brand-purple/20 text-brand-purple text-xs font-black uppercase">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="action-row">
              <button onClick={() => navigate(teacherSignedIn ? '/teacher/dashboard' : '/auth')} className="action-pill flex-1 px-6 py-4 bg-brand-dark text-white rounded-2xl border-2 border-brand-dark font-black">
                {teacherSignedIn ? copy.drawer.openInStudio : copy.drawer.teacherAccess}
              </button>
              <button onClick={() => navigate('/teacher/pack/create')} className="action-pill px-6 py-4 bg-brand-orange text-white rounded-2xl border-2 border-brand-dark font-black">
                {copy.drawer.createSimilar}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone: 'dark' | 'light' | 'orange' | 'purple' }) {
  const classes =
    tone === 'dark'
      ? 'bg-brand-dark text-white'
      : tone === 'orange'
        ? 'bg-brand-orange text-white'
        : tone === 'purple'
          ? 'bg-brand-purple text-white'
          : 'bg-white text-brand-dark';

  return (
    <div className={`${classes} rounded-[1.8rem] border-4 border-brand-dark p-5 shadow-[6px_6px_0px_0px_#1A1A1A]`}>
      <p className="text-xs font-black uppercase tracking-[0.2em] opacity-70 mb-2">{label}</p>
      <p className="text-3xl font-black">{value}</p>
    </div>
  );
}

function SignalTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[1.4rem] border border-white/15 bg-white/10 p-4">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-white/40 mb-2">{label}</p>
      <p className="text-2xl font-black">{value}</p>
    </div>
  );
}

function CategoryChip({
  name,
  count,
  active,
  onClick,
  icon,
}: {
  name: string;
  count: number;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  const { direction } = useAppLanguage();
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-3 rounded-[1.25rem] border-2 border-brand-dark px-4 py-3 font-black ${active ? 'bg-brand-yellow' : 'bg-brand-bg'} ${direction === 'rtl' ? 'text-right' : 'text-left'}`}
    >
      <span className="flex items-center gap-3">
        {icon}
        {name}
      </span>
      <span className="text-xs uppercase tracking-[0.2em] text-brand-dark/45">{count}</span>
    </button>
  );
}

function PackCard({ pack, index, onOpen }: { pack: any; index: number; onOpen: () => void }) {
  const { language, direction } = useAppLanguage();
  const copy = EXPLORE_COPY[language as keyof typeof EXPLORE_COPY] || EXPLORE_COPY.en;
  const isRtl = direction === 'rtl';
  const accent = index % 3 === 0 ? 'bg-brand-yellow' : index % 3 === 1 ? 'bg-brand-orange' : 'bg-brand-purple';

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.25) }}
      className={`bg-white rounded-[2.2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 overflow-hidden hover:-translate-y-1 transition-transform ${isRtl ? 'text-right' : 'text-left'}`}
    >
      <div className={`rounded-[1.8rem] border-2 border-brand-dark ${accent} p-5 mb-5`}>
        <div className={`flex items-start justify-between gap-4 mb-4 ${isRtl ? 'flex-row-reverse' : ''}`}>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50 mb-2">{pack.source_language || copy.packCard.notAvailable}</p>
            {/* pack content remains data-driven; only the surrounding chrome is localized */}
            <h3 className="text-3xl font-black leading-tight">{pack.title}</h3>
          </div>
          <div className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark text-xs font-black uppercase tracking-[0.15em]">
            {pack.question_count || 0} {copy.packCard.questionShort}
          </div>
        </div>
        <p className="font-bold text-brand-dark/75 line-clamp-3">{pack.source_excerpt}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 mb-5 xs:grid-cols-3">
        <PackMetric label={copy.packCard.tokenSave} value={`${pack.token_savings_pct || 0}%`} />
        <PackMetric label={copy.packCard.words} value={pack.source_word_count || 0} />
        <PackMetric label={copy.packCard.prompt} value={pack.estimated_prompt_tokens || 0} />
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {(pack.top_tags?.length ? pack.top_tags : pack.topic_fingerprint || []).slice(0, 4).map((tag: string) => (
          <span key={`${pack.id}-${tag}`} className="px-3 py-1 rounded-full bg-brand-bg border-2 border-brand-dark text-xs font-black uppercase tracking-[0.12em]">
            {tag}
          </span>
        ))}
      </div>

      <div className="space-y-3 mb-5">
        {(pack.key_points || []).slice(0, 2).map((point: string) => (
          <div key={point} className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg px-4 py-3 font-medium text-brand-dark/75">
            {point}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-black text-brand-purple uppercase tracking-[0.14em]">{copy.packCard.openIntel}</span>
        <div className="w-11 h-11 rounded-full bg-brand-dark text-white border-2 border-brand-dark flex items-center justify-center">
          <ArrowRight className={`w-4 h-4 ${isRtl ? 'rotate-180' : ''}`} />
        </div>
      </div>
    </motion.button>
  );
}

function PackMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-1">{label}</p>
      <p className="text-lg font-black">{value}</p>
    </div>
  );
}

function DrawerStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-1">{label}</p>
      <p className="text-2xl font-black">{value}</p>
    </div>
  );
}
