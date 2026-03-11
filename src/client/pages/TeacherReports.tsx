import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  LogOut,
  Plus,
  Library,
  Compass,
  BarChart,
  Users,
  Settings,
  HelpCircle,
  ArrowUpRight,
  RefreshCw,
  BrainCircuit,
} from 'lucide-react';
import { motion } from 'motion/react';
import { loadTeacherSettings } from '../lib/localData.ts';
import { signOutTeacher } from '../lib/teacherAuth.ts';

export default function TeacherReports() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [report, setReport] = useState<any>(null);
  const navigate = useNavigate();
  const teacherProfile = loadTeacherSettings().profile;
  const handleLogout = async () => {
    await signOutTeacher();
    navigate('/');
  };

  const loadReport = () => {
    fetch('/api/dashboard/teacher/overview')
      .then((res) => res.json())
      .then(setReport)
      .catch((error) => console.error('Failed to load teacher overview:', error));
  };

  useEffect(() => {
    loadReport();
  }, []);

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
            className="w-full bg-brand-orange text-white border-2 border-brand-dark rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#e84d2a] transition-all shadow-[2px_2px_0px_0px_#1A1A1A] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_#1A1A1A] active:shadow-none active:translate-y-[2px] active:translate-x-[2px] py-3"
          >
            <Plus className="w-5 h-5" />
            {isSidebarOpen && <span className="text-base">Create Quiz</span>}
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto hide-scrollbar">
          <NavItem icon={<Library />} label="My Quizzes" isOpen={isSidebarOpen} onClick={() => navigate('/teacher/dashboard')} />
          <NavItem icon={<Compass />} label="Discover" isOpen={isSidebarOpen} onClick={() => navigate('/explore')} />
          <NavItem icon={<BarChart />} label="Reports" isOpen={isSidebarOpen} active onClick={() => navigate('/teacher/reports')} />
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
        <div className="max-w-[1200px] mx-auto relative z-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl lg:text-4xl font-black tracking-tight">Reports</h1>
              <p className="text-brand-dark/60 font-bold mt-2">Deterministic performance summaries generated from answers and behavior telemetry.</p>
            </div>
            <button
              onClick={loadReport}
              className="px-6 py-3 bg-brand-purple text-white border-2 border-brand-dark rounded-full flex items-center gap-2 hover:bg-purple-500 transition-colors font-black text-base shadow-[2px_2px_0px_0px_#1A1A1A] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_#1A1A1A] active:shadow-none active:translate-y-[2px] active:translate-x-[2px] w-fit"
            >
              <RefreshCw className="w-5 h-5" />
              Refresh
            </button>
          </div>

          {!report ? (
            <div className="bg-white border-2 border-brand-dark rounded-[2rem] p-12 shadow-[4px_4px_0px_0px_#1A1A1A] text-center">
              <p className="text-2xl font-black">Loading live reports...</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
                <StatCard title="Total Players" value={report.summary?.total_players || 0} caption="Across hosted sessions" color="bg-brand-yellow" />
                <StatCard title="Avg Accuracy" value={`${(report.summary?.avg_accuracy || 0).toFixed(1)}%`} caption="Across tracked answers" color="bg-brand-orange" />
                <StatCard title="Quizzes Hosted" value={report.summary?.quizzes_hosted || 0} caption="Sessions with activity" color="bg-brand-purple" textColor="text-white" />
                <StatCard title="Avg Stress" value={`${(report.summary?.avg_stress || 0).toFixed(0)}%`} caption="Behavior pressure index" color="bg-brand-dark" textColor="text-white" />
              </div>

              {report.insights?.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                  {report.insights.map((insight: any, index: number) => (
                    <div key={index} className="bg-white border-2 border-brand-dark rounded-[2rem] shadow-[4px_4px_0px_0px_#1A1A1A] p-6">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-brand-purple text-white border-2 border-brand-dark flex items-center justify-center shrink-0">
                          <BrainCircuit className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Engine Insight</p>
                          <h2 className="text-2xl font-black mb-2">{insight.title}</h2>
                          <p className="text-brand-dark/70 font-medium leading-relaxed">{insight.body}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-white border-2 border-brand-dark rounded-[2rem] shadow-[4px_4px_0px_0px_#1A1A1A] overflow-hidden">
                <div className="p-6 border-b-2 border-brand-dark bg-slate-50">
                  <h2 className="text-2xl font-black">Recent Sessions</h2>
                  <p className="text-sm font-bold text-brand-dark/60 mt-1">Each row is derived from stored answers, timings and focus events.</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b-2 border-brand-dark bg-white">
                        <th className="p-4 font-black text-sm uppercase tracking-wider">Quiz Name</th>
                        <th className="p-4 font-black text-sm uppercase tracking-wider">Date</th>
                        <th className="p-4 font-black text-sm uppercase tracking-wider">Players</th>
                        <th className="p-4 font-black text-sm uppercase tracking-wider">Accuracy</th>
                        <th className="p-4 font-black text-sm uppercase tracking-wider">Stress</th>
                        <th className="p-4 font-black text-sm uppercase tracking-wider">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.recent_sessions?.length > 0 ? (
                        report.recent_sessions.map((row: any) => (
                          <tr key={row.session_id} className="border-b-2 border-brand-dark/10 hover:bg-slate-50 transition-colors">
                            <td className="p-4">
                              <p className="font-bold">{row.quiz_name}</p>
                              <p className="text-xs font-bold text-brand-dark/50 mt-1">{row.headline}</p>
                            </td>
                            <td className="p-4 text-brand-dark/70 font-medium">{row.date}</td>
                            <td className="p-4 font-bold">{row.players}</td>
                            <td className="p-4">
                              <span className={`px-3 py-1 rounded-full text-xs font-black border-2 ${(row.avg_accuracy || 0) > 80 ? 'bg-emerald-100 border-emerald-500 text-emerald-700' : (row.avg_accuracy || 0) > 60 ? 'bg-brand-yellow/30 border-brand-yellow text-brand-dark' : 'bg-brand-orange/20 border-brand-orange text-brand-dark'}`}>
                                {(row.avg_accuracy || 0).toFixed(1)}%
                              </span>
                            </td>
                            <td className="p-4 font-bold">{(row.stress_index || 0).toFixed(0)}%</td>
                            <td className="p-4">
                              <button
                                onClick={() => navigate(`/teacher/analytics/class/${row.session_id}`)}
                                className="text-brand-purple hover:text-purple-700 font-black text-sm flex items-center gap-1"
                              >
                                View <ArrowUpRight className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="p-10 text-center text-brand-dark/50 font-bold">
                            No completed sessions yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function StatCard({
  title,
  value,
  caption,
  color,
  textColor = 'text-brand-dark',
}: {
  title: string;
  value: string | number;
  caption: string;
  color: string;
  textColor?: string;
}) {
  return (
    <div className={`${color} ${textColor} border-2 border-brand-dark rounded-[2rem] p-6 shadow-[4px_4px_0px_0px_#1A1A1A]`}>
      <p className="text-sm font-bold uppercase tracking-wider opacity-80 mb-2">{title}</p>
      <p className="text-4xl font-black mb-2">{value}</p>
      <span className="inline-block bg-white/20 px-2 py-1 rounded-lg text-sm font-black border border-current/20">
        {caption}
      </span>
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
    <button onClick={onClick} className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all ${active ? 'bg-brand-dark text-white border-brand-dark shadow-[2px_2px_0px_0px_#1A1A1A]' : 'bg-transparent border-transparent text-brand-dark/70 hover:bg-white hover:border-brand-dark hover:text-brand-dark hover:shadow-[2px_2px_0px_0px_#1A1A1A]'}`}>
      <div className="flex items-center gap-3">
        <div className={`w-5 h-5 flex items-center justify-center ${active ? 'text-brand-yellow' : ''}`}>
          {icon}
        </div>
        {isOpen && <span className="font-bold text-sm">{label}</span>}
      </div>
    </button>
  );
}
