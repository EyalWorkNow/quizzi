import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  BarChart,
  BarChart3,
  BookOpen,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Compass,
  Copy,
  Filter,
  Globe,
  HelpCircle,
  History,
  Layout,
  Leaf,
  Library,
  LogOut,
  Map,
  Menu,
  Mountain,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Trash2,
  Users,
  Wind,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { loadTeacherSettings } from '../lib/localData.ts';
import { trackTeacherSessionLaunch } from '../lib/appAnalytics.ts';
import { signOutTeacher } from '../lib/teacherAuth.ts';
import { apiFetch, apiFetchJson } from '../lib/api.ts';
import { GAME_MODES, getGameMode, type GameModeId } from '../lib/gameModes.ts';
import TeacherSidebar from '../components/TeacherSidebar.tsx';
import SessionSoundtrackFields from '../components/SessionSoundtrackFields.tsx';
import { useAppLanguage } from '../lib/appLanguage.tsx';
import { DEFAULT_SESSION_SOUNDTRACKS, type SessionSoundtrackChoice } from '../../shared/sessionSoundtracks.ts';

const SORT_OPTIONS = [
  { id: 'recent' },
  { id: 'newest' },
  { id: 'questions' },
  { id: 'usage' },
  { id: 'az' },
] as const;

const ALL_CATEGORY_ID = '__all__';

type SortOption = (typeof SORT_OPTIONS)[number]['id'];

function getCategoryIcon(category: string) {
  const normalized = category.toLowerCase().trim();
  switch (normalized) {
    case 'cities': return <Building2 className="w-4 h-4" />;
    case 'physical-geography': return <Mountain className="w-4 h-4" />;
    case 'regions': return <Map className="w-4 h-4" />;
    case 'language-culture': return <Globe className="w-4 h-4" />;
    case 'history': return <History className="w-4 h-4" />;
    case 'photosynthesis': return <Leaf className="w-4 h-4" />;
    case 'energy': return <Zap className="w-4 h-4" />;
    case 'gases': return <Wind className="w-4 h-4" />;
    case 'all': return <Sparkles className="w-4 h-4" />;
    default: return <Compass className="w-4 h-4" />;
  }
}

function formatRelativeTime(t: any, value?: string | null) {
  if (!value) return t('dash.preview.notSet');
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return t('dash.preview.lastRun');

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return t('dash.preview.justNow');
  if (diffMinutes < 60) return t('dash.preview.minutesAgo', { minutes: diffMinutes });
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return t('dash.preview.hoursAgo', { hours: diffHours });
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return t('dash.preview.daysAgo', { days: diffDays });

  return new Intl.DateTimeFormat('he-IL', { month: 'short', day: 'numeric' }).format(new Date(timestamp));
}

function getPackState(t: any, pack: any) {
  if (Number(pack.active_session_count || 0) > 0) {
    return {
      label: t('dash.pack.activeSession'),
      body: t('dash.pack.activeBody', { pin: pack.latest_active_session_pin || pack.last_session_pin || t('dash.pack.ready') }),
      tone: 'bg-brand-orange text-white shadow-[0_0_20px_rgba(255,90,54,0.3)]',
    };
  }
  if (Number(pack.session_count || 0) > 0) {
    return {
      label: t('dash.pack.readyToRerun'),
      body: t('dash.pack.rerunBody', { time: formatRelativeTime(t, pack.last_session_at), players: pack.last_session_players || 0 }),
      tone: 'bg-brand-yellow text-brand-dark',
    };
  }
  return {
    label: t('dash.pack.readyToHost'),
    body: t('dash.pack.hostBody', { questions: pack.question_count || 0 }),
    tone: 'bg-emerald-200 text-brand-dark',
  };
}

function isPackPublic(pack: any) {
  return Number(pack?.is_public || 0) === 1;
}

async function readApiError(response: Response, t: any) {
  try {
    const payload = await response.json();
    return payload?.error || t('dash.error.requestFailed');
  } catch {
    return t('dash.error.requestFailed');
  }
}

function recommendModesForPack(pack: any) {
  const questionCount = Number(pack?.question_count || 0);
  const tagCount = Array.isArray(pack?.top_tags) ? pack.top_tags.length : 0;

  if (questionCount <= 5) {
    return ['speed_sprint', 'confidence_climb', 'classic_quiz'] as GameModeId[];
  }

  if (tagCount >= 4 || questionCount >= 12) {
    return ['mastery_matrix', 'peer_pods', 'classic_quiz'] as GameModeId[];
  }

  return ['peer_pods', 'confidence_climb', 'classic_quiz'] as GameModeId[];
}

