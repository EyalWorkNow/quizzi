import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
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
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="text-center text-brand-dark">
          <div className="w-16 h-16 border-4 border-brand-dark border-t-brand-orange rounded-full animate-spin mx-auto mb-4" />
          <p className="text-xl font-black">Checking teacher access...</p>
        </div>
      </div>
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
