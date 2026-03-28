import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import AppLoadingScreen from './AppLoadingScreen.tsx';
import { loadStudentAuth, refreshStudentSession } from '../lib/studentAuth.ts';

export default function ProtectedStudentRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [status, setStatus] = useState<'checking' | 'allowed' | 'blocked'>('checking');

  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      const cachedSession = loadStudentAuth();
      if (!cachedSession) {
        if (!cancelled) {
          setStatus('blocked');
        }
        return;
      }

      const session = await refreshStudentSession().catch(() => null);
      if (cancelled) return;
      setStatus(session ? 'allowed' : 'blocked');
    };

    verify();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (status === 'checking') {
    return (
      <AppLoadingScreen
        label="Checking student access..."
        caption="Making sure your student session is ready before we drop you in."
      />
    );
  }

  if (status === 'blocked') {
    return (
      <Navigate
        to="/student/auth"
        replace
        state={{
          from: `${location.pathname}${location.search}${location.hash}`,
        }}
      />
    );
  }

  return <>{children}</>;
}