export default function TeacherDashboard() {
  const [packs, setPacks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORY_ID);
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [selectedPack, setSelectedPack] = useState<any>(null);
  const [hostingPack, setHostingPack] = useState<any>(null);
  const [deletingPack, setDeletingPack] = useState<any>(null);
  const [selectedGameMode, setSelectedGameMode] = useState<string>('classic_quiz');
  const [selectedTeamCount, setSelectedTeamCount] = useState<number>(4);
  const [selectedLobbyTrackId, setSelectedLobbyTrackId] = useState<SessionSoundtrackChoice>(
    DEFAULT_SESSION_SOUNDTRACKS.lobby_track_id,
  );
  const [selectedGameplayTrackId, setSelectedGameplayTrackId] = useState<SessionSoundtrackChoice>(
    DEFAULT_SESSION_SOUNDTRACKS.gameplay_track_id,
  );
  const [busyAction, setBusyAction] = useState<{ packId: number; action: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [hasLoadedPackBoard, setHasLoadedPackBoard] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { t, direction } = useAppLanguage();
  const isRtl = direction === 'rtl';
  const teacherProfile = loadTeacherSettings().profile;

  const loadPacks = async () => {
    try {
      setLoading(true);
      setError('');
      const payload = await apiFetchJson('/api/teacher/packs');
      setPacks(Array.isArray(payload) ? payload : []);
      setHasLoadedPackBoard(true);
    } catch (loadError: any) {
      setError(loadError?.message || t('dash.error.loadPacks'));
    } finally {
      setLoading(false);
    }
  };


  const refreshDashboard = async () => {
    await Promise.allSettled([loadPacks()]);
  };

  useEffect(() => {
    void refreshDashboard();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const state = location.state as { notice?: { tone: 'success' | 'error'; message: string } } | null;
    if (!state?.notice) return;
    setNotice(state.notice);
    navigate(location.pathname, { replace: true });
  }, [location.pathname, location.state, navigate]);

  const handleLogout = async () => {
    await signOutTeacher();
    navigate('/');
  };

  const openPackEditor = (packId: number) => {
    navigate(`/teacher/pack/${packId}/edit`);
  };

  const loadPackPreview = async (packId: number) => {
    const [packResponse, versionsResponse] = await Promise.all([
      apiFetch(`/api/teacher/packs/${packId}`),
      apiFetch(`/api/teacher/packs/${packId}/versions`),
    ]);
    if (!packResponse.ok) {
      throw new Error(await readApiError(packResponse, t));
    }
    const packPayload = await packResponse.json();
    const versionsPayload = versionsResponse.ok ? await versionsResponse.json().catch(() => ({ versions: [] })) : { versions: [] };
    return {
      ...packPayload,
      versions: Array.isArray(versionsPayload?.versions) ? versionsPayload.versions : [],
    };
  };

  const categories = useMemo(() => {
    const tags = Array.from(new Set(packs.flatMap((pack) => pack.top_tags || []))).filter(Boolean);
    return [ALL_CATEGORY_ID, ...tags];
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
        activeCategory === ALL_CATEGORY_ID ||
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
        label: t('dash.stats.myQuizzes'),
        value: packs.length,
        body: t('dash.stats.myQuizzesBody'),
        tone: 'bg-white',
      },
      {
        id: 'questions',
        label: t('dash.stats.questions'),
        value: totalQuestions,
        body: t('dash.stats.questionsBody'),
        tone: 'bg-brand-yellow',
      },
      {
        id: 'live',
        label: t('dash.stats.activeSessions'),
        value: packs.filter((pack) => Number(pack.active_session_count || 0) > 0).length,
        body: t('dash.stats.activeSessionsBody'),
        tone: 'bg-brand-orange text-white',
      },
      {
        id: 'history',
        label: t('dash.stats.readyToHost'),
        value: packs.filter((pack) => Number(pack.session_count || 0) > 0).length,
        body: t('dash.stats.readyToHostBody'),
        tone: 'bg-brand-purple text-white',
      },
    ];
  }, [packs, t]);


  const handleHost = async (packId: number, gameType = selectedGameMode, teamCount = selectedTeamCount) => {
    try {
      setBusyAction({ packId, action: 'host' });
      const mode = getGameMode(gameType);
      const res = await apiFetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quiz_pack_id: packId,
          game_type: gameType,
          team_count: mode.teamBased ? teamCount : 0,
          mode_config: {
            ...mode.defaultModeConfig,
            lobby_track_id: selectedLobbyTrackId,
            gameplay_track_id: selectedGameplayTrackId,
          },
        }),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, t));
      }
      const data = await res.json();
      setHostingPack(null);
      void trackTeacherSessionLaunch({
        gameType,
        teamCount: mode.teamBased ? teamCount : 0,
      });
      navigate(`/teacher/session/${data.pin}/host`, { state: { sessionId: data.id, packId } });
    } catch (hostError: any) {
      setNotice({ tone: 'error', message: hostError?.message || t('dash.error.startSession') });
    } finally {
      setBusyAction(null);
    }
  };

  const openHostModal = (pack: any) => {
    const defaultMode = getGameMode(recommendModesForPack(pack)[0]);
    setHostingPack(pack);
    setSelectedGameMode(defaultMode.id);
    setSelectedTeamCount(defaultMode.defaultTeamCount || 4);
    setSelectedLobbyTrackId(
      (defaultMode.defaultModeConfig.lobby_track_id as SessionSoundtrackChoice) || DEFAULT_SESSION_SOUNDTRACKS.lobby_track_id,
    );
    setSelectedGameplayTrackId(
      (defaultMode.defaultModeConfig.gameplay_track_id as SessionSoundtrackChoice) || DEFAULT_SESSION_SOUNDTRACKS.gameplay_track_id,
    );
  };

  const openLiveRoom = (pack: any) => {
    if (!pack?.latest_active_session_pin) return;
    navigate(`/teacher/session/${pack.latest_active_session_pin}/host`, {
      state: { sessionId: pack.latest_active_session_id, packId: pack.id },
    });
  };

  const handlePreview = async (pack: any) => {
    try {
      setBusyAction({ packId: Number(pack.id), action: 'preview' });
      const data = await loadPackPreview(Number(pack.id));
      setSelectedPack({ ...pack, ...data });
    } catch (previewError: any) {
      setNotice({ tone: 'error', message: previewError?.message || t('dash.error.openPreview') });
    } finally {
      setBusyAction(null);
    }
  };

  const syncPackState = (updatedPack: any) => {
    setPacks((current) =>
      current.map((pack) => (Number(pack.id) === Number(updatedPack.id) ? { ...pack, ...updatedPack } : pack)),
    );
    setSelectedPack((current: any) =>
      Number(current?.id) === Number(updatedPack.id) ? { ...current, ...updatedPack } : current,
    );
    setHostingPack((current: any) =>
      Number(current?.id) === Number(updatedPack.id) ? { ...current, ...updatedPack } : current,
    );
  };

  const handleVisibilityChange = async (pack: any, nextIsPublic: boolean) => {
    try {
      setBusyAction({ packId: Number(pack.id), action: 'visibility' });
      const response = await apiFetch(`/api/teacher/packs/${pack.id}/visibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: nextIsPublic }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, t));
      }
      const updatedPack = await response.json();
      syncPackState(updatedPack);
      setNotice({
        tone: 'success',
        message: nextIsPublic
          ? t('dash.notice.packPublic', { title: pack.title })
          : t('dash.notice.packPrivate', { title: pack.title }),
      });
    } catch (visibilityError: any) {
      setNotice({ tone: 'error', message: visibilityError?.message || t('dash.error.updateVisibility') });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSnapshotPack = async (pack: any) => {
    try {
      setBusyAction({ packId: Number(pack.id), action: 'snapshot' });
      const response = await apiFetch(`/api/teacher/packs/${pack.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version_label: t('dash.snapshot.label', { date: new Date().toLocaleDateString('en-GB') }) }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, t));
      }
      const refreshedPack = await loadPackPreview(Number(pack.id));
      setSelectedPack((current: any) => (Number(current?.id) === Number(pack.id) ? { ...current, ...refreshedPack } : current));
      await loadPacks();
      setNotice({ tone: 'success', message: t('dash.notice.snapshotSaved', { title: pack.title }) });
    } catch (snapshotError: any) {
      setNotice({ tone: 'error', message: snapshotError?.message || t('dash.error.saveSnapshot') });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRestoreVersion = async (pack: any, version: any) => {
    try {
      setBusyAction({ packId: Number(pack.id), action: `restore-${version.id}` });
      const response = await apiFetch(`/api/teacher/packs/${pack.id}/versions/${version.id}/restore`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, t));
      }
      const restoredPack = await response.json();
      await loadPacks();
      setNotice({
        tone: 'success',
        message: t('dash.notice.versionRestored', { title: restoredPack?.title || t('dash.pack.aRestoredCopy'), versionNumber: version.version_number }),
      });
    } catch (restoreError: any) {
      setNotice({ tone: 'error', message: restoreError?.message || t('dash.error.restoreVersion') });
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
        throw new Error(await readApiError(response, t));
      }
      const duplicatedPack = await response.json();
      await loadPacks();
      setNotice({
        tone: 'success',
        message: t('dash.notice.packDuplicated', { originalTitle: pack.title, newTitle: duplicatedPack?.title || t('dash.pack.aNewPack') }),
      });
    } catch (duplicateError: any) {
      setNotice({ tone: 'error', message: duplicateError?.message || t('dash.error.duplicatePack') });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateRematchFromSession = async (sessionId: number, packId: number, sourceTitle: string) => {
    try {
      setBusyAction({ packId, action: 'rematch' });
      const response = await apiFetch(`/api/teacher/sessions/${sessionId}/rematch-pack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: 'whole_class_reset' }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, t));
      }
      const payload = await response.json();
      setSelectedPack(null);
      await loadPacks();
      setNotice({
        tone: 'success',
        message: t('dash.notice.rematchReady', { title: payload?.title || t('dash.pack.rematchPack') }),
      });
      navigate(`/teacher/pack/${payload.pack_id}/edit`);
    } catch (rematchError: any) {
      setNotice({
        tone: 'error',
        message: rematchError?.message || t('dash.error.rematchFailed', { title: sourceTitle }),
      });
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
        throw new Error(await readApiError(response, t));
      }
      const payload = await response.json();
      setDeletingPack(null);
      setSelectedPack((current: any) => (Number(current?.id) === Number(payload.pack_id) ? null : current));
      setHostingPack((current: any) => (Number(current?.id) === Number(payload.pack_id) ? null : current));
      await loadPacks();
      setNotice({
        tone: 'success',
        message: t('dash.notice.packDeleted', {
          title: payload.title,
          sessionsImpact: payload?.impact?.sessions
            ? t('dash.notice.sessionsImpact', { count: payload.impact.sessions })
            : '',
        }),
      });
    } catch (deleteError: any) {
      setNotice({ tone: 'error', message: deleteError?.message || t('dash.error.deletePack') });
    } finally {
      setBusyAction(null);
    }
  };

  const selectedPackDiscoverVisible = isPackPublic(selectedPack);
  const selectedPackVisibilityBusy =
    !!selectedPack &&
    Number(busyAction?.packId) === Number(selectedPack.id) &&
    busyAction?.action === 'visibility';
  const hasBlockingLoadError = !loading && !hasLoadedPackBoard && packs.length === 0 && !!error;

  return (
    <div
      dir={direction}
      data-no-translate="true"
      className="teacher-layout-shell"
    >
      <TeacherSidebar />

      <div className="teacher-layout-main flex flex-col overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[380px] bg-[radial-gradient(circle_at_top_left,_rgba(255,90,54,0.14),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(180,136,255,0.16),_transparent_34%)] pointer-events-none" />

        <header className="page-shell-wide relative z-20 flex flex-wrap items-center justify-between gap-4 py-6 border-b-2 border-brand-dark/5">
          <div className={isRtl ? 'text-right' : 'text-left'}>
            <h1 className="text-4xl font-black tracking-tight">{t('dash.nav.myQuizzes')}</h1>
            <p className="font-bold text-brand-dark/60 mt-1">{t('settings.subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/teacher/pack/create')}
              className="px-6 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black shadow-[4px_4px_0px_0px_#1A1A1A] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              {t('dash.nav.createQuiz')}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto page-shell-wide relative z-10 pt-20 lg:pt-6 pb-20">
          <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6 mb-6">
            <div className="max-w-3xl">
              <h1 className="text-4xl lg:text-5xl font-black tracking-tight leading-tight">{t('dash.header.title')}</h1>
              <p className="font-bold text-brand-dark/62 mt-3 text-lg">
                {t('dash.header.subtitle')}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => void refreshDashboard()}
                className="px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A] hover:bg-brand-bg transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                {t('dash.action.refresh')}
              </button>
              <button
                onClick={() => navigate('/teacher/pack/create')}
                className="px-5 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[4px_4px_0px_0px_#1A1A1A] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all"
              >
                <Plus className="w-4 h-4" />
                {t('dash.action.create')}
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
                  <p className="font-black">{notice.tone === 'success' ? t('dash.notice.success') : t('dash.notice.attention')}</p>
                  <p className="font-medium text-brand-dark/75">{notice.message}</p>
                </div>
              </div>
            </div>
          )}

          {!hasBlockingLoadError && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
              {dashboardStats.map((stat) => (
                <div key={stat.id} className={`${stat.tone} rounded-[1.7rem] border-4 border-brand-dark p-5 shadow-[6px_6px_0px_0px_#1A1A1A]`}>
                  <p className="text-xs font-black uppercase tracking-[0.2em] opacity-70 mb-3">{stat.label}</p>
                  <p className="text-4xl font-black leading-none">{stat.value}</p>
                  <p className="font-medium text-sm opacity-80 mt-3">{stat.body}</p>
                </div>
              ))}
            </div>
          )}


          {!hasBlockingLoadError && (
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
                    placeholder={t('dash.filter.searchPlaceholder')}
                    aria-label="Search your quizzes"
                    className="w-full bg-brand-bg border-2 border-brand-dark rounded-full py-3.5 pl-12 pr-4 text-base font-black placeholder:text-brand-dark/40 focus:outline-none focus:ring-4 focus:ring-brand-orange/10"
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
                          {t(`dash.sort.${option.id}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    aria-label="Reset quiz filters"
                    onClick={() => {
                      setSearchQuery('');
                      setActiveCategory(ALL_CATEGORY_ID);
                      setSortBy('recent');
                    }}
                    className="px-5 py-3 bg-brand-bg border-2 border-brand-dark rounded-full flex items-center gap-2 hover:bg-brand-yellow transition-colors font-black"
                  >
                    {t('dash.filter.clear')}
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
                    className={`flex items-center gap-2 shrink-0 px-4 py-2 rounded-full whitespace-nowrap text-sm font-black border-2 border-brand-dark transition-all ${activeCategory === category ? 'bg-brand-purple text-white shadow-[2px_2px_0px_0px_#1A1A1A]' : 'bg-white text-brand-dark hover:bg-brand-yellow'}`}
                  >
                    {getCategoryIcon(category)}
                    <span>{category === ALL_CATEGORY_ID ? 'All' : category}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 text-sm font-black text-brand-dark/60">
                <span>{t('dash.filter.showing', { count: filteredPacks.length, total: packs.length })}</span>
                <span className="hidden md:inline">•</span>
                <span>{t('dash.filter.activeNow', { count: packs.filter((pack) => Number(pack.active_session_count || 0) > 0).length })}</span>
              </div>
            </div>
            </div>
          )}

          {error && !loading && (
            <div className="bg-white border-2 border-brand-dark rounded-[2rem] p-8 mb-6 shadow-[4px_4px_0px_0px_#1A1A1A]">
              <p className="text-2xl font-black mb-2">{t('dash.error.boardLoadFailed')}</p>
              <p className="font-bold text-brand-dark/60 mb-4">{error}</p>
              <button
                onClick={() => void refreshDashboard()}
                className="px-5 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black"
              >
                {t('dash.action.tryAgain')}
              </button>
            </div>
          )}

          {!hasBlockingLoadError && (
            loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={`skeleton-${index}`} className="rounded-[2rem] border-4 border-brand-dark bg-white p-6 shadow-[6px_6px_0px_0px_#1A1A1A] min-h-[320px] animate-pulse">
                    <div className="h-6 w-24 rounded-full bg-brand-bg mb-4" />
                    <div className="h-12 rounded-2xl bg-brand-bg mb-5" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
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
                  <h3 className="text-2xl font-black uppercase tracking-tight">{t('dash.action.createNewPack')}</h3>
                  <p className="font-bold text-brand-dark/60 mt-3 max-w-xs">
                    {t('auth.heroBody')}
                  </p>
                </motion.button>

                {filteredPacks.map((pack, index) => {
                  const state = getPackState(t, pack);
                  const isBusy = Number(busyAction?.packId) === Number(pack.id);
                  const discoverVisible = isPackPublic(pack);
                  const isLive = Number(pack.active_session_count || 0) > 0;

                  return (
                    <motion.div
                      key={pack.id}
                      initial={{ opacity: 0, y: 24 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className="premium-card magic-glow group flex flex-col min-h-[420px] overflow-hidden bg-white"
                    >
                    {/* Card Header with Visual Accent */}
                    <div className="relative h-32 w-full overflow-hidden bg-brand-bg border-b-2 border-brand-dark">
                      <div className="absolute inset-0 opacity-20 pointer-events-none" 
                        style={{ 
                          backgroundImage: `radial-gradient(var(--brand-dark) 1px, transparent 1px)`, 
                          backgroundSize: '16px 16px' 
                        }} 
                      />
                      <div className="absolute top-4 left-4 z-10">
                        <span className={`${state.tone} rounded-full border-2 border-brand-dark px-3 py-1.5 text-[10px] font-black uppercase tracking-widest flex items-center gap-2`}>
                          {isLive ? <Sparkles className="w-3.5 h-3.5 animate-pulse" /> : <CalendarDays className="w-3.5 h-3.5" />}
                          {state.label}
                        </span>
                      </div>
                      
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-16 h-16 rounded-2xl bg-white border-4 border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A] flex items-center justify-center transform group-hover:rotate-6 transition-transform">
                          <Library className="w-8 h-8 text-brand-purple" />
                        </div>
                      </div>

                      <div className="absolute top-4 right-4">
                        <span className={`px-3 py-1 rounded-full border-2 border-brand-dark text-[10px] font-black uppercase tracking-widest ${discoverVisible ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-brand-dark/40'}`}>
                          {discoverVisible ? t('dash.pack.public') : t('dash.pack.private')}
                        </span>
                      </div>
                    </div>

                    <div className="p-6 flex flex-col flex-1">
                      <div className="mb-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-purple mb-1">
                          {t('dash.pack.created', { time: formatRelativeTime(t, pack.created_at) })}
                        </p>
                        <h3 data-no-translate="true" className="text-2xl font-black leading-tight line-clamp-1 group-hover:text-brand-orange transition-colors">
                          {pack.title}
                        </h3>
                        {(pack.course_code || pack.academic_term) && (
                          <p data-no-translate="true" className="font-bold text-xs text-brand-dark/50 mt-1 uppercase tracking-wider">
                            {[pack.course_code, pack.section_name, pack.academic_term].filter(Boolean).join(' • ')}
                          </p>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 mb-4">
                        <div className="bg-brand-bg rounded-xl border-2 border-brand-dark p-3 flex items-center gap-3">
                          <BookOpen className="w-5 h-5 text-brand-orange" />
                          <div>
                            <p className="text-[10px] font-black opacity-40 leading-none mb-1">שאלות</p>
                            <p className="font-black leading-none">{pack.question_count || 0}</p>
                          </div>
                        </div>
                        <div className="bg-brand-bg rounded-xl border-2 border-brand-dark p-3 flex items-center gap-3">
                          <Users className="w-5 h-5 text-brand-purple" />
                          <div>
                            <p className="text-[10px] font-black opacity-40 leading-none mb-1">הרצות</p>
                            <p className="font-black leading-none">{pack.session_count || 0}</p>
                          </div>
                        </div>
                      </div>

                      <div className="relative mb-4">
                        <p data-no-translate="true" className="text-sm font-medium text-brand-dark/70 line-clamp-2 leading-relaxed h-10">
                          {pack.teaching_brief || pack.source_excerpt || pack.source_text || 'אין תקציר זמין לחבילה זו.'}
                        </p>
                        <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-white to-transparent" />
                      </div>

                      <div className="bg-brand-bg/50 rounded-2xl border-2 border-brand-dark p-4 mb-6">
                        <p className="font-black text-sm leading-tight text-brand-dark">
                          {state.body}
                        </p>
                        <p className="text-[10px] font-bold text-brand-dark/40 mt-1.5 uppercase tracking-wide">
                          {Number(pack.session_count || 0) > 0
                            ? t('dash.pack.prevSessions', { count: pack.session_count })
                            : t('dash.pack.noSessions')}
                        </p>
                      </div>

                      {/* Action Grid */}
                      <div className="grid grid-cols-2 gap-3 mt-auto">
                        <button
                          onClick={() => (isLive ? openLiveRoom(pack) : openHostModal(pack))}
                          disabled={isBusy}
                          className="col-span-2 bg-brand-orange text-white py-4 rounded-[1.2rem] font-black shadow-[4px_4px_0px_0px_#1A1A1A] border-2 border-brand-dark transition-all flex items-center justify-center gap-3 hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none active:scale-[0.98] disabled:opacity-60"
                        >
                          {isLive ? <ArrowUpRight className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
                          <span className="text-lg">{isLive ? t('dash.action.openLive') : t('dash.action.host')}</span>
                        </button>
                        
                        <button
                          onClick={() => void handlePreview(pack)}
                          disabled={isBusy}
                          className="bg-white border-2 border-brand-dark rounded-xl py-2.5 font-black text-sm shadow-[2px_2px_0px_0px_#1A1A1A] hover:bg-brand-bg hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                          <Search className="w-4 h-4" />
                          {t('dash.action.preview')}
                        </button>

                        <button
                          onClick={() => openPackEditor(Number(pack.id))}
                          disabled={isBusy}
                          className="bg-white border-2 border-brand-dark rounded-xl py-2.5 font-black text-sm shadow-[2px_2px_0px_0px_#1A1A1A] hover:bg-brand-yellow hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                          <SquarePen className="w-4 h-4" />
                          {t('dash.action.edit')}
                        </button>

                        <button
                          onClick={() => void handleDuplicate(pack)}
                          disabled={isBusy}
                          title={t('dash.action.duplicate')}
                          className="bg-white border-2 border-brand-dark rounded-xl py-2.5 font-black text-sm shadow-[2px_2px_0px_0px_#1A1A1A] hover:bg-brand-yellow hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all flex items-center justify-center disabled:opacity-60"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeletingPack(pack)}
                          disabled={isBusy}
                          title={t('dash.action.delete')}
                          className="bg-white border-2 border-brand-dark rounded-xl py-2.5 font-black text-sm shadow-[2px_2px_0px_0px_#1A1A1A] hover:bg-rose-500 hover:text-white hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all flex items-center justify-center disabled:opacity-60"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    </motion.div>
                  );
                })}
              </div>
            )
          )}

          {!loading && !hasBlockingLoadError && filteredPacks.length === 0 && (
            <div className="bg-white border-2 border-brand-dark rounded-[2rem] p-10 mt-6 shadow-[4px_4px_0px_0px_#1A1A1A] text-center">
              <p className="text-2xl font-black mb-2">{t('dash.empty.title')}</p>
              <p className="font-bold text-brand-dark/60 mb-4">{t('dash.empty.subtitle')}</p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setActiveCategory(ALL_CATEGORY_ID);
                  setSortBy('recent');
                }}
                className="px-5 py-3 bg-brand-yellow border-2 border-brand-dark rounded-full font-black shadow-[2px_2px_0px_0px_#1A1A1A] hover:bg-brand-yellow/80"
              >
                {t('dash.empty.clear')}
              </button>
            </div>
          )}
        </main>
      </div>

      {selectedPack && (
        <div className="fixed inset-0 bg-black/25 z-40 flex justify-end">
          <div className="w-full max-w-xl h-full bg-white border-l-4 border-brand-dark p-6 overflow-y-auto shadow-[-8px_0_0_0_#1A1A1A]">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('dash.preview.title')}</p>
                <h2 data-no-translate="true" className="text-3xl font-black break-words">{selectedPack.title}</h2>
                <p className="font-bold text-brand-dark/60 mt-2">
                  {t('dash.preview.stats', { 
                    questions: selectedPack.question_count || selectedPack.questions?.length || 0,
                    sessions: selectedPack.session_count || 0,
                    s: Number(selectedPack.session_count || 0) === 1 ? '' : 's'
                  })}
                </p>
                {(selectedPack.course_code || selectedPack.section_name || selectedPack.academic_term) && (
                  <p data-no-translate="true" className="font-bold text-brand-dark/50 mt-2">
                    {[selectedPack.course_code, selectedPack.section_name, selectedPack.academic_term].filter(Boolean).join(' • ')}
                  </p>
                )}
              </div>
              <button onClick={() => setSelectedPack(null)} className="w-10 h-10 rounded-full border-2 border-brand-dark flex items-center justify-center shrink-0">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <PackMetric label={t('dash.preview.lastRun')} value={formatRelativeTime(t, selectedPack.last_session_at)} />
              <PackMetric label={t('dash.preview.students')} value={selectedPack.last_session_players || 0} />
              <PackMetric label={t('dash.preview.language')} value={selectedPack.source_language || t('dash.preview.notSet')} />
              <PackMetric label={t('dash.preview.versions')} value={selectedPack.version_count || selectedPack.versions?.length || 0} />
            </div>

            <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5 mb-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('dash.preview.privacy')}</p>
                  <p className="font-black">{selectedPackDiscoverVisible ? t('dash.preview.discoverable') : t('dash.preview.private')}</p>
                  <p className="font-medium text-brand-dark/62 mt-2">
                    {t('dash.preview.visibilityNotice')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleVisibilityChange(selectedPack, !selectedPackDiscoverVisible)}
                  disabled={selectedPackVisibilityBusy}
                  className={`shrink-0 min-w-[148px] px-4 py-3 rounded-2xl border-2 border-brand-dark font-black shadow-[2px_2px_0px_0px_#1A1A1A] disabled:opacity-60 ${selectedPackDiscoverVisible ? 'bg-emerald-100 text-brand-dark' : 'bg-white text-brand-dark'}`}
                >
                  {selectedPackVisibilityBusy ? t('dash.preview.saveBusy') : selectedPackDiscoverVisible ? t('dash.preview.hideFromSearch') : t('dash.preview.shareInSearch')}
                </button>
              </div>
            </div>

            <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-5 mb-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-3">{t('dash.preview.academicDetails')}</p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <PackMetric label={t('dash.preview.course')} value={selectedPack.course_code || t('dash.preview.notSet')} />
                <PackMetric label={t('dash.preview.week')} value={selectedPack.week_label || t('dash.preview.notSet')} />
                <PackMetric label={t('dash.preview.section')} value={selectedPack.section_name || t('dash.preview.notSet')} />
                <PackMetric label={t('dash.preview.term')} value={selectedPack.academic_term || t('dash.preview.notSet')} />
              </div>
              {(selectedPack.learning_objectives || []).length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t('dash.preview.learningObjectives')}</p>
                  <div className="flex flex-wrap gap-2">
                    {(selectedPack.learning_objectives || []).map((objective: string) => (
                      <span key={objective} className="px-3 py-2 rounded-full bg-emerald-100 border-2 border-brand-dark text-xs font-black">
                        <span data-no-translate="true">{objective}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(selectedPack.bloom_levels || []).length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t('dash.preview.bloomLevels')}</p>
                  <div className="flex flex-wrap gap-2">
                    {(selectedPack.bloom_levels || []).map((level: string) => (
                      <span key={level} className="px-3 py-2 rounded-full bg-brand-yellow border-2 border-brand-dark text-xs font-black">
                        <span data-no-translate="true">{level}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {selectedPack.pack_notes && (
                <div className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t('dash.preview.teacherNotes')}</p>
                  <p data-no-translate="true" className="font-medium text-brand-dark/72 whitespace-pre-line">{selectedPack.pack_notes}</p>
                </div>
              )}
            </div>

            <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5 mb-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t('dash.preview.teachingBrief')}</p>
              <p data-no-translate="true" className="font-medium text-brand-dark/72 leading-relaxed">
                {selectedPack.teaching_brief || selectedPack.source_excerpt || selectedPack.source_text || t('dash.preview.noBrief')}
              </p>
            </div>

            <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5 mb-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('dash.preview.versionHistory')}</p>
                  <p className="font-bold text-brand-dark/65">{t('dash.preview.versionNotice')}</p>
                </div>
                <button
                  onClick={() => void handleSnapshotPack(selectedPack)}
                  disabled={Number(busyAction?.packId) === Number(selectedPack.id) && busyAction?.action === 'snapshot'}
                  className="px-4 py-3 rounded-full bg-brand-yellow border-2 border-brand-dark font-black text-sm shadow-[2px_2px_0px_0px_#1A1A1A] disabled:opacity-60"
                >
                  {t('dash.preview.saveSnapshot')}
                </button>
              </div>
              <div className="space-y-3">
                {(selectedPack.versions || []).length > 0 ? (
                  (selectedPack.versions || []).map((version: any) => (
                    <div key={version.id} className="rounded-[1.2rem] border-2 border-brand-dark bg-white p-4">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div>
                          <p className="font-black">V{version.version_number} • {version.version_label}</p>
                          <p className="text-xs font-bold text-brand-dark/55">{version.source_label || 'snapshot'} • {formatRelativeTime(version.created_at)}</p>
                        </div>
                        <button
                          onClick={() => void handleRestoreVersion(selectedPack, version)}
                          disabled={Number(busyAction?.packId) === Number(selectedPack.id) && busyAction?.action === `restore-${version.id}`}
                          className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark font-black text-xs shadow-[2px_2px_0px_0px_#1A1A1A] disabled:opacity-60"
                        >
                          {t('dash.preview.restoreCopy')}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[1.2rem] border-2 border-brand-dark bg-white p-4">
                    <p className="font-black">{t('dash.preview.noSnapshots')}</p>
                    <p className="font-medium text-brand-dark/60 text-sm mt-1">{t('dash.preview.noSnapshotsBody')}</p>
                  </div>
                )}
              </div>
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
                    <p data-no-translate="true" className="font-black mb-3">Q{index + 1}. {question.prompt}</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {tags.map((tag: string) => (
                        <span key={`${question.id}-${tag}`} className="px-3 py-1 rounded-full bg-brand-bg border-2 border-brand-dark text-[11px] font-black uppercase tracking-[0.14em]">
                          <span data-no-translate="true">{tag}</span>
                        </span>
                      ))}
                      {question.learning_objective && (
                        <span className="px-3 py-1 rounded-full bg-emerald-100 border-2 border-brand-dark text-[11px] font-black">
                          <span data-no-translate="true">{question.learning_objective}</span>
                        </span>
                      )}
                      {question.bloom_level && (
                        <span className="px-3 py-1 rounded-full bg-brand-yellow border-2 border-brand-dark text-[11px] font-black">
                          <span data-no-translate="true">{question.bloom_level}</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-dark/40">
                      {t('dash.preview.secondsPerQ', { seconds: question.time_limit_seconds || 20 })}
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
                {Number(selectedPack.active_session_count || 0) > 0 ? t('dash.preview.openLiveRoom') : t('dash.preview.hostThisPack')}
              </button>
              <button
                onClick={() => {
                  const nextPackId = Number(selectedPack.id);
                  setSelectedPack(null);
                  openPackEditor(nextPackId);
                }}
                className="bg-white border-2 border-brand-dark rounded-2xl py-4 font-black flex items-center justify-center gap-2"
              >
                <SquarePen className="w-4 h-4" />
                {t('dash.action.edit')}
              </button>
              <button
                onClick={() => void handleDuplicate(selectedPack)}
                className="bg-white border-2 border-brand-dark rounded-2xl py-4 font-black"
              >
                Duplicate
              </button>
              {Number(selectedPack.last_completed_session_id || 0) > 0 && (
                <button
                  onClick={() =>
                    void handleCreateRematchFromSession(
                      Number(selectedPack.last_completed_session_id),
                      Number(selectedPack.id),
                      String(selectedPack.title || 'this pack'),
                    )
                  }
                  disabled={Number(busyAction?.packId) === Number(selectedPack.id) && busyAction?.action === 'rematch'}
                  className="col-span-2 bg-brand-yellow border-2 border-brand-dark rounded-2xl py-4 font-black disabled:opacity-60"
                >
                  {Number(busyAction?.packId) === Number(selectedPack.id) && busyAction?.action === 'rematch'
                    ? 'Building Rematch...'
                    : 'Build Rematch Pack From Last Completed Run'}
                </button>
              )}
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
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t('dash.delete.title')}</p>
                <h2 data-no-translate="true" className="text-3xl font-black">{deletingPack.title}</h2>
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
                  ? t('dash.delete.activeRoomWarn')
                  : t('dash.delete.permanentWarn')}
              </p>
              <p className="font-medium text-brand-dark/72">
                {Number(deletingPack.can_delete) === 0
                  ? t('dash.delete.endSessionFirst')
                  : Number(deletingPack.session_count || 0) > 0
                    ? t('dash.delete.fullDeleteNotice')
                    : t('dash.delete.simpleDeleteNotice')}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <PackMetric label={t('dash.stats.questions')} value={deletingPack.question_count || 0} />
              <PackMetric label={t('dash.stats.sessions')} value={deletingPack.session_count || 0} />
              <PackMetric label={t('dash.preview.students')} value={deletingPack.last_session_players || 0} />
              <PackMetric label={t('dash.preview.lastRun')} value={formatRelativeTime(t, deletingPack.last_session_at)} />
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
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            className="w-full max-w-6xl bg-white rounded-[2.5rem] border-4 border-brand-dark shadow-[16px_16px_0px_0px_#1A1A1A] overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Modal Header */}
            <div className="p-6 lg:p-8 border-b-4 border-brand-dark bg-brand-bg flex items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="px-3 py-1 rounded-full bg-brand-purple text-white text-[10px] font-black uppercase tracking-widest border-2 border-brand-dark">
                    {t('dash.host.title')}
                  </div>
                  <div className="h-1 w-8 bg-brand-dark/20 rounded-full" />
                  <span className="text-xs font-bold text-brand-dark/40 uppercase tracking-widest">{t('dash.host.setup')}</span>
                </div>
                <h2 data-no-translate="true" className="text-4xl font-black text-brand-dark leading-tight">{hostingPack.title}</h2>
              </div>
              <button
                onClick={() => setHostingPack(null)}
                className="w-14 h-14 rounded-full border-4 border-brand-dark flex items-center justify-center bg-white hover:bg-brand-orange hover:text-white transition-all shadow-[4px_4px_0px_0px_#1A1A1A] active:shadow-none active:translate-x-1 active:translate-y-1"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 lg:p-8 bg-white">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">
                {/* Format Selection Grid */}
                <div className="space-y-8">
                  <div>
                    <h3 className="text-xl font-black mb-4 flex items-center gap-3">
                      <Sparkles className="w-6 h-6 text-brand-orange" />
                      {t('dash.host.chooseFormat')}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {GAME_MODES.map((mode) => {
                        const isActive = selectedGameMode === mode.id;
                        return (
                          <motion.button
                            key={mode.id}
                            whileHover={{ y: -4, scale: 1.01 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => {
                              setSelectedGameMode(mode.id);
                              setSelectedTeamCount(mode.defaultTeamCount || 4);
                            }}
                            className={`relative text-left rounded-[2rem] border-4 p-6 transition-all overflow-hidden ${
                              isActive
                                ? 'border-brand-dark bg-white ring-4 ring-offset-4 ring-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A]'
                                : 'border-brand-dark/10 bg-brand-bg/30 hover:bg-white hover:border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]/10'
                            }`}
                          >
                            {/* Visual Vibe Background */}
                            <div className="absolute top-0 right-0 w-32 h-32 opacity-10 pointer-events-none">
                              {mode.visualVibe === 'dots-grid' && (
                                <div className="w-full h-full" style={{ backgroundImage: `radial-gradient(${mode.hexColor} 2px, transparent 2px)`, backgroundSize: '12px 12px' }} />
                              )}
                              {mode.visualVibe === 'speed-lines' && (
                                <div className="w-full h-full rotate-45" style={{ background: `repeating-linear-gradient(90deg, ${mode.hexColor}, ${mode.hexColor} 2px, transparent 2px, transparent 10px)` }} />
                              )}
                              {mode.visualVibe === 'stepped-gradient' && (
                                <div className="w-full h-full" style={{ background: `linear-gradient(135deg, ${mode.hexColor}44 25%, transparent 25%, transparent 50%, ${mode.hexColor}44 50%, ${mode.hexColor}44 75%, transparent 75%, transparent)` }} />
                              )}
                              {mode.visualVibe === 'concentric-circles' && (
                                <div className="w-full h-full border-8 border-dashed rounded-full" style={{ borderColor: mode.hexColor }} />
                              )}
                              {mode.visualVibe === 'diagonal-stripes' && (
                                <div className="w-full h-full" style={{ background: `repeating-linear-gradient(45deg, transparent, transparent 10px, ${mode.hexColor}22 10px, ${mode.hexColor}22 20px)` }} />
                              )}
                              {mode.visualVibe === 'ortho-grid' && (
                                <div className="w-full h-full" style={{ backgroundImage: `linear-gradient(${mode.hexColor}11 1px, transparent 1px), linear-gradient(90deg, ${mode.hexColor}11 1px, transparent 1px)`, backgroundSize: '15px 15px' }} />
                              )}
                            </div>

                            <div className="relative z-10">
                              <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 rounded-xl border-2 border-brand-dark flex items-center justify-center shadow-[3px_3px_0px_0px_#1A1A1A]" style={{ backgroundColor: mode.hexColor }}>
                                  <Rocket className="w-5 h-5 text-white" />
                                </div>
                                <span className={`px-3 py-1 rounded-full border-2 border-brand-dark text-[10px] font-black uppercase tracking-widest ${mode.teamBased ? 'bg-brand-dark text-white' : 'bg-white text-brand-dark'}`}>
                                  {mode.teamBased ? t('dash.host.teamPlay') : t('dash.host.soloPlay')}
                                </span>
                              </div>
                              <h4 className="text-2xl font-black mb-1">{t(mode.label)}</h4>
                              <p className="text-sm font-bold text-brand-dark/60 leading-tight mb-4">{t(mode.quickSummary)}</p>
                              
                              <div className="flex flex-wrap gap-2">
                                {mode.objectives.slice(0, 2).map((obj) => (
                                  <span key={obj} className="text-[10px] font-bold text-brand-dark/40 border border-brand-dark/10 px-2 py-0.5 rounded-md">
                                    {t(obj)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Settings section */}
                  <AnimatePresence mode="wait">
                    {getGameMode(selectedGameMode).teamBased && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="rounded-[2rem] border-4 border-brand-dark bg-brand-bg p-8"
                      >
                        <h4 className="text-lg font-black mb-4 flex items-center gap-3">
                          <Users className="w-6 h-6 text-brand-purple" />
                          {t('dash.host.teamCount')}
                        </h4>
                        <div className="flex flex-wrap gap-4">
                          {[2, 3, 4, 5, 6, 8, 10].map((count) => (
                            <button
                              key={count}
                              onClick={() => setSelectedTeamCount(count)}
                              className={`w-14 h-14 rounded-2xl border-4 font-black text-xl transition-all shadow-[4px_4px_0px_0px_#1A1A1A] ${
                                selectedTeamCount === count
                                  ? 'bg-brand-purple text-white border-brand-dark translate-x-1 translate-y-1 shadow-none'
                                  : 'bg-white text-brand-dark border-brand-dark'
                              }`}
                            >
                              {count}
                            </button>
                          ))}
                        </div>
                        <p className="mt-4 text-sm font-bold text-brand-dark/50">{t('dash.host.teamNotice')}</p>
                      </motion.div>
                    ) || (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-[2rem] border-4 border-dashed border-brand-dark/20 bg-brand-bg/20 p-8 flex items-center justify-center text-center"
                      >
                        <p className="font-bold text-brand-dark/40">{t('dash.host.soloNotice')}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <SessionSoundtrackFields
                    lobbyTrackId={selectedLobbyTrackId}
                    gameplayTrackId={selectedGameplayTrackId}
                    onLobbyTrackChange={setSelectedLobbyTrackId}
                    onGameplayTrackChange={setSelectedGameplayTrackId}
                  />
                </div>

                {/* Sidebar Preview */}
                <div className="flex flex-col">
                  <div 
                    className="flex-1 rounded-[2.5rem] border-4 border-brand-dark p-8 text-white relative overflow-hidden shadow-[8px_8px_0px_0px_#1A1A1A]"
                    style={{ backgroundColor: getGameMode(selectedGameMode).hexColor }}
                  >
                    {/* Glowing effect */}
                    <div className="absolute -top-20 -right-20 w-64 h-64 bg-white/20 blur-[80px] rounded-full" />
                    <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-black/20 blur-[80px] rounded-full" />
                    
                    <div className="relative z-10 flex flex-col h-full">
                      <div className="flex items-center gap-3 mb-6">
                        <span className="w-12 h-1 w-1 bg-white/30 rounded-full" />
                        <span className="text-xs font-black uppercase tracking-widest text-white/60">{t('dash.host.selectedDossier')}</span>
                      </div>

                      <h3 className="text-4xl font-black mb-4">{t(getGameMode(selectedGameMode).label)}</h3>
                      <p className="text-lg font-bold text-white/80 leading-snug mb-8">{t(getGameMode(selectedGameMode).description)}</p>

                      <div className="space-y-6">
                        <div className="bg-white/10 rounded-2xl p-4 border border-white/10">
                          <p className="text-[10px] font-black uppercase tracking-widest text-white/50 mb-2">{t('dash.host.researchFoundation')}</p>
                          <p className="font-bold text-white leading-tight">{t(getGameMode(selectedGameMode).researchCue)}</p>
                        </div>

                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-white/50 mb-3">{t('dash.host.bestAppliedTo')}</p>
                          <div className="flex flex-wrap gap-2">
                            {getGameMode(selectedGameMode).bestFor.map(tag => (
                              <span key={tag} className="text-[11px] font-black bg-white text-brand-dark px-3 py-1 rounded-full">
                                {t(tag)}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="mt-auto pt-8">
                        <button
                          onClick={() => void handleHost(hostingPack.id, selectedGameMode, selectedTeamCount)}
                          disabled={busyAction?.action === 'host'}
                          className="w-full bg-white text-brand-dark border-4 border-brand-dark py-5 rounded-[1.5rem] font-black text-2xl shadow-[6px_6px_0px_0px_#1A1A1A] hover:translate-y-1 hover:translate-x-1 hover:shadow-none transition-all flex items-center justify-center gap-4 disabled:opacity-50"
                        >
                          <Play className="w-8 h-8 fill-brand-dark" />
                          {t('dash.host.launch')}
                        </button>
                        <p className="text-center mt-4 text-xs font-bold text-white/40">{t('dash.host.autoDirected')}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
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
    <div className="rounded-[1.1rem] border-2 border-brand-dark bg-white p-3 shadow-[2px_2px_0px_0px_#1A1A1A]">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-purple mb-1 truncate">{label}</p>
      <p className="font-black text-sm sm:text-base break-words">{value}</p>
    </div>
  );
}
