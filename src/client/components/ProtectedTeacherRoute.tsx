import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import AppLoadingScreen from './AppLoadingScreen.tsx';
import { loadTeacherAuth, refreshTeacherSession } from '../lib/teacherAuth.ts';

export default function ProtectedTeacherRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [status, setStatus] = useState<'checking' | 'allowed' | 'blocked'>('checking');

  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      const cachedSession = loadTeacherAuth();
      if (!cachedSession) {
        if (!cancelled) {
          setStatus('blocked');
        }
        return;
      }

      const session = await refreshTeacherSession().catch(() => null);
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
        label="Checking teacher access..."
        caption="Restoring your session and workspace permissions."
      />
    );
  }

  if (status === 'blocked') {
    return (
      <Navigate
        to="/auth"
        replace
        state={{
          from: `${location.pathname}${location.search}${location.hash}`,
        }}
      />
    );
  }

  return <>{children}</>;
}
