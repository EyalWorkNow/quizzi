import React, { useEffect, useState } from 'react';
import {
  Save,
  User,
  Bell,
  Shield,
  Paintbrush,
  CheckCircle2,
} from 'lucide-react';
import {
  loadTeacherSettings,
  saveTeacherSettings,
  type TeacherSettingsState,
} from '../lib/localData.ts';
import { useAppLanguage } from '../lib/appLanguage.tsx';
import { useTeacherLanguage } from '../lib/teacherLanguage.ts';
import TeacherSidebar from '../components/TeacherSidebar.tsx';

const AVATARS = ['👩🏻‍🏫', '🧑🏽‍🏫', '👨🏼‍🏫', '🦉', '🚀'];
type FeedbackKey = 'profileIncomplete' | 'fillSecurity' | 'passwordsMismatch' | 'saved';

export default function TeacherSettings() {
  const [activeTab, setActiveTab] = useState<'profile' | 'notifications' | 'security' | 'appearance'>('profile');
  const [settingsState, setSettingsState] = useState<TeacherSettingsState>(() => loadTeacherSettings());
  const [securityForm, setSecurityForm] = useState({ current: '', next: '', confirm: '' });
  const [feedbackKey, setFeedbackKey] = useState<FeedbackKey | ''>('');
  const { setLanguage } = useAppLanguage();
  const currentLanguage = settingsState.appearance.language;
  const { copy, direction } = useTeacherLanguage();
  const settingsCopy = copy.settings;

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

  const handleSave = () => {
    if (!settingsState.profile.firstName.trim() || !settingsState.profile.lastName.trim() || !settingsState.profile.email.trim()) {
      setFeedbackKey('profileIncomplete');
      return;
    }
    if (securityForm.next || securityForm.confirm || securityForm.current) {
      if (!securityForm.current || !securityForm.next || !securityForm.confirm) {
        setFeedbackKey('fillSecurity');
        return;
      }
      if (securityForm.next !== securityForm.confirm) {
        setFeedbackKey('passwordsMismatch');
        return;
      }
    }

    saveTeacherSettings(settingsState);
    setSecurityForm({ current: '', next: '', confirm: '' });
    setFeedbackKey('saved');
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
              onClick={handleSave}
              className="px-6 py-3 bg-brand-purple text-white border-2 border-brand-dark rounded-full flex items-center gap-2 hover:bg-purple-500 transition-colors font-black text-base shadow-[2px_2px_0px_0px_#1A1A1A] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_#1A1A1A] active:shadow-none active:translate-y-[2px] active:translate-x-[2px] w-fit"
            >
              <Save className="w-5 h-5" />
              {settingsCopy.saveChanges}
            </button>
          </div>

          {feedbackKey && (
            <div className="mb-6 bg-white border-2 border-brand-dark rounded-2xl p-4 shadow-[2px_2px_0px_0px_#1A1A1A] flex items-center gap-3">
              <CheckCircle2 className={`w-5 h-5 ${feedbackKey === 'saved' ? 'text-emerald-500' : 'text-brand-orange'}`} />
              <span className="font-bold">{settingsCopy.feedback[feedbackKey]}</span>
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
                  <p className="text-brand-dark/60 font-bold">{settingsCopy.security.description}</p>
                  <Field label={settingsCopy.security.currentPassword} type="password" value={securityForm.current} onChange={(value) => setSecurityForm((current) => ({ ...current, current: value }))} />
                  <Field label={settingsCopy.security.newPassword} type="password" value={securityForm.next} onChange={(value) => setSecurityForm((current) => ({ ...current, next: value }))} />
                  <Field label={settingsCopy.security.confirmPassword} type="password" value={securityForm.confirm} onChange={(value) => setSecurityForm((current) => ({ ...current, confirm: value }))} />
                </div>
              )}

              {activeTab === 'appearance' && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-black">{settingsCopy.appearance.title}</h2>
                    <p className="text-brand-dark/60 font-bold mt-2">{settingsCopy.appearance.description}</p>
                  </div>

                  <div>
                    <h3 className="text-xl font-black">{settingsCopy.appearance.themeTitle}</h3>
                    <p className="text-brand-dark/60 font-bold mt-2 mb-4">{settingsCopy.appearance.themeDescription}</p>
                    <div className="flex gap-4 flex-wrap">
                      {(['light', 'dark'] as const).map((theme) => (
                        <button
                          key={theme}
                          onClick={() => updateAppearance('theme', theme)}
                          className={`w-28 h-28 rounded-2xl border-4 border-brand-dark flex items-center justify-center shadow-[4px_4px_0px_0px_#1A1A1A] ${settingsState.appearance.theme === theme ? 'bg-brand-orange text-white' : theme === 'light' ? 'bg-brand-bg text-brand-dark' : 'bg-brand-dark text-white'}`}
                        >
                          <span className="font-black text-lg">{theme === 'light' ? settingsCopy.appearance.light : settingsCopy.appearance.dark}</span>
                        </button>
                      ))}
                    </div>
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
    <div className="flex items-center justify-between p-4 border-2 border-brand-dark rounded-xl bg-brand-bg">
      <span className="font-bold">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`w-14 h-8 rounded-full border-2 border-brand-dark p-1 transition-colors relative ${checked ? 'bg-brand-orange' : 'bg-slate-300'}`}
      >
        <div className={`w-5 h-5 bg-white border-2 border-brand-dark rounded-full transition-transform ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}
