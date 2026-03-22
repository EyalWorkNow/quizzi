import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Accessibility, CheckCircle2, Contrast, Hand, Sparkles, X } from 'lucide-react';

export type StudentAccessibilityProfile = 'standard' | 'focus' | 'contrast' | 'touch';

type StudentExperienceContextValue = {
  profile: StudentAccessibilityProfile;
  setProfile: (profile: StudentAccessibilityProfile) => void;
  isStudentFacing: boolean;
};

type StudentProfileOption = {
  id: StudentAccessibilityProfile;
  label: string;
  body: string;
  icon: React.ReactNode;
};

const STUDENT_EXPERIENCE_KEY = 'quizzi.student.experience';

const PROFILE_OPTIONS: StudentProfileOption[] = [
  {
    id: 'standard',
    label: 'Standard',
    body: 'Original pacing, colors, and controls.',
    icon: <Sparkles className="w-4 h-4" />,
  },
  {
    id: 'focus',
    label: 'Focus',
    body: 'Reduced motion with calmer transitions.',
    icon: <Accessibility className="w-4 h-4" />,
  },
  {
    id: 'contrast',
    label: 'High Contrast',
    body: 'Stronger separation between actions and text.',
    icon: <Contrast className="w-4 h-4" />,
  },
  {
    id: 'touch',
    label: 'Large Touch',
    body: 'Bigger controls and more forgiving tap targets.',
    icon: <Hand className="w-4 h-4" />,
  },
];

const StudentExperienceContext = createContext<StudentExperienceContextValue | null>(null);

function isStudentFacingPath(pathname: string) {
  return pathname === '/' || pathname.startsWith('/join/') || pathname.startsWith('/student/');
}

function normalizeProfile(value: unknown): StudentAccessibilityProfile {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'focus' || normalized === 'contrast' || normalized === 'touch' || normalized === 'standard') {
    return normalized;
  }
  return 'standard';
}

function readStoredProfile() {
  if (typeof window === 'undefined') return 'standard' as StudentAccessibilityProfile;
  try {
    const raw = window.localStorage.getItem(STUDENT_EXPERIENCE_KEY);
    if (!raw) return 'standard';
    const parsed = JSON.parse(raw);
    return normalizeProfile(parsed?.profile);
  } catch {
    return 'standard';
  }
}

function persistProfile(profile: StudentAccessibilityProfile) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STUDENT_EXPERIENCE_KEY, JSON.stringify({ profile }));
}

function StudentExperienceDock({
  profile,
  setProfile,
}: {
  profile: StudentAccessibilityProfile;
  setProfile: (profile: StudentAccessibilityProfile) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  const activeProfile = PROFILE_OPTIONS.find((option) => option.id === profile) || PROFILE_OPTIONS[0];

  return (
    <div className="fixed top-4 right-4 z-[80] flex flex-col items-end gap-3 pointer-events-none">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="pointer-events-auto rounded-full border-2 border-brand-dark bg-white px-4 py-3 font-black shadow-[4px_4px_0px_0px_#1A1A1A] flex items-center gap-2"
      >
        <Accessibility className="w-4 h-4 text-brand-purple" />
        <span className="hidden sm:inline">Accessibility</span>
      </button>

      {open && (
        <div className="pointer-events-auto w-[min(92vw,360px)] rounded-[2rem] border-4 border-brand-dark bg-white p-5 shadow-[10px_10px_0px_0px_#1A1A1A]">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Student Comfort Mode</p>
              <h3 className="text-2xl font-black text-brand-dark">Adjust how the student screens feel</h3>
              <p className="font-bold text-brand-dark/60 mt-2">
                Choose the version that feels easiest to read, tap, and follow during live play.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-10 h-10 rounded-full border-2 border-brand-dark bg-brand-bg flex items-center justify-center shrink-0"
              aria-label="Close accessibility settings"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            {PROFILE_OPTIONS.map((option) => {
              const isActive = option.id === profile;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setProfile(option.id)}
                  className={`w-full rounded-[1.4rem] border-2 p-4 text-left transition-all ${
                    isActive
                      ? 'border-brand-dark bg-brand-yellow shadow-[4px_4px_0px_0px_#1A1A1A]'
                      : 'border-brand-dark bg-white hover:bg-brand-bg'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-8 h-8 rounded-full border-2 border-brand-dark bg-white flex items-center justify-center">
                          {option.icon}
                        </span>
                        <span className="font-black text-lg text-brand-dark">{option.label}</span>
                      </div>
                      <p className="font-bold text-sm text-brand-dark/65">{option.body}</p>
                    </div>
                    {isActive && <CheckCircle2 className="w-5 h-5 text-brand-orange shrink-0" />}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-[1.3rem] border-2 border-brand-dark bg-brand-bg p-4">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">Current profile</p>
            <p className="font-black text-brand-dark">{activeProfile.label}</p>
            <p className="font-medium text-brand-dark/60 mt-1">{activeProfile.body}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function StudentExperienceProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [profile, setProfileState] = useState<StudentAccessibilityProfile>(() => readStoredProfile());
  const isStudentFacing = isStudentFacingPath(location.pathname);

  useEffect(() => {
    persistProfile(profile);
  }, [profile]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const body = document.body;
    if (isStudentFacing) {
      body.dataset.studentSurface = 'true';
      body.dataset.studentProfile = profile;
    } else {
      delete body.dataset.studentSurface;
      delete body.dataset.studentProfile;
    }

    return () => {
      delete body.dataset.studentSurface;
      delete body.dataset.studentProfile;
    };
  }, [isStudentFacing, profile]);

  const value = useMemo<StudentExperienceContextValue>(
    () => ({
      profile,
      setProfile: setProfileState,
      isStudentFacing,
    }),
    [isStudentFacing, profile],
  );

  return (
    <StudentExperienceContext.Provider value={value}>
      {children}
      {isStudentFacing && <StudentExperienceDock profile={profile} setProfile={setProfileState} />}
    </StudentExperienceContext.Provider>
  );
}

export function useStudentExperience() {
  const context = useContext(StudentExperienceContext);
  if (!context) {
    throw new Error('useStudentExperience must be used within StudentExperienceProvider');
  }
  return context;
}
