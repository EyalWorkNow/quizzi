import React, { useEffect, useState } from 'react';
import {
  Save,
  User,
  Bell,
  Shield,
  Paintbrush,
  CheckCircle2,
  LoaderCircle,
} from 'lucide-react';
import {
  loadTeacherSettings,
  saveTeacherSettings,
  type TeacherSettingsState,
} from '../lib/localData.ts';
import { useAppLanguage } from '../lib/appLanguage.tsx';
import { useTeacherLanguage } from '../lib/teacherLanguage.ts';
import { changeTeacherPassword, loadTeacherAuth } from '../lib/teacherAuth.ts';
import TeacherSidebar from '../components/TeacherSidebar.tsx';

const AVATARS = ['👩🏻‍🏫', '🧑🏽‍🏫', '👨🏼‍🏫', '🦉', '🚀'];
type FeedbackTone = 'success' | 'error';

export default function TeacherSettings() {
  const [activeTab, setActiveTab] = useState<'profile' | 'notifications' | 'security' | 'appearance'>('profile');
  const [settingsState, setSettingsState] = useState<TeacherSettingsState>(() => loadTeacherSettings());
  const [securityForm, setSecurityForm] = useState({ current: '', next: '', confirm: '' });
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { setLanguage } = useAppLanguage();
  const currentLanguage = settingsState.appearance.language;
  const { copy, direction } = useTeacherLanguage();
  const settingsCopy = copy.settings;
  const teacherSession = loadTeacherAuth();
  const passwordChangeAvailable = teacherSession?.provider !== 'google' && teacherSession?.provider !== 'facebook';

  useEffect(() => {
    setSettingsState(loadTeacherSettings());
  }, []);

  const profile = settingsState.profile;

  const updateProfile = (field: keyof TeacherSettingsState['profile'], value: string) => {
    setSettingsState((current) => ({
      ...current,
      profile: { ...current.profile, [field]: value },
    }));
  };

  const updateNotifications = (field: keyof TeacherSettingsState['notifications'], value: boolean) => {
    setSettingsState((current) => ({
      ...current,
      notifications: { ...current.notifications, [field]: value },
    }));
  };

  const updateAppearance = <K extends keyof TeacherSettingsState['appearance']>(
    field: K,
    value: TeacherSettingsState['appearance'][K],
  ) => {
    setSettingsState((current) => ({
      ...current,
      appearance: { ...current.appearance, [field]: value },
    }));
  };

  const handleSave = async () => {
    if (isSaving) return;
    setFeedback(null);

    if (!settingsState.profile.firstName.trim() || !settingsState.profile.lastName.trim() || !settingsState.profile.email.trim()) {
      setFeedback({ tone: 'error', message: settingsCopy.feedback.profileIncomplete });
      return;
    }
    const shouldChangePassword = Boolean(securityForm.current || securityForm.next || securityForm.confirm);
    if (shouldChangePassword) {
      if (!passwordChangeAvailable) {
        setFeedback({ tone: 'error', message: settingsCopy.security.providerManaged });
        return;
      }
      if (!securityForm.current || !securityForm.next || !securityForm.confirm) {
        setFeedback({ tone: 'error', message: settingsCopy.feedback.fillSecurity });
        return;
      }
      if (securityForm.next !== securityForm.confirm) {
        setFeedback({ tone: 'error', message: settingsCopy.feedback.passwordsMismatch });
        return;
      }
    }

    setIsSaving(true);
    try {
      if (shouldChangePassword) {
        await changeTeacherPassword({
          currentPassword: securityForm.current,
          newPassword: securityForm.next,
        });
      }

      saveTeacherSettings(settingsState);
      setSecurityForm({ current: '', next: '', confirm: '' });
      setFeedback({
        tone: 'success',
        message: shouldChangePassword ? settingsCopy.feedback.passwordUpdated : settingsCopy.feedback.saved,
      });
    } catch (error: any) {
      setFeedback({
        tone: 'error',
        message: String(error?.message || settingsCopy.feedback.saveFailed),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const cycleAvatar = () => {
    const currentIndex = AVATARS.indexOf(settingsState.profile.avatar);
    const nextAvatar = AVATARS[(currentIndex + 1 + AVATARS.length) % AVATARS.length];
    updateProfile('avatar', nextAvatar);
  };

  return (
    <div lang={currentLanguage} className="teacher-layout-shell">
      <TeacherSidebar />

      <main dir={direction} className="teacher-layout-main teacher-page-pad pt-20 lg:pt-8">
        <div className="max-w-[1000px] mx-auto relative z-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl lg:text-4xl font-black tracking-tight">{settingsCopy.title}</h1>
              <p className="text-brand-dark/60 font-bold mt-2">{settingsCopy.subtitle}</p>
            </div>
            <button
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="px-6 py-3 bg-brand-purple text-white border-2 border-brand-dark rounded-full flex items-center gap-2 hover:bg-purple-500 transition-colors font-black text-base shadow-[2px_2px_0px_0px_#1A1A1A] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_#1A1A1A] active:shadow-none active:translate-y-[2px] active:translate-x-[2px] w-fit disabled:opacity-60"
            >
              {isSaving ? <LoaderCircle className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
              {settingsCopy.saveChanges}
            </button>
          </div>

          {feedback && (
            <div className={`mb-6 border-2 border-brand-dark rounded-2xl p-4 shadow-[2px_2px_0px_0px_#1A1A1A] flex items-center gap-3 ${feedback.tone === 'success' ? 'bg-white' : 'bg-[#fff1ef]'}`}>
              <CheckCircle2 className={`w-5 h-5 ${feedback.tone === 'success' ? 'text-emerald-500' : 'text-brand-orange'}`} />
              <span className="font-bold">{feedback.message}</span>
            </div>
          )}

          <div className="flex flex-col md:flex-row gap-8">
            <div className="w-full md:w-64 flex flex-col gap-2">
              <TabButton icon={<User />} label={settingsCopy.tabs.profile} active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} />
              <TabButton icon={<Bell />} label={settingsCopy.tabs.notifications} active={activeTab === 'notifications'} onClick={() => setActiveTab('notifications')} />
              <TabButton icon={<Shield />} label={settingsCopy.tabs.security} active={activeTab === 'security'} onClick={() => setActiveTab('security')} />
              <TabButton icon={<Paintbrush />} label={settingsCopy.tabs.appearance} active={activeTab === 'appearance'} onClick={() => setActiveTab('appearance')} />
            </div>

            <div className="flex-1 bg-white border-2 border-brand-dark rounded-[2rem] p-8 shadow-[4px_4px_0px_0px_#1A1A1A]">
              {activeTab === 'profile' && (
                <div className="space-y-6">
                  <h2 className="text-2xl font-black">{settingsCopy.profile.title}</h2>
                  <div className="flex items-center gap-6 mb-8">
                    <div className="w-24 h-24 bg-brand-yellow rounded-full border-4 border-brand-dark flex items-center justify-center text-5xl shadow-[4px_4px_0px_0px_#1A1A1A]">
                      {profile.avatar}
                    </div>
                    <button
                      onClick={cycleAvatar}
                      className="px-4 py-2 bg-brand-bg border-2 border-brand-dark rounded-xl font-bold hover:bg-brand-yellow transition-colors shadow-[2px_2px_0px_0px_#1A1A1A]"
                    >
                      {settingsCopy.profile.changeAvatar}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Field label={settingsCopy.profile.firstName} value={profile.firstName} onChange={(value) => updateProfile('firstName', value)} />
                    <Field label={settingsCopy.profile.lastName} value={profile.lastName} onChange={(value) => updateProfile('lastName', value)} />
                    <Field label={settingsCopy.profile.email} type="email" value={profile.email} onChange={(value) => updateProfile('email', value)} className="md:col-span-2" />
                    <Field label={settingsCopy.profile.school} value={profile.school} onChange={(value) => updateProfile('school', value)} className="md:col-span-2" />
                  </div>
                </div>
              )}

              {activeTab === 'notifications' && (
                <div className="space-y-6">
                  <h2 className="text-2xl font-black">{settingsCopy.notifications.title}</h2>
                  <ToggleRow label={settingsCopy.notifications.featureUpdates} checked={settingsState.notifications.featureUpdates} onChange={(checked) => updateNotifications('featureUpdates', checked)} />
                  <ToggleRow label={settingsCopy.notifications.weeklyReports} checked={settingsState.notifications.weeklyReports} onChange={(checked) => updateNotifications('weeklyReports', checked)} />
                  <ToggleRow label={settingsCopy.notifications.studentJoinAlerts} checked={settingsState.notifications.studentJoinAlerts} onChange={(checked) => updateNotifications('studentJoinAlerts', checked)} />
                  <ToggleRow label={settingsCopy.notifications.marketingEmails} checked={settingsState.notifications.marketingEmails} onChange={(checked) => updateNotifications('marketingEmails', checked)} />
                </div>
              )}

              {activeTab === 'security' && (
                <div className="space-y-6">
                  <h2 className="text-2xl font-black">{settingsCopy.security.title}</h2>
                  {passwordChangeAvailable ? (
                    <>
                      <p className="text-brand-dark/60 font-bold">{settingsCopy.security.description}</p>
                      <Field label={settingsCopy.security.currentPassword} type="password" value={securityForm.current} onChange={(value) => setSecurityForm((current) => ({ ...current, current: value }))} />
                      <Field label={settingsCopy.security.newPassword} type="password" value={securityForm.next} onChange={(value) => setSecurityForm((current) => ({ ...current, next: value }))} />
                      <Field label={settingsCopy.security.confirmPassword} type="password" value={securityForm.confirm} onChange={(value) => setSecurityForm((current) => ({ ...current, confirm: value }))} />
                    </>
                  ) : (
                    <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5">
                      <p className="font-bold text-brand-dark/75">{settingsCopy.security.providerManaged}</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'appearance' && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-black">{settingsCopy.appearance.title}</h2>
                    <p className="text-brand-dark/60 font-bold mt-2">{settingsCopy.appearance.description}</p>
                  </div>

                  <div>
                    <h3 className="text-xl font-black">{settingsCopy.appearance.languageTitle}</h3>
                    <p className="text-brand-dark/60 font-bold mt-2 mb-4">{settingsCopy.appearance.languageDescription}</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {([
                        { id: 'en', label: settingsCopy.appearance.english },
                        { id: 'he', label: settingsCopy.appearance.hebrew },
                        { id: 'ar', label: settingsCopy.appearance.arabic },
                      ] as const).map((option) => (
                        <button
                          key={option.id}
                          onClick={() => {
                            updateAppearance('language', option.id);
                            setLanguage(option.id);
                          }}
                          className={`rounded-2xl border-4 border-brand-dark p-5 text-start shadow-[4px_4px_0px_0px_#1A1A1A] transition-colors ${settingsState.appearance.language === option.id ? 'bg-brand-purple text-white' : 'bg-brand-bg text-brand-dark'}`}
                        >
                          <p className="text-xs font-black uppercase tracking-[0.18em] opacity-70 mb-2">
                            {option.id.toUpperCase()}
                          </p>
                          <p className="text-2xl font-black">{option.label}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  className = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-bold uppercase tracking-wider mb-2">{label}</label>
      <input
        type={type}
        dir={type === 'email' || type === 'password' ? 'ltr' : 'auto'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full bg-brand-bg border-2 border-brand-dark rounded-xl p-3 font-bold focus:outline-none focus:ring-2 focus:ring-brand-orange/20 ${type === 'email' || type === 'password' ? 'text-left' : ''}`}
      />
    </div>
  );
}

function TabButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 transition-all font-bold ${active ? 'bg-brand-dark text-white border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A] translate-y-[-2px] translate-x-[-2px]' : 'bg-white border-brand-dark text-brand-dark hover:bg-brand-bg shadow-[2px_2px_0px_0px_#1A1A1A]'}`}
    >
      {icon}
      {label}
    </button>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-brand-dark bg-brand-bg p-4 sm:flex-row sm:items-center sm:justify-between">
      <span className="min-w-0 font-bold leading-relaxed">{label}</span>
      <FancyToggleSwitch checked={checked} onChange={onChange} />
    </div>
  );
}

function FancyToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <>
      <style>{`
        .quizzi-toggle-container {
          --active-color: #ff5a36;
          --inactive-color: #d3d3d6;
          position: relative;
          flex: 0 0 auto;
          height: 2.6rem;
          aspect-ratio: 292 / 142;
        }

        .quizzi-toggle-input {
          appearance: none;
          margin: 0;
          position: absolute;
          z-index: 1;
          inset: 0;
          width: 100%;
          height: 100%;
          cursor: pointer;
        }

        .quizzi-toggle {
          width: 100%;
          height: 100%;
          overflow: visible;
          display: block;
        }

        .quizzi-toggle-background {
          fill: var(--inactive-color);
          transition: fill .4s;
        }

        .quizzi-toggle-input:checked + .quizzi-toggle .quizzi-toggle-background {
          fill: var(--active-color);
        }

        .quizzi-toggle-circle-center {
          transform-origin: center;
          transition: transform .6s;
        }

        .quizzi-toggle-input:checked + .quizzi-toggle .quizzi-toggle-circle-center {
          transform: translateX(150px);
        }

        .quizzi-toggle-circle {
          transform-origin: center;
          transition: transform .45s;
          backface-visibility: hidden;
        }

        .quizzi-toggle-circle.left {
          transform: scale(1);
        }

        .quizzi-toggle-input:checked + .quizzi-toggle .quizzi-toggle-circle.left {
          transform: scale(0);
        }

        .quizzi-toggle-circle.right {
          transform: scale(0);
        }

        .quizzi-toggle-input:checked + .quizzi-toggle .quizzi-toggle-circle.right {
          transform: scale(1);
        }

        .quizzi-toggle-icon {
          transition: fill .4s;
        }

        .quizzi-toggle-icon.on {
          fill: var(--inactive-color);
        }

        .quizzi-toggle-input:checked + .quizzi-toggle .quizzi-toggle-icon.on {
          fill: #fff;
        }

        .quizzi-toggle-icon.off {
          fill: #eaeaec;
        }

        .quizzi-toggle-input:checked + .quizzi-toggle .quizzi-toggle-icon.off {
          fill: var(--active-color);
        }
      `}</style>

      <label className="quizzi-toggle-container">
        <input
          type="checkbox"
          className="quizzi-toggle-input"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          role="switch"
          aria-checked={checked}
        />
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 292 142" className="quizzi-toggle" aria-hidden="true">
          <path
            d="M71 142C31.7878 142 0 110.212 0 71C0 31.7878 31.7878 0 71 0C110.212 0 119 30 146 30C173 30 182 0 221 0C260 0 292 31.7878 292 71C292 110.212 260.212 142 221 142C181.788 142 173 112 146 112C119 112 110.212 142 71 142Z"
            className="quizzi-toggle-background"
          />
          <rect rx={6} height={64} width={12} y={39} x={64} className="quizzi-toggle-icon on" />
          <path
            d="M221 91C232.046 91 241 82.0457 241 71C241 59.9543 232.046 51 221 51C209.954 51 201 59.9543 201 71C201 82.0457 209.954 91 221 91ZM221 103C238.673 103 253 88.6731 253 71C253 53.3269 238.673 39 221 39C203.327 39 189 53.3269 189 71C189 88.6731 203.327 103 221 103Z"
            fillRule="evenodd"
            className="quizzi-toggle-icon off"
          />
          <g filter="url(#quizzi-toggle-goo)">
            <rect fill="#fff" rx={29} height={58} width={116} y={42} x={13} className="quizzi-toggle-circle-center" />
            <rect fill="#fff" rx={58} height={114} width={114} y={14} x={14} className="quizzi-toggle-circle left" />
            <rect fill="#fff" rx={58} height={114} width={114} y={14} x={164} className="quizzi-toggle-circle right" />
          </g>
          <filter id="quizzi-toggle-goo">
            <feGaussianBlur stdDeviation={10} result="blur" in="SourceGraphic" />
            <feColorMatrix result="goo" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" in="blur" />
          </filter>
        </svg>
      </label>
    </>
  );
}
