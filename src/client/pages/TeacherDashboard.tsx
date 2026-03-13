import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  BarChart,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  Compass,
  Copy,
  Filter,
  HelpCircle,
  Library,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { loadTeacherSettings } from '../lib/localData.ts';
import { trackTeacherSessionLaunch } from '../lib/appAnalytics.ts';
import { signOutTeacher } from '../lib/teacherAuth.ts';
import { apiFetch, apiFetchJson } from '../lib/api.ts';
import { GAME_MODES, getGameMode } from '../lib/gameModes.ts';

const SORT_OPTIONS = [
  { id: 'recent', label: 'Recent activity' },
  { id: 'newest', label: 'Newest first' },
  { id: 'questions', label: 'Most questions' },
  { id: 'usage', label: 'Most used' },
  { id: 'az', label: 'A to Z' },
] as const;

type SortOption = (typeof SORT_OPTIONS)[number]['id'];

function formatRelativeTime(value?: string | null) {
  if (!value) return 'Not run yet';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Recently';

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(timestamp));
}

function getPackState(pack: any) {
  if (Number(pack.active_session_count || 0) > 0) {
    return {
      label: 'Live now',
      body: `PIN ${pack.last_session_pin || 'ready'} is still open for students.`,
      tone: 'bg-brand-orange text-white',
    };
  }
  if (Number(pack.session_count || 0) > 0) {
    return {
      label: 'Re-run ready',
      body: `Last live run ${formatRelativeTime(pack.last_session_at)} with ${pack.last_session_players || 0} students.`,
      tone: 'bg-brand-yellow text-brand-dark',
    };
  }
  return {
    label: 'Ready to host',
    body: `${pack.question_count || 0} questions are ready for the first live run.`,
    tone: 'bg-emerald-200 text-brand-dark',
  };
}

async function readApiError(response: Response) {
  try {
    const payload = await response.json();
    return payload?.error || 'Request failed';
  } catch {
    return 'Request failed';
  }
}

