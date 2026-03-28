import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Calculator,
  Compass,
  Filter,
  FlaskConical,
  Globe,
  History,
  Languages,
  Laptop,
  Music,
  Palette,
  Sparkles,
  Trophy,
  XCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { isTeacherAuthenticated, refreshTeacherSession } from '../lib/teacherAuth.ts';
import { apiFetchJson } from '../lib/api.ts';
import BrandLogo from '../components/BrandLogo.tsx';
import TeacherSidebar from '../components/TeacherSidebar.tsx';
import UiverseSearchField from '../components/UiverseSearchField.tsx';
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

export default function Explore() {
  const navigate = useNavigate();
  const { t, direction } = useAppLanguage();
  const isRtl = direction === 'rtl';
  const [teacherSignedIn, setTeacherSignedIn] = useState(false);
  const [packs, setPacks] = useState<any[]>([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<typeof SORT_OPTIONS[number]['id']>('newest');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedPack, setSelectedPack] = useState<any>(null);

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
        activeCategory === 'All' ||
        (pack.top_tags || []).includes(activeCategory) ||
        (pack.topic_fingerprint || []).includes(activeCategory);

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
  }, [packs, searchQuery, activeCategory, sortBy]);

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
    <div dir={direction} data-no-translate="true" className="teacher-layout-shell">
      {teacherSignedIn && <TeacherSidebar />}

      <div className="teacher-layout-main overflow-y-auto">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[430px] bg-[radial-gradient(circle_at_top_left,_rgba(255,90,54,0.16),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(180,136,255,0.18),_transparent_36%)]" />

        {!teacherSignedIn && (
          <nav className="page-shell-wide relative z-20 flex flex-wrap items-center justify-between gap-4 py-5">
            <BrandLogo onClick={() => navigate('/')} imageClassName="h-11 w-auto" />
            <div className="hidden items-center gap-10 text-lg font-bold md:flex">
              <button onClick={() => navigate('/explore')} className="flex items-center gap-1 text-brand-orange transition-colors">
                {t('explore.nav.explore')}
              </button>
              <button onClick={() => navigate('/auth')} className="transition-colors hover:text-brand-orange">
                {t('explore.nav.forTeachers')}
              </button>
              <button onClick={() => navigate('/contact')} className="transition-colors hover:text-brand-orange">
                {t('explore.nav.contact')}
              </button>
            </div>
            <div className="action-row w-full md:w-auto md:justify-end">
              <button
                onClick={() => navigate('/')}
                className="rounded-full border-2 border-brand-dark px-8 py-3 font-bold transition-colors hover:bg-brand-dark hover:text-white"
              >
                {t('explore.nav.home')}
              </button>
            </div>
          </nav>
        )}

        <main className={`page-shell-wide relative z-10 pb-20 ${teacherSignedIn ? 'pt-20 lg:pt-8' : ''}`}>
          <section className="pt-6 pb-12">
            <div className="relative overflow-hidden rounded-[2.8rem] border-4 border-brand-dark bg-[linear-gradient(135deg,_#fffaf2_0%,_#ffffff_44%,_#f5eeff_100%)] px-5 py-6 shadow-[10px_10px_0px_0px_#1A1A1A] sm:px-8 sm:py-8 xl:px-10 xl:py-10">
              <div className="pointer-events-none absolute inset-y-0 left-0 w-40 bg-[radial-gradient(circle_at_left,_rgba(255,209,59,0.35),_transparent_70%)]" />
              <div className="pointer-events-none absolute -right-12 top-0 h-52 w-52 rounded-full bg-brand-orange/12 blur-3xl" />
              <div className="pointer-events-none absolute bottom-[-5rem] right-[18%] h-56 w-56 rounded-full bg-brand-purple/14 blur-3xl" />

              <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,1.08fr)_minmax(380px,0.92fr)] xl:gap-10">
                <div className={isRtl ? 'text-right' : ''}>
                  <div className="mb-6 flex flex-wrap items-center gap-3">
                    <div className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black uppercase tracking-[0.18em] shadow-[3px_3px_0px_0px_#1A1A1A]">
                      <Sparkles className="h-4 w-4 text-brand-orange" />
                      {t('explore.heroBadge')}
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 text-sm font-black uppercase tracking-[0.16em] shadow-[3px_3px_0px_0px_#1A1A1A]">
                      <Compass className="h-4 w-4" />
                      Discovery Atlas
                    </div>
                  </div>

                  <h1 className="mb-5 max-w-4xl text-[2.9rem] font-black leading-[0.92] tracking-[-0.05em] xs:text-[3.2rem] sm:text-[4.2rem] xl:text-[5rem]">
                    {t('explore.heroTitleBefore')}
                    <span className="text-brand-orange"> {t('explore.heroTitleAccent')}</span>
                    {t('explore.heroTitleAfter')}
                  </h1>
                  <p className="mb-8 max-w-3xl text-base font-bold leading-8 text-brand-dark/68 sm:text-lg xl:text-[1.15rem]">
                    {t('explore.heroBody')}
                  </p>

                  <div className="mb-7 flex flex-col gap-4 xl:flex-row">
                    <UiverseSearchField
                      id="search-explore"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={t('explore.searchPlaceholder')}
                      shellClassName="flex-1"
                      accent="purple"
                      dir={isRtl ? 'rtl' : 'ltr'}
                      onClear={() => setSearchQuery('')}
                    />
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setActiveCategory('All');
                        setSortBy('newest');
                      }}
                      className="flex h-14 w-full items-center justify-center rounded-full border-2 border-brand-dark bg-white shadow-[4px_4px_0px_0px_#1A1A1A] transition-transform hover:-translate-y-0.5 xl:w-16"
                      title={t('explore.resetFilters')}
                    >
                      <Filter className="h-6 w-6" />
                    </button>
                    <button
                      onClick={() => navigate('/teacher/pack/create')}
                      className={`flex w-full items-center justify-center gap-3 rounded-full border-2 border-brand-dark bg-brand-purple px-6 py-4 text-lg font-black text-white shadow-[4px_4px_0px_0px_#1A1A1A] transition-transform hover:-translate-y-0.5 xl:w-auto xl:px-8 ${isRtl ? 'flex-row-reverse' : ''}`}
                    >
                      {t('explore.buildNewPack')}
                      <ArrowRight className={`h-5 w-5 ${isRtl ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <StatCard label={t('explore.statLabels.livePacks')} value={stats.totalPacks} tone="dark" />
                    <StatCard label={t('explore.statLabels.questions')} value={stats.totalQuestions} tone="light" />
                    <StatCard label={t('explore.statLabels.avgTokenSave')} value={`${stats.avgSavings}%`} tone="orange" />
                    <StatCard label={t('explore.statLabels.languages')} value={stats.languages} tone="purple" />
                  </div>
                </div>

                {featuredPack && (
                  <motion.div
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative overflow-hidden rounded-[2.6rem] border-4 border-brand-dark bg-[#141414] p-6 text-white shadow-[12px_12px_0px_0px_#FF5A36] sm:p-7"
                  >
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top,_rgba(255,209,59,0.28),_transparent_70%)]" />
                    <div className="pointer-events-none absolute -right-10 top-8 h-40 w-40 rounded-full bg-brand-purple/30 blur-3xl" />
                    <div className="pointer-events-none absolute bottom-0 left-0 h-40 w-40 bg-[radial-gradient(circle_at_bottom_left,_rgba(255,90,54,0.32),_transparent_68%)]" />

                    <div className="relative z-10">
                      <div className="mb-5 flex items-start justify-between gap-4">
                        <div>
                          <p className="mb-3 text-xs font-black uppercase tracking-[0.28em] text-brand-yellow">{t('explore.featured.label')}</p>
                          <h2 className="text-3xl font-black leading-tight sm:text-[2.45rem]">{featuredPack.title}</h2>
                        </div>
                        <div className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white/72">
                          Curated Pick
                        </div>
                      </div>

                      <p className="mb-6 max-w-2xl text-sm font-medium leading-7 text-white/74 sm:text-base">
                        {featuredPack.source_excerpt}
                      </p>

                      <div className="mb-6 grid grid-cols-2 gap-3">
                        <SignalTile label={t('explore.featured.questions')} value={featuredPack.question_count || 0} />
                        <SignalTile label={t('explore.featured.tokenSave')} value={`${featuredPack.token_savings_pct || 0}%`} />
                        <SignalTile label={t('explore.featured.words')} value={featuredPack.source_word_count || 0} />
                        <SignalTile label={t('explore.featured.language')} value={featuredPack.source_language || t('explore.packCard.notAvailable')} />
                      </div>

                      <div className="mb-6 flex flex-wrap gap-2">
                        {(featuredPack.top_tags?.length ? featuredPack.top_tags : featuredPack.topic_fingerprint || []).slice(0, 5).map((tag: string) => (
                          <span key={`hero-${tag}`} className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-white/82">
                            {tag}
                          </span>
                        ))}
                      </div>

                      <div className={`flex flex-wrap items-center gap-3 ${isRtl ? 'justify-end' : ''}`}>
                        <button
                          onClick={() => setSelectedPack(featuredPack)}
                          className={`flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-7 py-4 font-black text-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A] transition-transform hover:-translate-y-0.5 ${isRtl ? 'flex-row-reverse' : ''}`}
                        >
                          {t('explore.featured.openIntel')}
                          <ArrowRight className={`h-4 w-4 ${isRtl ? 'rotate-180' : ''}`} />
                        </button>
                        <div className="rounded-full border border-white/15 bg-white/8 px-4 py-3 text-sm font-bold text-white/72">
                          {(featuredPack.top_tags?.[0] || featuredPack.topic_fingerprint?.[0] || 'General')} focus
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-8 xl:grid-cols-[300px_1fr]">
            <aside className="space-y-6">
              <div className="rounded-[2.4rem] border-4 border-brand-dark bg-white p-6 shadow-[8px_8px_0px_0px_#1A1A1A] xl:sticky xl:top-24">
                <div className="mb-5 flex items-center gap-3">
                  <BrainCircuit className="h-6 w-6 text-brand-purple" />
                  <h3 className="text-2xl font-black">{t('explore.filters.title')}</h3>
                </div>

                <div className="mb-6 rounded-[1.7rem] border-2 border-brand-dark bg-[linear-gradient(135deg,_#fff8ea_0%,_#ffffff_52%,_#f7f0ff_100%)] p-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-brand-dark/45">Discovery Mode</p>
                  <p className="text-sm font-bold leading-6 text-brand-dark/70">
                    Scan public packs, focus the concept cluster you want, and jump into the strongest teaching angle fast.
                  </p>
                </div>

                <div className="mb-6">
                  <p className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45">{t('explore.filters.sortBy')}</p>
                  <div className="flex flex-wrap gap-2">
                    {SORT_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setSortBy(option.id)}
                        className={`rounded-full border-2 border-brand-dark px-4 py-2 text-sm font-black transition-transform hover:-translate-y-0.5 ${sortBy === option.id ? 'bg-brand-yellow shadow-[3px_3px_0px_0px_#1A1A1A]' : 'bg-brand-bg'}`}
                      >
                        {t(`explore.filters.sortLabels.${option.id}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45">{t('explore.filters.conceptClusters')}</p>
                  <div className="space-y-2">
                    <CategoryChip
                      name={t('explore.filters.all')}
                      count={packs.length}
                      active={activeCategory === 'All'}
                      onClick={() => setActiveCategory('All')}
                      icon={<BookOpen className="h-4 w-4" />}
                    />
                    {categories.slice(0, 10).map((category) => {
                      const Icon = CATEGORY_ICONS[category.name] || BookOpen;
                      return (
                        <div key={category.name}>
                          <CategoryChip
                            name={category.name}
                            count={category.count}
                            active={activeCategory === category.name}
                            onClick={() => setActiveCategory(category.name)}
                            icon={<Icon className="h-4 w-4" />}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </aside>

            <section className="space-y-6 pb-16">
              <div className="flex flex-col gap-4 rounded-[2.2rem] border-4 border-brand-dark bg-white p-5 shadow-[8px_8px_0px_0px_#1A1A1A] sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div>
                  <p className="mb-2 text-xs font-black uppercase tracking-[0.24em] text-brand-purple">Pack Atlas</p>
                  <h2 className="text-3xl font-black tracking-tight sm:text-4xl">{t('explore.atlas.title')}</h2>
                  <p className="mt-2 font-bold text-brand-dark/60">
                    {filteredPacks.length} {t('explore.atlas.results')} · {activeCategory === 'All' ? t('explore.atlas.allConcepts') : activeCategory}
                  </p>
                </div>
                <button
                  onClick={() => navigate(teacherSignedIn ? '/teacher/dashboard' : '/auth')}
                  className="w-full rounded-full border-2 border-brand-dark bg-brand-dark px-5 py-3 font-black text-white shadow-[4px_4px_0px_0px_#B488FF] transition-transform hover:-translate-y-0.5 sm:w-auto"
                >
                  {teacherSignedIn ? t('explore.atlas.openStudio') : t('explore.atlas.teacherAccess')}
                </button>
              </div>

              {loading ? (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="h-[320px] animate-pulse rounded-[2rem] border-4 border-brand-dark bg-white shadow-[8px_8px_0px_0px_#1A1A1A]" />
                  ))}
                </div>
              ) : error ? (
                <div className="rounded-[2rem] border-4 border-brand-dark bg-white p-10 shadow-[6px_6px_0px_0px_#1A1A1A]">
                  <p className="mb-2 text-2xl font-black">{t('explore.atlas.unavailable')}</p>
                  <p className="font-bold text-brand-dark/60">{error}</p>
                </div>
              ) : filteredPacks.length > 0 ? (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">
                  {filteredPacks.map((pack, index) => (
                    <div key={pack.id}>
                      <PackCard pack={pack} index={index} onOpen={() => setSelectedPack(pack)} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[2rem] border-4 border-brand-dark bg-white p-12 text-center shadow-[8px_8px_0px_0px_#1A1A1A]">
                  <p className="mb-3 text-3xl font-black">{t('explore.atlas.noMatches')}</p>
                  <p className="font-bold text-brand-dark/60">{t('explore.atlas.noMatchesBody')}</p>
                </div>
              )}
            </section>
          </section>
        </main>
      </div>

      {selectedPack && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
          <div className="h-full w-full max-w-[640px] overflow-y-auto border-l-4 border-brand-dark bg-[linear-gradient(180deg,_#ffffff_0%,_#fffaf2_100%)] p-4 shadow-[-8px_0_0_0_#1A1A1A] sm:p-6">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-brand-purple">{t('explore.drawer.label')}</p>
                <h2 className="text-3xl font-black leading-tight sm:text-4xl">{selectedPack.title}</h2>
              </div>
              <button
                onClick={() => setSelectedPack(null)}
                className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-brand-dark bg-white"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="safe-grid-2 mb-6">
              <DrawerStat label={t('explore.drawer.questions')} value={selectedPack.question_count || 0} />
              <DrawerStat label={t('explore.drawer.tokenSave')} value={`${selectedPack.token_savings_pct || 0}%`} />
              <DrawerStat label={t('explore.drawer.words')} value={selectedPack.source_word_count || 0} />
              <DrawerStat label={t('explore.drawer.language')} value={selectedPack.source_language || t('explore.packCard.notAvailable')} />
            </div>

            <div className="mb-6 rounded-[1.8rem] border-2 border-brand-dark bg-brand-bg p-5">
              <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-brand-orange">{t('explore.drawer.teachingBrief')}</p>
              <p className="whitespace-pre-line font-medium leading-7 text-brand-dark/75">{selectedPack.teaching_brief || selectedPack.source_excerpt}</p>
            </div>

            <div className="mb-6">
              <p className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45">{t('explore.drawer.keyPoints')}</p>
              <div className="space-y-3">
                {(selectedPack.key_points || []).slice(0, 4).map((point: string) => (
                  <div key={point} className="rounded-[1.3rem] border-2 border-brand-dark bg-white p-4 font-medium leading-6 text-brand-dark/75">
                    {point}
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-8">
              <p className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45">{t('explore.drawer.conceptFingerprint')}</p>
              <div className="flex flex-wrap gap-2">
                {(selectedPack.topic_fingerprint?.length ? selectedPack.topic_fingerprint : selectedPack.top_tags || []).slice(0, 8).map((tag: string) => (
                  <span key={tag} className="rounded-full border-2 border-brand-purple/20 bg-brand-purple/10 px-3 py-2 text-xs font-black uppercase text-brand-purple">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="action-row">
              <button
                onClick={() => navigate(teacherSignedIn ? '/teacher/dashboard' : '/auth')}
                className="action-pill flex-1 rounded-2xl border-2 border-brand-dark bg-brand-dark px-6 py-4 font-black text-white"
              >
                {teacherSignedIn ? t('explore.drawer.openInStudio') : t('explore.drawer.teacherAccess')}
              </button>
              <button
                onClick={() => navigate('/teacher/pack/create')}
                className="action-pill rounded-2xl border-2 border-brand-dark bg-brand-orange px-6 py-4 font-black text-white"
              >
                {t('explore.drawer.createSimilar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone: 'dark' | 'light' | 'orange' | 'purple' }) {
  const classes =
    tone === 'dark'
      ? 'bg-brand-dark text-white shadow-[6px_6px_0px_0px_#B488FF]'
      : tone === 'orange'
        ? 'bg-brand-orange text-white shadow-[6px_6px_0px_0px_#1A1A1A]'
        : tone === 'purple'
          ? 'bg-brand-purple text-white shadow-[6px_6px_0px_0px_#1A1A1A]'
          : 'bg-white text-brand-dark shadow-[6px_6px_0px_0px_#1A1A1A]';

  return (
    <div className={`${classes} rounded-[1.8rem] border-4 border-brand-dark p-5`}>
      <p className="mb-2 text-[11px] font-black uppercase tracking-[0.24em] opacity-70">{label}</p>
      <p className="text-3xl font-black sm:text-[2.15rem]">{value}</p>
    </div>
  );
}

function SignalTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[1.45rem] border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-white/45">{label}</p>
      <p className="text-2xl font-black sm:text-[1.85rem]">{value}</p>
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
      className={`flex w-full items-center justify-between gap-3 rounded-[1.35rem] border-2 border-brand-dark px-4 py-3 font-black transition-transform hover:-translate-y-0.5 ${active ? 'bg-brand-yellow shadow-[4px_4px_0px_0px_#1A1A1A]' : 'bg-brand-bg'} ${direction === 'rtl' ? 'text-right' : 'text-left'}`}
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
  const { t, direction } = useAppLanguage();
  const isRtl = direction === 'rtl';
  const accent = index % 4 === 0 ? 'bg-brand-yellow' : index % 4 === 1 ? 'bg-brand-orange' : index % 4 === 2 ? 'bg-brand-purple' : 'bg-sky-300';

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.25) }}
      className={`overflow-hidden rounded-[2.2rem] border-4 border-brand-dark bg-white p-6 shadow-[8px_8px_0px_0px_#1A1A1A] transition-transform hover:-translate-y-1 ${isRtl ? 'text-right' : 'text-left'}`}
    >
      <div className={`mb-5 rounded-[1.8rem] border-2 border-brand-dark ${accent} p-5`}>
        <div className={`mb-4 flex items-start justify-between gap-4 ${isRtl ? 'flex-row-reverse' : ''}`}>
          <div>
            <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">
              {pack.source_language || t('explore.packCard.notAvailable')}
            </p>
            <h3 className="text-[2rem] font-black leading-tight">{pack.title}</h3>
          </div>
          <div className="rounded-full border-2 border-brand-dark bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.15em]">
            {pack.question_count || 0} {t('explore.packCard.questionShort')}
          </div>
        </div>
        <p className="line-clamp-3 font-bold leading-7 text-brand-dark/75">{pack.source_excerpt}</p>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 xs:grid-cols-3">
        <PackMetric label={t('explore.packCard.tokenSave')} value={`${pack.token_savings_pct || 0}%`} />
        <PackMetric label={t('explore.packCard.words')} value={pack.source_word_count || 0} />
        <PackMetric label={t('explore.packCard.prompt')} value={pack.estimated_prompt_tokens || 0} />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {(pack.top_tags?.length ? pack.top_tags : pack.topic_fingerprint || []).slice(0, 4).map((tag: string) => (
          <span key={`${pack.id}-${tag}`} className="rounded-full border-2 border-brand-dark bg-brand-bg px-3 py-1 text-xs font-black uppercase tracking-[0.12em]">
            {tag}
          </span>
        ))}
      </div>

      <div className="mb-5 space-y-3">
        {(pack.key_points || []).slice(0, 2).map((point: string) => (
          <div key={point} className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg px-4 py-3 font-medium leading-6 text-brand-dark/75">
            {point}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-black uppercase tracking-[0.14em] text-brand-purple">{t('explore.packCard.openIntel')}</span>
        <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-brand-dark bg-brand-dark text-white">
          <ArrowRight className={`h-4 w-4 ${isRtl ? 'rotate-180' : ''}`} />
        </div>
      </div>
    </motion.button>
  );
}

function PackMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg p-3">
      <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/40">{label}</p>
      <p className="text-lg font-black">{value}</p>
    </div>
  );
}

function DrawerStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
      <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/40">{label}</p>
      <p className="text-2xl font-black">{value}</p>
    </div>
  );
}
