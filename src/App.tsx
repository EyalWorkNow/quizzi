/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Home from './client/pages/Home.tsx';
import ProtectedTeacherRoute from './client/components/ProtectedTeacherRoute.tsx';
import { AppLanguageProvider } from './client/lib/appLanguage.tsx';
import { trackPageView } from './client/lib/appAnalytics.ts';

const Explore = lazy(() => import('./client/pages/Explore.tsx'));
const Contact = lazy(() => import('./client/pages/Contact.tsx'));
const Auth = lazy(() => import('./client/pages/Auth.tsx'));
const TeacherDashboard = lazy(() => import('./client/pages/TeacherDashboard.tsx'));
const HelpCenter = lazy(() => import('./client/pages/HelpCenter.tsx'));
const TeacherCreatePack = lazy(() => import('./client/pages/TeacherCreatePack.tsx'));
const TeacherHost = lazy(() => import('./client/pages/TeacherHost.tsx'));
const StudentPlay = lazy(() => import('./client/pages/StudentPlay.tsx'));
const StudentDashboard = lazy(() => import('./client/pages/StudentDashboard.tsx'));
const StudentPractice = lazy(() => import('./client/pages/StudentPractice.tsx'));
const TeacherAnalytics = lazy(() => import('./client/pages/TeacherAnalytics.tsx'));
const TeacherReports = lazy(() => import('./client/pages/TeacherReports.tsx'));
const TeacherClasses = lazy(() => import('./client/pages/TeacherClasses.tsx'));
const TeacherSettings = lazy(() => import('./client/pages/TeacherSettings.tsx'));
const TeacherStudentAnalytics = lazy(() => import('./client/pages/TeacherStudentAnalytics.tsx'));

function RouteAnalytics() {
  const location = useLocation();

  useEffect(() => {
    void trackPageView(location.pathname);
  }, [location.pathname]);

  return null;
}

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-900">
      <div className="w-12 h-12 rounded-full border-4 border-slate-300 border-t-slate-900 animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppLanguageProvider>
        <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
          <RouteAnalytics />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/join/:pin" element={<Home />} />
              <Route path="/explore" element={<Explore />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/teacher/dashboard" element={<ProtectedTeacherRoute><TeacherDashboard /></ProtectedTeacherRoute>} />
              <Route path="/help" element={<HelpCenter />} />
              <Route path="/teacher/reports" element={<ProtectedTeacherRoute><TeacherReports /></ProtectedTeacherRoute>} />
              <Route path="/teacher/classes" element={<ProtectedTeacherRoute><TeacherClasses /></ProtectedTeacherRoute>} />
              <Route path="/teacher/settings" element={<ProtectedTeacherRoute><TeacherSettings /></ProtectedTeacherRoute>} />
              <Route path="/teacher/pack/create" element={<ProtectedTeacherRoute><TeacherCreatePack /></ProtectedTeacherRoute>} />
              <Route path="/teacher/session/:pin/host" element={<ProtectedTeacherRoute><TeacherHost /></ProtectedTeacherRoute>} />
              <Route path="/teacher/analytics/class/:sessionId" element={<ProtectedTeacherRoute><TeacherAnalytics /></ProtectedTeacherRoute>} />
              <Route path="/teacher/analytics/class/:sessionId/student/:participantId" element={<ProtectedTeacherRoute><TeacherStudentAnalytics /></ProtectedTeacherRoute>} />
              <Route path="/student/session/:pin/play" element={<StudentPlay />} />
              <Route path="/student/dashboard/:nickname" element={<StudentDashboard />} />
              <Route path="/student/practice/:nickname" element={<StudentPractice />} />
            </Routes>
          </Suspense>
        </div>
      </AppLanguageProvider>
    </BrowserRouter>
  );
}