export default function TeacherDashboard() {
  const [packs, setPacks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [selectedPack, setSelectedPack] = useState<any>(null);
  const [hostingPack, setHostingPack] = useState<any>(null);
  const [deletingPack, setDeletingPack] = useState<any>(null);
  const [selectedGameMode, setSelectedGameMode] = useState<string>('classic_quiz');
  const [selectedTeamCount, setSelectedTeamCount] = useState<number>(4);
  const [busyAction, setBusyAction] = useState<{ packId: number; action: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const navigate = useNavigate();
  const teacherProfile = loadTeacherSettings().profile;

  const loadPacks = async () => {
    try {
      setLoading(true);
      setError('');
      const payload = await apiFetchJson('/api/teacher/packs');
      setPacks(Array.isArray(payload) ? payload : []);
    } catch (loadError: any) {
      setError(loadError?.message || 'Failed to load your packs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPacks();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const handleLogout = async () => {
    await signOutTeacher();
    navigate('/');
  };

  const categories = useMemo(() => {
    const tags = Array.from(new Set(packs.flatMap((pack) => pack.top_tags || []))).filter(Boolean);
    return ['All', ...tags];
  }, [packs]);

  const filteredPacks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const scoped = packs.filter((pack) => {
      const searchFields = [
        pack.title,
        pack.source_text,
        pack.source_excerpt,
        pack.teaching_brief,
        ...(pack.top_tags || []),
        ...(pack.topic_fingerprint || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const matchesSearch = !normalizedQuery || searchFields.includes(normalizedQuery);
      const matchesCategory =
        activeCategory === 'All' ||
        (pack.top_tags || []).includes(activeCategory) ||
        (pack.topic_fingerprint || []).includes(activeCategory);
      return matchesSearch && matchesCategory;
    });

    return [...scoped].sort((left, right) => {
      if (sortBy === 'az') {
        return String(left.title || '').localeCompare(String(right.title || ''));
      }
      if (sortBy === 'questions') {
        return Number(right.question_count || 0) - Number(left.question_count || 0);
      }
      if (sortBy === 'usage') {
        return Number(right.session_count || 0) - Number(left.session_count || 0);
      }

      const leftDate =
        new Date((sortBy === 'recent' ? left.last_session_at : left.created_at) || 0).getTime() || 0;
      const rightDate =
        new Date((sortBy === 'recent' ? right.last_session_at : right.created_at) || 0).getTime() || 0;
      return rightDate - leftDate || Number(right.id || 0) - Number(left.id || 0);
    });
  }, [activeCategory, packs, searchQuery, sortBy]);

  const dashboardStats = useMemo(() => {
    const totalQuestions = packs.reduce((sum, pack) => sum + Number(pack.question_count || 0), 0);
    return [
      {
        id: 'packs',
        label: 'My packs',
        value: packs.length,
        body: 'Everything you can host, copy, or retire from one board.',
        tone: 'bg-white',
      },
      {
        id: 'questions',
        label: 'Questions',
        value: totalQuestions,
        body: 'Total question inventory across your teaching library.',
        tone: 'bg-brand-yellow',
      },
      {
        id: 'live',
        label: 'Live rooms',
        value: packs.filter((pack) => Number(pack.active_session_count || 0) > 0).length,
        body: 'Reopen these rooms instantly without creating another session.',
        tone: 'bg-brand-orange text-white',
      },
      {
        id: 'history',
        label: 'Re-run ready',
        value: packs.filter((pack) => Number(pack.session_count || 0) > 0).length,
        body: 'Packs with prior session history and reports attached.',
        tone: 'bg-brand-purple text-white',
      },
    ];
  }, [packs]);

  const handleHost = async (packId: number, gameType = selectedGameMode, teamCount = selectedTeamCount) => {
    try {
      setBusyAction({ packId, action: 'host' });
      const res = await apiFetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quiz_pack_id: packId,
          game_type: gameType,
          team_count: getGameMode(gameType).teamBased ? teamCount : 0,
        }),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }
      const data = await res.json();
      setHostingPack(null);
      void trackTeacherSessionLaunch({
        gameType,
        teamCount: getGameMode(gameType).teamBased ? teamCount : 0,
      });
      navigate(`/teacher/session/${data.pin}/host`, { state: { sessionId: data.id, packId } });
    } catch (hostError: any) {
      setNotice({ tone: 'error', message: hostError?.message || 'Failed to start the live session.' });
    } finally {
      setBusyAction(null);
    }
  };

  const openHostModal = (pack: any) => {
    const defaultMode = GAME_MODES[0];
    setHostingPack(pack);
    setSelectedGameMode(defaultMode.id);
    setSelectedTeamCount(defaultMode.defaultTeamCount || 4);
  };

  const openLiveRoom = (pack: any) => {
    if (!pack?.last_session_pin) return;
    navigate(`/teacher/session/${pack.last_session_pin}/host`, {
      state: { sessionId: pack.last_session_id, packId: pack.id },
    });
  };

  const handlePreview = async (pack: any) => {
    try {
      setBusyAction({ packId: Number(pack.id), action: 'preview' });
      const res = await apiFetch(`/api/packs/${pack.id}`);
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }
      const data = await res.json();
      setSelectedPack({ ...pack, ...data });
    } catch (previewError: any) {
      setNotice({ tone: 'error', message: previewError?.message || 'Failed to open the pack preview.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDuplicate = async (pack: any) => {
    try {
      setBusyAction({ packId: Number(pack.id), action: 'duplicate' });
      const response = await apiFetch(`/api/teacher/packs/${pack.id}/duplicate`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const duplicatedPack = await response.json();
      await loadPacks();
      setNotice({
        tone: 'success',
        message: `${pack.title} was copied as ${duplicatedPack?.title || 'a new pack'}.`,
      });
    } catch (duplicateError: any) {
      setNotice({ tone: 'error', message: duplicateError?.message || 'Failed to duplicate this pack.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async () => {
    if (!deletingPack) return;
    try {
      setBusyAction({ packId: Number(deletingPack.id), action: 'delete' });
      const response = await apiFetch(`/api/teacher/packs/${deletingPack.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const payload = await response.json();
      setDeletingPack(null);
      setSelectedPack((current: any) => (Number(current?.id) === Number(payload.pack_id) ? null : current));
      setHostingPack((current: any) => (Number(current?.id) === Number(payload.pack_id) ? null : current));
      await loadPacks();
      setNotice({
        tone: 'success',
        message: `${payload.title} was deleted${payload?.impact?.sessions ? ` together with ${payload.impact.sessions} old session${payload.impact.sessions === 1 ? '' : 's'}` : ''}.`,
      });
    } catch (deleteError: any) {
      setNotice({ tone: 'error', message: deleteError?.message || 'Failed to delete this pack.' });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-dark font-sans flex overflow-hidden selection:bg-brand-orange selection:text-white">
      <motion.aside
        animate={{ width: isSidebarOpen ? 256 : 80 }}
        className="h-screen bg-white border-r-2 border-brand-dark flex flex-col flex-shrink-0 transition-all duration-300 relative z-20 shadow-[4px_0px_0px_0px_#1A1A1A]"
      >
        <div className="h-20 flex items-center px-6 border-b-2 border-brand-dark">
          {isSidebarOpen ? (
            <div className="text-2xl font-black tracking-tight flex items-center gap-1 cursor-pointer" onClick={() => navigate('/')}>
              <span className="text-brand-orange">Quiz</span>zi
            </div>
          ) : (
            <div className="w-10 h-10 bg-brand-yellow border-2 border-brand-dark text-brand-dark rounded-full flex items-center justify-center text-xl font-black mx-auto cursor-pointer" onClick={() => navigate('/')}>
              Q
            </div>
          )}
        </div>

        <div className="p-4 border-b-2 border-brand-dark">
          <button
            onClick={() => navigate('/teacher/pack/create')}
            className="w-full bg-brand-orange text-white border-2 border-brand-dark rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#e84d2a] transition-all shadow-[2px_2px_0px_0px_#1A1A1A] py-3"
          >
            <Plus className="w-5 h-5" />
            {isSidebarOpen && <span className="text-base">Create Quiz</span>}
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto hide-scrollbar">
          <NavItem icon={<Library />} label="My Quizzes" isOpen={isSidebarOpen} active onClick={() => navigate('/teacher/dashboard')} />
          <NavItem icon={<Compass />} label="Discover" isOpen={isSidebarOpen} onClick={() => navigate('/explore')} />
          <NavItem icon={<BarChart />} label="Reports" isOpen={isSidebarOpen} onClick={() => navigate('/teacher/reports')} />
          <NavItem icon={<Users />} label="Classes" isOpen={isSidebarOpen} onClick={() => navigate('/teacher/classes')} />

          <div className="my-4 border-t-2 border-brand-dark relative">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="absolute -right-6 top-1/2 -translate-y-1/2 w-6 h-6 bg-brand-yellow rounded-full flex items-center justify-center border-2 border-brand-dark hover:bg-yellow-300 transition-colors z-10 shadow-[2px_2px_0px_0px_#1A1A1A]"
            >
              <ChevronLeft className={`w-4 h-4 transition-transform ${!isSidebarOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>

          <NavItem icon={<Settings />} label="Settings" isOpen={isSidebarOpen} onClick={() => navigate('/teacher/settings')} />
          <NavItem icon={<HelpCircle />} label="Help Center" isOpen={isSidebarOpen} onClick={() => navigate('/teacher/help')} />
        </nav>

        <div className="p-4 border-t-2 border-brand-dark bg-brand-purple/10">
          <div className={`flex items-center ${isSidebarOpen ? 'justify-between' : 'justify-center'} bg-white border-2 border-brand-dark p-2 rounded-xl shadow-[2px_2px_0px_0px_#1A1A1A]`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-brand-yellow rounded-full flex items-center justify-center text-sm border-2 border-brand-dark overflow-hidden">
                {teacherProfile.avatar}
              </div>
              {isSidebarOpen && (
                <div>
                  <p className="font-black text-xs">{teacherProfile.firstName} {teacherProfile.lastName}</p>
                  <p className="text-[10px] font-bold text-brand-dark/60 truncate w-24">{teacherProfile.email}</p>
                </div>
              )}
            </div>
            {isSidebarOpen && (
              <button
                onClick={handleLogout}
                className="w-8 h-8 bg-brand-bg border-2 border-brand-dark text-brand-dark rounded-lg flex items-center justify-center hover:bg-brand-orange hover:text-white transition-colors"
                title="Log out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </motion.aside>

      <main className="flex-1 h-screen overflow-y-auto p-6 lg:p-8 relative bg-brand-bg">
        <div className="absolute top-[-10%] right-[-5%] w-64 h-64 border-[3px] border-brand-dark/5 rounded-full pointer-events-none" />
        <div className="absolute bottom-[-10%] left-[-5%] w-48 h-48 border-[3px] border-brand-dark/5 rounded-full pointer-events-none" />

        <div className="max-w-[1280px] mx-auto relative z-10">
          <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6 mb-6">
            <div className="max-w-3xl">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-purple mb-2">My Quizzes</p>
              <h1 className="text-4xl lg:text-5xl font-black tracking-tight leading-tight">Run, reuse, and clean up your pack library</h1>
              <p className="font-bold text-brand-dark/62 mt-3">
                This board is now tuned for fast pack management: reopen live rooms, duplicate strong material, and delete retired packs without hunting through other screens.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => void loadPacks()}
                className="px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              <button
                onClick={() => navigate('/teacher/pack/create')}
                className="px-5 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
              >
                <Plus className="w-4 h-4" />
                Create Pack
              </button>
            </div>
          </div>

          {notice && (
            <div className={`mb-6 rounded-[1.5rem] border-2 border-brand-dark p-4 shadow-[3px_3px_0px_0px_#1A1A1A] ${notice.tone === 'success' ? 'bg-emerald-100' : 'bg-brand-orange/15'}`}>
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-full border-2 border-brand-dark flex items-center justify-center ${notice.tone === 'success' ? 'bg-white text-emerald-600' : 'bg-white text-brand-orange'}`}>
                  {notice.tone === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                </div>
                <div>
                  <p className="font-black">{notice.tone === 'success' ? 'Done' : 'Something needs attention'}</p>
                  <p className="font-medium text-brand-dark/75">{notice.message}</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            {dashboardStats.map((stat) => (
              <div key={stat.id} className={`${stat.tone} rounded-[1.7rem] border-4 border-brand-dark p-5 shadow-[6px_6px_0px_0px_#1A1A1A]`}>
                <p className="text-xs font-black uppercase tracking-[0.2em] opacity-70 mb-3">{stat.label}</p>
                <p className="text-4xl font-black leading-none">{stat.value}</p>
                <p className="font-medium text-sm opacity-80 mt-3">{stat.body}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-5 lg:p-6 mb-6">
            <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between mb-4">
              <div className="flex-1 flex flex-col md:flex-row gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-dark/40" />
                  <input
                    id="search-quizzes"
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search packs, concepts, tags, or teaching briefs..."
                    aria-label="Search your quizzes"
                    className="w-full bg-brand-bg border-2 border-brand-dark rounded-full py-3 pl-12 pr-4 text-base font-bold placeholder:text-brand-dark/40 focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <div className="min-w-[180px] rounded-full border-2 border-brand-dark bg-brand-bg px-4 py-3 flex items-center gap-3">
                    <Filter className="w-4 h-4 shrink-0" />
                    <select
                      value={sortBy}
                      onChange={(event) => setSortBy(event.target.value as SortOption)}
                      className="bg-transparent w-full font-black focus:outline-none"
                    >
                      {SORT_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    aria-label="Reset quiz filters"
                    onClick={() => {
                      setSearchQuery('');
                      setActiveCategory('All');
                      setSortBy('recent');
                    }}
                    className="px-5 py-3 bg-brand-bg border-2 border-brand-dark rounded-full flex items-center gap-2 hover:bg-brand-yellow transition-colors font-black"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
                {categories.map((category) => (
                  <button
                    key={category}
                    aria-pressed={activeCategory === category}
                    onClick={() => setActiveCategory(category)}
                    className={`px-4 py-2 rounded-full whitespace-nowrap text-sm font-black border-2 border-brand-dark transition-all ${activeCategory === category ? 'bg-brand-purple text-white shadow-[2px_2px_0px_0px_#1A1A1A]' : 'bg-white text-brand-dark hover:bg-brand-yellow'}`}
                  >
                    {category}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 text-sm font-black text-brand-dark/60">
                <span>{filteredPacks.length} of {packs.length} packs visible</span>
                <span className="hidden md:inline">•</span>
                <span>{packs.filter((pack) => Number(pack.active_session_count || 0) > 0).length} live now</span>
              </div>
            </div>
          </div>

          {error && !loading && (
            <div className="bg-white border-2 border-brand-dark rounded-[2rem] p-8 mb-6 shadow-[4px_4px_0px_0px_#1A1A1A]">
              <p className="text-2xl font-black mb-2">Your pack board did not load cleanly.</p>
              <p className="font-bold text-brand-dark/60 mb-4">{error}</p>
              <button
                onClick={() => void loadPacks()}
                className="px-5 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black"
              >
                Try again
              </button>
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={`skeleton-${index}`} className="rounded-[2rem] border-4 border-brand-dark bg-white p-6 shadow-[6px_6px_0px_0px_#1A1A1A] min-h-[320px] animate-pulse">
                  <div className="h-6 w-24 rounded-full bg-brand-bg mb-4" />
                  <div className="h-12 rounded-2xl bg-brand-bg mb-5" />
                  <div className="grid grid-cols-2 gap-3 mb-5">
                    <div className="h-16 rounded-2xl bg-brand-bg" />
                    <div className="h-16 rounded-2xl bg-brand-bg" />
                    <div className="h-16 rounded-2xl bg-brand-bg" />
                    <div className="h-16 rounded-2xl bg-brand-bg" />
                  </div>
                  <div className="h-20 rounded-2xl bg-brand-bg mb-5" />
                  <div className="grid grid-cols-2 gap-3 mt-auto">
                    <div className="h-12 rounded-2xl bg-brand-bg" />
                    <div className="h-12 rounded-2xl bg-brand-bg" />
                    <div className="h-12 rounded-2xl bg-brand-bg" />
                    <div className="h-12 rounded-2xl bg-brand-bg" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              <motion.button
                whileHover={{ scale: 1.02, rotate: 1 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => navigate('/teacher/pack/create')}
                className="rounded-[2rem] border-4 border-dashed border-brand-dark bg-brand-yellow/10 min-h-[320px] p-8 flex flex-col items-center justify-center text-center shadow-[6px_6px_0px_0px_#1A1A1A]"
              >
                <div className="w-24 h-24 bg-brand-yellow border-4 border-brand-dark rounded-[2rem] flex items-center justify-center shadow-[6px_6px_0px_0px_#1A1A1A] mb-6">
                  <Plus className="w-12 h-12 text-brand-dark" />
                </div>
                <h3 className="text-2xl font-black uppercase tracking-tight">Create New Pack</h3>
                <p className="font-bold text-brand-dark/60 mt-3 max-w-xs">
                  Start from source material, generate a fresh set of questions, or draft one manually from scratch.
                </p>
              </motion.button>

              {filteredPacks.map((pack, index) => {
                const state = getPackState(pack);
                const isBusy = Number(busyAction?.packId) === Number(pack.id);
                return (
                  <motion.div
                    key={pack.id}
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className="rounded-[2rem] border-4 border-brand-dark bg-white p-6 shadow-[8px_8px_0px_0px_#1A1A1A] flex flex-col min-h-[320px]"
                  >
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">
                          Created {formatRelativeTime(pack.created_at)}
                        </p>
                        <h3 className="text-2xl font-black leading-tight line-clamp-2">{pack.title}</h3>
                      </div>
                      <span className={`${state.tone} shrink-0 rounded-full border-2 border-brand-dark px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em]`}>
                        {state.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <PackMetric label="Questions" value={pack.question_count || 0} />
                      <PackMetric label="Sessions" value={pack.session_count || 0} />
                      <PackMetric label="Last live" value={formatRelativeTime(pack.last_session_at)} />
                      <PackMetric label="Players" value={pack.last_session_players || 0} />
                    </div>

                    <p className="font-medium text-brand-dark/72 mb-4 line-clamp-3">
                      {pack.teaching_brief || pack.source_excerpt || pack.source_text || 'No teaching summary is available for this pack yet.'}
                    </p>

                    <div className="flex flex-wrap gap-2 mb-4">
                      {(pack.top_tags?.length ? pack.top_tags : ['General']).slice(0, 4).map((tag: string) => (
                        <span key={`${pack.id}-${tag}`} className="px-3 py-1 rounded-full bg-brand-bg border-2 border-brand-dark text-[11px] font-black uppercase tracking-[0.14em]">
                          {tag}
                        </span>
                      ))}
                    </div>

                    <div className="rounded-[1.3rem] border-2 border-brand-dark bg-brand-bg p-4 mb-4">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-white border-2 border-brand-dark flex items-center justify-center shrink-0">
                          {Number(pack.active_session_count || 0) > 0 ? <Sparkles className="w-5 h-5 text-brand-orange" /> : <CalendarDays className="w-5 h-5 text-brand-purple" />}
                        </div>
                        <div>
                          <p className="font-black leading-tight">{state.body}</p>
                          <p className="font-medium text-sm text-brand-dark/62 mt-1">
                            {Number(pack.session_count || 0) > 0
                              ? `${pack.session_count} prior session${Number(pack.session_count) === 1 ? '' : 's'} remain attached to this pack.`
                              : 'This pack has not been used live yet.'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-auto">
                      <button
                        onClick={() => (Number(pack.active_session_count || 0) > 0 ? openLiveRoom(pack) : openHostModal(pack))}
                        disabled={isBusy}
                        className="bg-brand-orange text-white py-3 rounded-2xl font-black shadow-[3px_3px_0px_0px_#1A1A1A] border-2 border-brand-dark transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                      >
                        {Number(pack.active_session_count || 0) > 0 ? <ArrowUpRight className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
                        {Number(pack.active_session_count || 0) > 0 ? 'Open Live' : 'Host'}
                      </button>
                      <button
                        onClick={() => void handlePreview(pack)}
                        disabled={isBusy}
                        className="bg-white border-2 border-brand-dark rounded-2xl py-3 font-black shadow-[3px_3px_0px_0px_#1A1A1A] hover:bg-brand-bg transition-colors disabled:opacity-60"
                      >
                        Preview
                      </button>
                      <button
                        onClick={() => void handleDuplicate(pack)}
                        disabled={isBusy}
                        className="bg-brand-bg border-2 border-brand-dark rounded-2xl py-3 font-black shadow-[3px_3px_0px_0px_#1A1A1A] hover:bg-white transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                      >
                        <Copy className="w-4 h-4" />
                        Duplicate
                      </button>
                      <button
                        onClick={() => setDeletingPack(pack)}
                        disabled={isBusy}
                        className="bg-white border-2 border-brand-dark rounded-2xl py-3 font-black shadow-[3px_3px_0px_0px_#1A1A1A] hover:bg-brand-orange hover:text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {!loading && filteredPacks.length === 0 && (
            <div className="bg-white border-2 border-brand-dark rounded-[2rem] p-10 mt-6 shadow-[4px_4px_0px_0px_#1A1A1A] text-center">
              <p className="text-2xl font-black mb-2">No packs matched this view.</p>
              <p className="font-bold text-brand-dark/60 mb-4">Try another term, clear filters, or build a new pack.</p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setActiveCategory('All');
                  setSortBy('recent');
                }}
                className="px-5 py-3 bg-brand-yellow border-2 border-brand-dark rounded-full font-black"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      </main>

      {selectedPack && (
        <div className="fixed inset-0 bg-black/25 z-40 flex justify-end">
          <div className="w-full max-w-xl h-full bg-white border-l-4 border-brand-dark p-6 overflow-y-auto shadow-[-8px_0_0_0_#1A1A1A]">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Pack Preview</p>
                <h2 className="text-3xl font-black break-words">{selectedPack.title}</h2>
                <p className="font-bold text-brand-dark/60 mt-2">
                  {selectedPack.question_count || selectedPack.questions?.length || 0} questions • {selectedPack.session_count || 0} session{Number(selectedPack.session_count || 0) === 1 ? '' : 's'}
                </p>
              </div>
              <button onClick={() => setSelectedPack(null)} className="w-10 h-10 rounded-full border-2 border-brand-dark flex items-center justify-center shrink-0">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <PackMetric label="Last live" value={formatRelativeTime(selectedPack.last_session_at)} />
              <PackMetric label="Players" value={selectedPack.last_session_players || 0} />
              <PackMetric label="Language" value={selectedPack.source_language || 'N/A'} />
              <PackMetric label="Token save" value={`${selectedPack.token_savings_pct || 0}%`} />
            </div>

            <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5 mb-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">Teaching brief</p>
              <p className="font-medium text-brand-dark/72 leading-relaxed">
                {selectedPack.teaching_brief || selectedPack.source_excerpt || selectedPack.source_text || 'No source summary is available.'}
              </p>
            </div>

            <div className="space-y-4 mb-8">
              {(selectedPack.questions || []).map((question: any, index: number) => {
                const tags = Array.isArray(question.tags)
                  ? question.tags
                  : (() => {
                      try {
                        return JSON.parse(question.tags_json || '[]');
                      } catch {
                        return [];
                      }
                    })();
                return (
                  <div key={question.id || `question-${index}`} className="bg-white rounded-2xl border-2 border-brand-dark p-4 shadow-[3px_3px_0px_0px_#1A1A1A]">
                    <p className="font-black mb-3">Q{index + 1}. {question.prompt}</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {tags.map((tag: string) => (
                        <span key={`${question.id}-${tag}`} className="px-3 py-1 rounded-full bg-brand-bg border-2 border-brand-dark text-[11px] font-black uppercase tracking-[0.14em]">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-dark/40">
                      {question.time_limit_seconds || 20}s per question
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setSelectedPack(null);
                  Number(selectedPack.active_session_count || 0) > 0 ? openLiveRoom(selectedPack) : openHostModal(selectedPack);
                }}
                className="bg-brand-orange text-white border-2 border-brand-dark rounded-2xl py-4 font-black"
              >
                {Number(selectedPack.active_session_count || 0) > 0 ? 'Open Live Room' : 'Host This Pack'}
              </button>
              <button
                onClick={() => void handleDuplicate(selectedPack)}
                className="bg-white border-2 border-brand-dark rounded-2xl py-4 font-black"
              >
                Duplicate
              </button>
              <button
                onClick={() => {
                  setDeletingPack(selectedPack);
                  setSelectedPack(null);
                }}
                className="col-span-2 bg-brand-bg border-2 border-brand-dark rounded-2xl py-4 font-black flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete Pack
              </button>
            </div>
          </div>
        </div>
      )}

      {deletingPack && (
        <div className="fixed inset-0 bg-black/35 z-50 flex items-center justify-center p-6">
          <div className="w-full max-w-xl bg-white rounded-[2.2rem] border-4 border-brand-dark shadow-[12px_12px_0px_0px_#1A1A1A] p-6 lg:p-7">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">Delete pack</p>
                <h2 className="text-3xl font-black">{deletingPack.title}</h2>
              </div>
              <button
                onClick={() => setDeletingPack(null)}
                className="w-11 h-11 rounded-full border-2 border-brand-dark flex items-center justify-center bg-brand-bg"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5 mb-5">
              <p className="font-black mb-3">
                {Number(deletingPack.can_delete) === 0
                  ? 'This pack still has an active live room.'
                  : 'Deleting this pack is permanent.'}
              </p>
              <p className="font-medium text-brand-dark/72">
                {Number(deletingPack.can_delete) === 0
                  ? 'End the active session first, then come back here to delete the pack safely.'
                  : Number(deletingPack.session_count || 0) > 0
                    ? 'We will remove the pack together with its old sessions, participants, answers, and behavior logs.'
                    : 'Only this pack and its questions will be removed.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <PackMetric label="Questions" value={deletingPack.question_count || 0} />
              <PackMetric label="Sessions" value={deletingPack.session_count || 0} />
              <PackMetric label="Players" value={deletingPack.last_session_players || 0} />
              <PackMetric label="Last live" value={formatRelativeTime(deletingPack.last_session_at)} />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setDeletingPack(null)}
                className="flex-1 bg-white border-2 border-brand-dark rounded-2xl py-4 font-black"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDelete()}
                disabled={!deletingPack.can_delete || Number(busyAction?.packId) === Number(deletingPack.id)}
                className="flex-1 bg-brand-orange text-white border-2 border-brand-dark rounded-2xl py-4 font-black disabled:opacity-50"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {hostingPack && (
        <div className="fixed inset-0 bg-black/35 z-50 flex items-center justify-center p-6">
          <div className="w-full max-w-4xl bg-white rounded-[2.4rem] border-4 border-brand-dark shadow-[12px_12px_0px_0px_#1A1A1A] p-6 lg:p-8">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Launch Setup</p>
                <h2 className="text-3xl font-black">{hostingPack.title}</h2>
                <p className="font-bold text-brand-dark/60 mt-2">Choose a live format. Group modes are tuned for collaborative retrieval and discussion-heavy play.</p>
              </div>
              <button
                onClick={() => setHostingPack(null)}
                className="w-11 h-11 rounded-full border-2 border-brand-dark flex items-center justify-center bg-brand-bg"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
              {GAME_MODES.map((mode) => {
                const isActive = selectedGameMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    onClick={() => {
                      setSelectedGameMode(mode.id);
                      setSelectedTeamCount(mode.defaultTeamCount || 4);
                    }}
                    className={`text-left rounded-[1.8rem] border-4 border-brand-dark p-5 transition-transform ${isActive ? 'bg-brand-yellow shadow-[8px_8px_0px_0px_#1A1A1A]' : 'bg-white shadow-[4px_4px_0px_0px_#1A1A1A] hover:-translate-y-1'}`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{mode.researchCue}</p>
                        <p className="text-2xl font-black">{mode.label}</p>
                      </div>
                      <span className={`px-3 py-2 rounded-full border-2 border-brand-dark font-black text-xs uppercase ${mode.teamBased ? 'bg-brand-dark text-brand-yellow' : 'bg-white text-brand-dark'}`}>
                        {mode.teamBased ? 'Group' : 'Solo'}
                      </span>
                    </div>
                    <p className="font-medium text-brand-dark/70 mb-4">{mode.description}</p>
                    <div className="flex flex-wrap gap-2">
                      {mode.objectives.map((objective) => (
                        <span key={objective} className="px-3 py-1 rounded-full bg-white border-2 border-brand-dark text-xs font-black">
                          {objective}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            {getGameMode(selectedGameMode).teamBased && (
              <div className="rounded-[1.8rem] border-2 border-brand-dark bg-brand-bg p-5 mb-6">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-3">Team Structure</p>
                <div className="flex flex-wrap gap-3">
                  {[3, 4, 5, 6].map((count) => (
                    <button
                      key={count}
                      onClick={() => setSelectedTeamCount(count)}
                      className={`px-4 py-3 rounded-full border-2 border-brand-dark font-black ${selectedTeamCount === count ? 'bg-brand-orange text-white' : 'bg-white text-brand-dark'}`}
                    >
                      {count} Teams
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-[1.8rem] border-2 border-brand-dark bg-brand-dark text-white p-5">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">Selected format</p>
                <p className="text-2xl font-black">{getGameMode(selectedGameMode).label}</p>
                <p className="font-medium text-white/70 mt-1">
                  {getGameMode(selectedGameMode).teamBased
                    ? `Students will be auto-assigned into ${selectedTeamCount} teams.`
                    : 'Students play individually and leaderboard remains personal.'}
                </p>
              </div>
              <button
                onClick={() => void handleHost(hostingPack.id, selectedGameMode, selectedTeamCount)}
                className="px-8 py-4 rounded-full bg-brand-orange text-white border-2 border-brand-dark font-black flex items-center gap-3 shadow-[4px_4px_0px_0px_#1A1A1A]"
              >
                <Play className="w-5 h-5 fill-current" />
                Host {getGameMode(selectedGameMode).shortLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NavItem({
  icon,
  label,
  isOpen,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  isOpen: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button onClick={onClick} aria-label={label} className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange ${active ? 'bg-brand-dark text-white border-brand-dark shadow-[2px_2px_0px_0px_#1A1A1A]' : 'bg-transparent border-transparent text-brand-dark/70 hover:bg-white hover:border-brand-dark hover:text-brand-dark hover:shadow-[2px_2px_0px_0px_#1A1A1A]'}`}>
      <div className="flex items-center gap-3">
        <div className={`w-5 h-5 flex items-center justify-center ${active ? 'text-brand-yellow' : ''}`}>
          {icon}
        </div>
        {isOpen && <span className="font-bold text-sm">{label}</span>}
      </div>
    </button>
  );
}

function PackMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[1.1rem] border-2 border-brand-dark bg-brand-bg p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-dark/45 mb-1">{label}</p>
      <p className="font-black">{value}</p>
    </div>
  );
}
