import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Filter, Compass, ChevronLeft, HelpCircle, LogOut, Play, Library, BarChart, Users, Settings, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { loadTeacherSettings } from '../lib/localData.ts';
import { trackTeacherSessionLaunch } from '../lib/appAnalytics.ts';
import { signOutTeacher } from '../lib/teacherAuth.ts';
import { GAME_MODES, getGameMode } from '../lib/gameModes.ts';

export default function TeacherDashboard() {
  const [packs, setPacks] = useState<any[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [selectedPack, setSelectedPack] = useState<any>(null);
  const [hostingPack, setHostingPack] = useState<any>(null);
  const [selectedGameMode, setSelectedGameMode] = useState<string>('classic_quiz');
  const [selectedTeamCount, setSelectedTeamCount] = useState<number>(4);
  const navigate = useNavigate();
  const teacherProfile = loadTeacherSettings().profile;
  const handleLogout = async () => {
    await signOutTeacher();
    navigate('/');
  };

  useEffect(() => {
    fetch('/api/packs')
      .then((res) => res.json())
      .then((data) => setPacks(data));
  }, []);

  const categories = useMemo(() => {
    const tags = Array.from(new Set(packs.flatMap((pack) => pack.top_tags || []))).filter(Boolean);
    return ['All', ...tags];
  }, [packs]);

  const filteredPacks = useMemo(() => {
    return packs.filter((pack) => {
      const matchesSearch =
        !searchQuery ||
        pack.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (pack.source_text || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (pack.top_tags || []).some((tag: string) => tag.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCategory = activeCategory === 'All' || (pack.top_tags || []).includes(activeCategory);
      return matchesSearch && matchesCategory;
    });
  }, [packs, searchQuery, activeCategory]);

  const handleHost = async (packId: number, gameType = selectedGameMode, teamCount = selectedTeamCount) => {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quiz_pack_id: packId,
        game_type: gameType,
        team_count: getGameMode(gameType).teamBased ? teamCount : 0,
      }),
    });
    const data = await res.json();
    setHostingPack(null);
    void trackTeacherSessionLaunch({
      gameType,
      teamCount: getGameMode(gameType).teamBased ? teamCount : 0,
    });
    navigate(`/teacher/session/${data.pin}/host`, { state: { sessionId: data.id, packId } });
  };

  const openHostModal = (pack: any) => {
    const defaultMode = GAME_MODES[0];
    setHostingPack(pack);
    setSelectedGameMode(defaultMode.id);
    setSelectedTeamCount(defaultMode.defaultTeamCount || 4);
  };

  const handlePreview = async (packId: number) => {
    const res = await fetch(`/api/packs/${packId}`);
    const data = await res.json();
    setSelectedPack(data);
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
        <div className="absolute top-[-10%] right-[-5%] w-64 h-64 border-[3px] border-brand-dark/5 rounded-full pointer-events-none"></div>
        <div className="absolute bottom-[-10%] left-[-5%] w-48 h-48 border-[3px] border-brand-dark/5 rounded-full pointer-events-none"></div>

        <div className="max-w-[1200px] mx-auto relative z-10">
          <h1 className="text-3xl lg:text-4xl font-black mb-6 tracking-tight">Welcome back, {teacherProfile.firstName}!</h1>

          <div className="flex flex-col md:flex-row gap-3 mb-6">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-dark/40" />
              <input
                id="search-quizzes"
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search your quizzes, subjects, or topics..."
                aria-label="Search your quizzes"
                className="w-full bg-white border-2 border-brand-dark rounded-full py-3 pl-12 pr-4 text-base font-bold placeholder:text-brand-dark/40 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 shadow-[2px_2px_0px_0px_#1A1A1A]"
              />
            </div>
            <button
              aria-label="Reset quiz filters"
              onClick={() => {
                setSearchQuery('');
                setActiveCategory('All');
              }}
              className="px-6 py-3 bg-white border-2 border-brand-dark rounded-full flex items-center gap-2 hover:bg-brand-yellow transition-colors font-black text-base shadow-[2px_2px_0px_0px_#1A1A1A]"
            >
              <Filter className="w-5 h-5" />
              Reset
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto hide-scrollbar mb-8 pb-2">
            {categories.map((cat) => (
              <button
                key={cat}
                aria-pressed={activeCategory === cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-5 py-2 rounded-full whitespace-nowrap text-sm font-black border-2 border-brand-dark transition-all shadow-[2px_2px_0px_0px_#1A1A1A] ${activeCategory === cat ? 'bg-brand-purple text-white' : 'bg-white text-brand-dark hover:bg-brand-yellow'}`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
            <motion.div whileHover={{ scale: 1.02, rotate: 1 }} whileTap={{ scale: 0.98 }} onClick={() => navigate('/teacher/pack/create')} className="premium-card min-h-[340px] border-dashed border-brand-dark/20 bg-brand-yellow/5 flex flex-col items-center justify-center gap-8 cursor-pointer group">
              <div className="w-24 h-24 bg-brand-yellow border-4 border-brand-dark rounded-[2rem] flex items-center justify-center shadow-[6px_6px_0px_0px_#1A1A1A] group-hover:rotate-12 transition-transform duration-500">
                <Plus className="w-12 h-12 text-brand-dark" />
              </div>
              <div className="text-center">
                <h3 className="text-2xl font-black text-brand-dark uppercase tracking-tight">Forge New Pack</h3>
                <p className="text-xs font-bold text-brand-dark/30 tracking-widest mt-2">MANUAL OR AI-POWERED</p>
              </div>
            </motion.div>

            {filteredPacks.map((pack, i) => (
              <motion.div key={pack.id} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="premium-card group overflow-hidden bg-white min-h-[340px] flex flex-col">
                <div className="h-40 bg-brand-bg border-b-4 border-brand-dark relative overflow-hidden">
                  <div className={`absolute inset-0 opacity-10 bg-gradient-to-br ${i % 3 === 0 ? 'from-brand-orange' : i % 3 === 1 ? 'from-brand-purple' : 'from-brand-yellow'} to-transparent`} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Library className="w-20 h-20 text-brand-dark/5 group-hover:scale-110 transition-transform duration-700" />
                  </div>
                  <div className="absolute top-6 left-6">
                    <span className="bg-white border-2 border-brand-dark px-4 py-1 rounded-2xl text-[10px] font-black shadow-[4px_4px_0px_0px_#1A1A1A] uppercase tracking-wider">
                      {pack.question_count || 0} Questions
                    </span>
                  </div>
                </div>

                <div className="p-8 flex flex-col flex-1">
                  <h3 className="text-2xl font-black text-brand-dark mb-2 group-hover:text-brand-orange transition-colors line-clamp-1">{pack.title}</h3>
                  <div className="flex gap-2 mb-4 flex-wrap">
                    {(pack.top_tags?.length ? pack.top_tags : ['general']).map((tag: string) => (
                      <span key={tag} className="px-3 py-1 bg-brand-purple/10 text-brand-purple text-[10px] font-black rounded-lg border-2 border-brand-purple/20 uppercase">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <p className="text-sm font-bold text-brand-dark/60 line-clamp-3">{pack.source_text}</p>

                  <div className="mt-auto flex items-center gap-3 pt-6">
                    <button onClick={() => openHostModal(pack)} className="flex-1 bg-brand-orange text-white py-4 rounded-2xl font-black shadow-[4px_4px_0px_0px_#1A1A1A] border-2 border-brand-dark transition-all flex items-center justify-center gap-3">
                      <Play className="w-5 h-5 fill-current" />
                      Host Session
                    </button>
                    <button onClick={() => handlePreview(pack.id)} className="p-4 bg-white border-2 border-brand-dark rounded-2xl hover:bg-brand-bg transition-colors shadow-[4px_4px_0px_0px_#1A1A1A]">
                      <Settings className="w-6 h-6 text-brand-dark" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {filteredPacks.length === 0 && (
            <div className="bg-white border-2 border-brand-dark rounded-[2rem] p-10 mt-8 shadow-[4px_4px_0px_0px_#1A1A1A] text-center">
              <p className="text-2xl font-black mb-2">No packs matched this search.</p>
              <p className="font-bold text-brand-dark/60">Try another term or create a new pack.</p>
            </div>
          )}
        </div>
      </main>

      {selectedPack && (
        <div className="fixed inset-0 bg-black/25 z-40 flex justify-end">
          <div className="w-full max-w-xl h-full bg-white border-l-4 border-brand-dark p-6 overflow-y-auto shadow-[-8px_0_0_0_#1A1A1A]">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Pack Preview</p>
                <h2 className="text-3xl font-black">{selectedPack.title}</h2>
              </div>
              <button onClick={() => setSelectedPack(null)} className="w-10 h-10 rounded-full border-2 border-brand-dark flex items-center justify-center">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <p className="font-bold text-brand-dark/70 leading-relaxed mb-6">{selectedPack.source_text}</p>
            <div className="space-y-4 mb-8">
              {selectedPack.questions?.map((question: any, index: number) => (
                <div key={question.id} className="bg-brand-bg rounded-2xl border-2 border-brand-dark/10 p-4">
                  <p className="font-black mb-2">Q{index + 1}. {question.prompt}</p>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-dark/40">{question.time_limit_seconds || 20}s · {(question.tags_json && JSON.parse(question.tags_json).join(', ')) || 'general'}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => openHostModal(selectedPack)} className="flex-1 bg-brand-orange text-white border-2 border-brand-dark rounded-2xl py-4 font-black">
                Host This Pack
              </button>
              <button onClick={() => navigate('/teacher/pack/create')} className="px-5 bg-white border-2 border-brand-dark rounded-2xl font-black">
                Create Another
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
                onClick={() => handleHost(hostingPack.id, selectedGameMode, selectedTeamCount)}
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

function NavItem({ icon, label, isOpen, active, onClick }: { icon: React.ReactNode; label: string; isOpen: boolean; active?: boolean; onClick?: () => void }) {
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
