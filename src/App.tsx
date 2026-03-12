/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Home from './client/pages/Home.tsx';
import Explore from './client/pages/Explore.tsx';
import Contact from './client/pages/Contact.tsx';
import Auth from './client/pages/Auth.tsx';
import TeacherDashboard from './client/pages/TeacherDashboard.tsx';
import TeacherHelpCenter from './client/pages/TeacherHelpCenter.tsx';
import TeacherCreatePack from './client/pages/TeacherCreatePack.tsx';
import TeacherHost from './client/pages/TeacherHost.tsx';
import StudentPlay from './client/pages/StudentPlay.tsx';
import StudentDashboard from './client/pages/StudentDashboard.tsx';
import StudentPractice from './client/pages/StudentPractice.tsx';
import TeacherAnalytics from './client/pages/TeacherAnalytics.tsx';
import TeacherReports from './client/pages/TeacherReports.tsx';
import TeacherClasses from './client/pages/TeacherClasses.tsx';
import TeacherSettings from './client/pages/TeacherSettings.tsx';
import TeacherStudentAnalytics from './client/pages/TeacherStudentAnalytics.tsx';
import ProtectedTeacherRoute from './client/components/ProtectedTeacherRoute.tsx';
import { trackPageView } from './client/lib/appAnalytics.ts';

function RouteAnalytics() {
  const location = useLocation();

  useEffect(() => {
    void trackPageView(location.pathname);
  }, [location.pathname]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
        <RouteAnalytics />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/join/:pin" element={<Home />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/teacher/dashboard" element={<ProtectedTeacherRoute><TeacherDashboard /></ProtectedTeacherRoute>} />
          <Route path="/teacher/help" element={<ProtectedTeacherRoute><TeacherHelpCenter /></ProtectedTeacherRoute>} />
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
      </div>
    </BrowserRouter>
  );
}
