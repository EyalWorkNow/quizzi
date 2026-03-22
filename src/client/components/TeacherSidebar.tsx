import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  BarChart,
  ChevronLeft,
  Compass,
  HelpCircle,
  Library,
  LogOut,
  Plus,
  Settings,
  Users,
} from 'lucide-react';
import { motion } from 'motion/react';
import { loadTeacherSettings } from '../lib/localData.ts';
import { signOutTeacher } from '../lib/teacherAuth.ts';
import { useAppLanguage } from '../lib/appLanguage.tsx';

export default function TeacherSidebar() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const teacherProfile = loadTeacherSettings().profile;
  const path = location.pathname;
  const { t, direction } = useAppLanguage();

  const handleLogout = async () => {
    await signOutTeacher();
    navigate('/');
  };

  return (
    <motion.aside
      animate={{ width: isSidebarOpen ? 256 : 80 }}
      dir={direction}
      className={`h-screen bg-white ${direction === 'rtl' ? 'border-l-2' : 'border-r-2'} border-brand-dark flex flex-col flex-shrink-0 transition-all duration-300 relative z-20 shadow-[4px_0px_0px_0px_#1A1A1A] overflow-visible`}
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
          {isSidebarOpen && <span className="text-base">{t('dash.nav.createQuiz')}</span>}
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto hide-scrollbar">
        <NavItem icon={<Library />} label={t('dash.nav.myQuizzes')} isOpen={isSidebarOpen} active={path === '/teacher/dashboard'} onClick={() => navigate('/teacher/dashboard')} />
        <NavItem icon={<Compass />} label={t('dash.nav.discover')} isOpen={isSidebarOpen} active={path === '/explore'} onClick={() => navigate('/explore')} />
        <NavItem icon={<BarChart />} label={t('dash.nav.reports')} isOpen={isSidebarOpen} active={path === '/teacher/reports'} onClick={() => navigate('/teacher/reports')} />
        <NavItem icon={<Users />} label={t('dash.nav.classes')} isOpen={isSidebarOpen} active={path === '/teacher/classes'} onClick={() => navigate('/teacher/classes')} />
      </nav>

      {/* Toggle Button — floats outside sidebar, never clipped */}
      <div
        className="absolute top-1/2 -translate-y-1/2 z-[100]"
        style={{ [direction === 'rtl' ? 'left' : 'right']: '-14px' }}
      >
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="w-7 h-7 bg-brand-yellow rounded-full flex items-center justify-center border-2 border-brand-dark hover:bg-yellow-300 transition-colors shadow-[2px_2px_0px_0px_#1A1A1A]"
          aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {/*
            LTR: sidebar open → arrow points LEFT (collapse), closed → points RIGHT (expand)
            RTL: sidebar open → arrow points RIGHT (collapse), closed → points LEFT (expand)
            ChevronLeft = ← by default. rotate-180 flips it to →
          */}
          <ChevronLeft
            className={`w-4 h-4 transition-transform duration-300 ${
              direction === 'rtl'
                ? isSidebarOpen ? 'rotate-180' : ''
                : isSidebarOpen ? '' : 'rotate-180'
            }`}
          />
        </button>
      </div>

      <div className="px-3 pb-3 space-y-1">
        <NavItem icon={<Settings />} label={t('dash.nav.settings')} isOpen={isSidebarOpen} active={path === '/teacher/settings'} onClick={() => navigate('/teacher/settings')} />
        <NavItem icon={<HelpCircle />} label={t('dash.nav.helpCenter')} isOpen={isSidebarOpen} active={path === '/help'} onClick={() => navigate('/help')} />
      </div>

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
              title={t('dash.nav.logOut')}
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </motion.aside>
  );
}

function NavItem({ icon, label, isOpen, active, onClick }: { icon: React.ReactNode; label: string; isOpen: boolean; active?: boolean; onClick?: () => void }) {
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
