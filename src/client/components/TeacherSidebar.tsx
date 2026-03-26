import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  BarChart,
  ChevronLeft,
  Compass,
  HelpCircle,
  Library,
  LogOut,
  Menu,
  X,
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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const teacherProfile = loadTeacherSettings().profile;
  const path = location.pathname;
  const { t, direction } = useAppLanguage();

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const syncViewport = (event?: MediaQueryListEvent) => {
      const matches = event?.matches ?? mediaQuery.matches;
      setIsMobileViewport(matches);
      if (!matches) setIsMobileMenuOpen(false);
    };

    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);
    return () => mediaQuery.removeEventListener('change', syncViewport);
  }, []);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await signOutTeacher();
    navigate('/');
  };

  const goTo = (nextPath: string) => {
    navigate(nextPath);
    setIsMobileMenuOpen(false);
  };

  const mobileTranslateClass = direction === 'rtl'
    ? (isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full')
    : (isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full');
  const mobileEdgeClass = direction === 'rtl' ? 'right-0 border-l-2' : 'left-0 border-r-2';
  const collapseButtonEdge = direction === 'rtl' ? { left: '-14px' } : { right: '-14px' };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsMobileMenuOpen((current) => !current)}
        className={`fixed top-4 z-[80] flex h-12 w-12 items-center justify-center rounded-full border-2 border-brand-dark bg-white shadow-[4px_4px_0px_0px_#1A1A1A] lg:hidden ${direction === 'rtl' ? 'right-4' : 'left-4'}`}
        aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
      >
        {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {isMobileMenuOpen && (
        <button
          type="button"
          aria-label="Close navigation overlay"
          onClick={() => setIsMobileMenuOpen(false)}
          className="fixed inset-0 z-[70] bg-brand-dark/45 backdrop-blur-sm lg:hidden"
        />
      )}

      <motion.aside
        animate={isMobileViewport ? undefined : { width: isSidebarOpen ? 256 : 80 }}
        dir={direction}
        className={`fixed top-0 z-[90] flex h-[100dvh] w-[18rem] max-w-[88vw] flex-col overflow-visible bg-white shadow-[4px_0px_0px_0px_#1A1A1A] transition-transform duration-300 lg:static lg:z-20 lg:h-screen lg:max-w-none lg:flex-shrink-0 lg:translate-x-0 ${mobileEdgeClass} ${mobileTranslateClass} ${isMobileViewport ? '' : 'lg:w-auto'} border-brand-dark`}
      >
        <div className="h-20 flex items-center px-6 border-b-2 border-brand-dark">
          {isSidebarOpen ? (
            <div className="text-2xl font-black tracking-tight flex items-center gap-1 cursor-pointer" onClick={() => goTo('/')}>
              <span className="text-brand-orange">Quiz</span>zi
            </div>
          ) : (
            <div className="w-10 h-10 bg-brand-yellow border-2 border-brand-dark text-brand-dark rounded-full flex items-center justify-center text-xl font-black mx-auto cursor-pointer" onClick={() => goTo('/')}>
              Q
            </div>
          )}
        </div>

        <div className="p-4 border-b-2 border-brand-dark">
          <button
            onClick={() => goTo('/teacher/pack/create')}
            className="w-full bg-brand-orange text-white border-2 border-brand-dark rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#e84d2a] transition-all shadow-[2px_2px_0px_0px_#1A1A1A] py-3"
          >
            <Plus className="w-5 h-5" />
            {(isSidebarOpen || isMobileViewport) && <span className="text-base">{t('dash.nav.createQuiz')}</span>}
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto hide-scrollbar">
          <NavItem icon={<Library />} label={t('dash.nav.myQuizzes')} isOpen={isSidebarOpen || isMobileViewport} active={path === '/teacher/dashboard'} onClick={() => goTo('/teacher/dashboard')} />
          <NavItem icon={<Compass />} label={t('dash.nav.discover')} isOpen={isSidebarOpen || isMobileViewport} active={path === '/explore'} onClick={() => goTo('/explore')} />
          <NavItem icon={<BarChart />} label={t('dash.nav.reports')} isOpen={isSidebarOpen || isMobileViewport} active={path === '/teacher/reports'} onClick={() => goTo('/teacher/reports')} />
          <NavItem icon={<Users />} label={t('dash.nav.classes')} isOpen={isSidebarOpen || isMobileViewport} active={path === '/teacher/classes'} onClick={() => goTo('/teacher/classes')} />
        </nav>

        {!isMobileViewport && (
          <div
            className="absolute top-1/2 -translate-y-1/2 z-[100] hidden lg:block"
            style={collapseButtonEdge}
          >
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="w-7 h-7 bg-brand-yellow rounded-full flex items-center justify-center border-2 border-brand-dark hover:bg-yellow-300 transition-colors shadow-[2px_2px_0px_0px_#1A1A1A]"
              aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <ChevronLeft
                className={`w-4 h-4 transition-transform duration-300 ${
                  direction === 'rtl'
                    ? isSidebarOpen ? 'rotate-180' : ''
                    : isSidebarOpen ? '' : 'rotate-180'
                }`}
              />
            </button>
          </div>
        )}

        <div className="px-3 pb-3 space-y-1">
          <NavItem icon={<Settings />} label={t('dash.nav.settings')} isOpen={isSidebarOpen || isMobileViewport} active={path === '/teacher/settings'} onClick={() => goTo('/teacher/settings')} />
          <NavItem icon={<HelpCircle />} label={t('dash.nav.helpCenter')} isOpen={isSidebarOpen || isMobileViewport} active={path === '/help'} onClick={() => goTo('/help')} />
        </div>

        <div className="p-4 border-t-2 border-brand-dark bg-brand-purple/10">
          <div className={`flex items-center ${(isSidebarOpen || isMobileViewport) ? 'justify-between' : 'justify-center'} bg-white border-2 border-brand-dark p-2 rounded-xl shadow-[2px_2px_0px_0px_#1A1A1A]`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-brand-yellow rounded-full flex items-center justify-center text-sm border-2 border-brand-dark overflow-hidden">
                {teacherProfile.avatar}
              </div>
              {(isSidebarOpen || isMobileViewport) && (
                <div>
                  <p className="font-black text-xs">{teacherProfile.firstName} {teacherProfile.lastName}</p>
                  <p className="text-[10px] font-bold text-brand-dark/60 truncate w-24">{teacherProfile.email}</p>
                </div>
              )}
            </div>
            {(isSidebarOpen || isMobileViewport) && (
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
    </>
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
