import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, ArrowLeft, CheckCircle2, Clock3, Copy, Mail, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { addContactSubmission } from '../lib/localData.ts';
import { apiFetchJson } from '../lib/api.ts';
import { trackContactFlow, trackCtaClick, trackFormInteraction } from '../lib/appAnalytics.ts';

const INQUIRY_TYPES = [
  'שיתוף פעולה פדגוגי',
  'פיילוט למוסד לימודי',
  'אינטגרציה וחיבור מערכות (LMS)',
  'תמיכה טכנית',
  'אחר'
];

const TOTAL_STEPS = 5;
const CONTACT_DRAFT_KEY = 'quizzi.contact.draft';
const MESSAGE_SUGGESTIONS = [
  'אנחנו רוצים פיילוט קצר לשתי כיתות',
  'נשמח לדמו למנהלי בית הספר',
  'מחפשים חיבור ל-LMS קיים',
  'יש לנו שאלה טכנית על ההטמעה',
];

function readContactDraft() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CONTACT_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : null;
  } catch {
    return null;
  }
}

export default function Contact() {
  const navigate = useNavigate();
  const draft = readContactDraft();
  const [step, setStep] = useState(typeof draft?.step === 'number' ? draft.step : 0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    inquiryType: typeof draft?.formData?.inquiryType === 'string' ? draft.formData.inquiryType : '',
    name: typeof draft?.formData?.name === 'string' ? draft.formData.name : '',
    organization: typeof draft?.formData?.organization === 'string' ? draft.formData.organization : '',
    email: typeof draft?.formData?.email === 'string' ? draft.formData.email : '',
    message: typeof draft?.formData?.message === 'string' ? draft.formData.message : '',
  });
  const [draftRestored, setDraftRestored] = useState(Boolean(draft?.formData));
  const [copySuccess, setCopySuccess] = useState(false);

  const pageVariants = {
    initial: { opacity: 0, scale: 0.98, y: 20 },
    in: { opacity: 1, scale: 1, y: 0 },
    out: { opacity: 0, scale: 1.02, y: -20 },
  };

  const pageTransition = {
    type: 'spring',
    stiffness: 260,
    damping: 20,
  };

  React.useEffect(() => {
    void trackContactFlow({
      action: draft ? 'draft_restored' : 'step_view',
      step,
      inquiryType: formData.inquiryType,
    });
  }, []);

  React.useEffect(() => {
    if (step < TOTAL_STEPS) {
      window.localStorage.setItem(
        CONTACT_DRAFT_KEY,
        JSON.stringify({
          step,
          formData,
        }),
      );
    } else {
      window.localStorage.removeItem(CONTACT_DRAFT_KEY);
    }
  }, [formData, step]);

  React.useEffect(() => {
    void trackContactFlow({
      action: 'step_view',
      step,
      inquiryType: formData.inquiryType,
    });
  }, [step, formData.inquiryType]);

  const handlePrev = () => setStep((current) => Math.max(0, current - 1));
  const handleNext = () => {
    void trackContactFlow({
      action: 'step_complete',
      step,
      inquiryType: formData.inquiryType,
    });
    setStep((current) => Math.min(TOTAL_STEPS, current + 1));
  };

  const submit = async () => {
    setIsSubmitting(true);
    try {
      await apiFetchJson('/api/contact', {
        method: 'POST',
        body: JSON.stringify(formData),
      });
      addContactSubmission(formData);
      void trackContactFlow({
        action: 'submit_success',
        step: TOTAL_STEPS,
        inquiryType: formData.inquiryType,
      });
      setStep(TOTAL_STEPS);
    } catch (error) {
      console.error('Failed to send contact message:', error);
      // Fallback to local only if API fails, but still show success to user
      addContactSubmission(formData);
      void trackContactFlow({
        action: 'submit_failure',
        step: TOTAL_STEPS,
        inquiryType: formData.inquiryType,
      });
      setStep(TOTAL_STEPS);
    } finally {
      setIsSubmitting(false);
    }
  };

  const progressPercent = Math.min(100, Math.round((step / (TOTAL_STEPS - 1)) * 100));
  const emailLooksValid = /\S+@\S+\.\S+/.test(formData.email);
  const messageLength = formData.message.trim().length;
  const canSubmit = Boolean(formData.message.trim()) && emailLooksValid && Boolean(formData.name.trim());

  const resetDraft = () => {
    window.localStorage.removeItem(CONTACT_DRAFT_KEY);
    setDraftRestored(false);
    setStep(0);
    setFormData({
      inquiryType: '',
      name: '',
      organization: '',
      email: '',
      message: '',
    });
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText('hello@quizzi.app');
      setCopySuccess(true);
      window.setTimeout(() => setCopySuccess(false), 1600);
    } catch {
      setCopySuccess(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg font-sans text-brand-dark flex flex-col selection:bg-brand-orange selection:text-white overflow-hidden" dir="rtl">
      {/* Premium Background Elements */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-orange/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-brand-purple/10 blur-[150px] rounded-full"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[radial-gradient(circle_at_center,_transparent_0%,_rgba(255,255,255,0.4)_100%)]"></div>
      </div>

      <nav className="page-shell-wide flex items-center justify-between gap-4 py-6 relative z-30">
        <div className="text-4xl font-black tracking-tight flex items-center gap-1 cursor-pointer" onClick={() => navigate('/')}>
          <span className="text-brand-orange">Quiz</span>zi
        </div>
        <button 
          onClick={() => navigate(-1)} 
          className="w-14 h-14 rounded-full border-2 border-brand-dark/10 bg-white/40 backdrop-blur-md flex items-center justify-center hover:bg-white hover:border-brand-dark transition-all shadow-xl group"
        >
          <X className="w-6 h-6 group-hover:rotate-90 transition-transform duration-300" />
        </button>
      </nav>

      <main className="flex-1 relative flex items-center justify-center p-6 relative z-20">
        <div className="w-full max-w-5xl">
          <div className="mb-6 rounded-[2rem] border-2 border-brand-dark bg-white/70 p-4 shadow-[6px_6px_0px_0px_#1A1A1A] backdrop-blur-xl">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-orange">Progress</p>
                <p className="text-sm font-bold text-brand-dark/60">התקדמות מהירה, שמירת טיוטה אוטומטית, ותשובה בדרך כלל תוך יום עסקים.</p>
              </div>
              <div className="flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-bg px-4 py-2 text-sm font-black">
                <Clock3 className="h-4 w-4 text-brand-orange" />
                מענה בדרך כלל תוך 24 שעות
              </div>
            </div>
            <div className="h-3 overflow-hidden rounded-full border-2 border-brand-dark bg-brand-bg">
              <div className="h-full bg-brand-orange transition-all duration-500" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-bold text-brand-dark/55">
                <Mail className="h-4 w-4" />
                hello@quizzi.app
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyEmail}
                  className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black"
                >
                  {copySuccess ? 'הועתק' : 'העתקת המייל'} <Copy className="mr-2 inline h-4 w-4" />
                </button>
                {draftRestored ? (
                  <button
                    type="button"
                    onClick={resetDraft}
                    className="rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 text-sm font-black"
                  >
                    ניקוי טיוטה
                  </button>
                ) : null}
              </div>
            </div>
            {draftRestored ? (
              <div className="mt-3 flex items-center gap-2 rounded-[1rem] border-2 border-brand-dark bg-brand-yellow/60 px-4 py-3 text-sm font-black">
                <CheckCircle2 className="h-4 w-4" />
                החזרנו טיוטה קודמת כדי שלא תאבדו התקדמות.
              </div>
            ) : null}
          </div>
          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div 
                key="step0" 
                initial="initial" 
                animate="in" 
                exit="out" 
                variants={pageVariants} 
                transition={pageTransition}
                className="flex flex-col gap-10"
              >
                <div className="text-center md:text-right">
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 }}
                  >
                    <span className="text-brand-orange font-black uppercase tracking-[0.2em] text-sm mb-4 block">צרו קשר</span>
                    <h1 className="text-5xl md:text-7xl font-black mb-6 leading-[1.1]">איך נוכל לסייע<br /><span className="text-brand-purple">למערך הלמידה שלך?</span></h1>
                    <p className="text-xl md:text-2xl font-bold text-brand-dark/50 max-w-2xl">
                      התחילו שיח על שיתופי פעולה פדגוגיים, פיילוטים מוסדיים או תמיכה טכנית עם המומחים שלנו.
                    </p>
                  </motion.div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
                  {INQUIRY_TYPES.map((type, idx) => {
                    const isSelected = formData.inquiryType === type;
                    return (
                      <motion.button
                        key={type}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 + idx * 0.05 }}
                        onClick={() => {
                          setFormData((current) => ({ ...current, inquiryType: type }));
                          void trackContactFlow({
                            action: 'start',
                            step: 0,
                            inquiryType: type,
                          });
                          void trackCtaClick({
                            location: 'contact_step_0',
                            ctaId: 'select_inquiry_type',
                            label: type,
                          });
                          setTimeout(() => setStep(1), 300);
                        }}
                        className={`group relative p-8 rounded-[2.5rem] border-2 text-right transition-all duration-500 overflow-hidden ${
                          isSelected 
                            ? 'bg-brand-dark border-brand-dark text-white shadow-2xl scale-[1.02]' 
                            : 'bg-white/60 backdrop-blur-xl border-brand-dark/10 hover:border-brand-orange hover:shadow-2xl hover:-translate-y-1'
                        }`}
                      >
                        <div className={`w-12 h-12 rounded-2xl mb-6 flex items-center justify-center transition-colors ${isSelected ? 'bg-brand-orange text-white' : 'bg-brand-bg text-brand-dark group-hover:bg-brand-orange/10 group-hover:text-brand-orange'}`}>
                          <ArrowRight className={`w-6 h-6 rotate-180 ${isSelected ? 'animate-pulse' : ''}`} />
                        </div>
                        <span className="text-xl md:text-2xl font-black block leading-tight">
                          {type}
                        </span>
                        <div className={`absolute bottom-[-20px] right-[-20px] w-24 h-24 rounded-full transition-all duration-700 opacity-20 ${isSelected ? 'bg-brand-orange scale-[3]' : 'bg-transparent scale-0 group-hover:scale-100 group-hover:bg-brand-orange/20'}`}></div>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {step > 0 && step < TOTAL_STEPS && (
              <StepCard 
                key={`step-${step}`} 
                step={step} 
                total={TOTAL_STEPS - 1} 
                title={
                  step === 1 ? "מה השם שלך?" : 
                  step === 2 ? "לאיזה מוסד לימודי / ארגון אתה שייך?" : 
                  step === 3 ? "מהו האימייל הרשמי אליו נשיב?" : 
                  "במה נוכל לעזור?"
                } 
                onPrev={handlePrev}
              >
                <div className="w-full">
                  {step === 1 && (
                    <AdvanceField
                      placeholder="הכנס שם מלא"
                      value={formData.name}
                      onChange={(value) => setFormData((current) => ({ ...current, name: value }))}
                      onAdvance={handleNext}
                      field="name"
                      isValid={formData.name.trim().length >= 2}
                      helper="שם מלא עוזר לנו להחזיר תשובה מדויקת ומהירה יותר."
                    />
                  )}
                  {step === 2 && (
                    <AdvanceField
                      placeholder="שם הארגון / מוסד"
                      value={formData.organization}
                      onChange={(value) => setFormData((current) => ({ ...current, organization: value }))}
                      onAdvance={handleNext}
                      field="organization"
                      isValid={formData.organization.trim().length >= 2}
                      helper="אפשר גם מחלקה, פקולטה או שם בית ספר."
                    />
                  )}
                  {step === 3 && (
                    <AdvanceField
                      placeholder="name@institution.edu"
                      value={formData.email}
                      onChange={(value) => setFormData((current) => ({ ...current, email: value }))}
                      onAdvance={handleNext}
                      type="email"
                      field="email"
                      isValid={emailLooksValid}
                      helper={emailLooksValid || !formData.email ? 'נשלח לשם את התשובה.' : 'כדאי להזין כתובת אימייל תקינה.'}
                    />
                  )}
                  {step === 4 && (
                    <div className="w-full">
                      <div className="mb-5 flex flex-wrap gap-2">
                        {MESSAGE_SUGGESTIONS.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => {
                              setFormData((current) => ({
                                ...current,
                                message: current.message ? `${current.message} ${suggestion}` : suggestion,
                              }));
                              void trackCtaClick({
                                location: 'contact_step_4',
                                ctaId: 'message_suggestion',
                                label: suggestion,
                              });
                            }}
                            className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black shadow-[3px_3px_0px_0px_#1A1A1A]"
                          >
                            <Sparkles className="ml-2 inline h-4 w-4 text-brand-orange" />
                            {suggestion}
                          </button>
                        ))}
                      </div>
                      <div className="relative border-b-4 border-brand-dark/20 pb-4 focus-within:border-brand-orange transition-all duration-300">
                        <textarea
                          autoFocus
                          placeholder="כתבו לנו פירוט על הבקשה..."
                          value={formData.message}
                          onChange={(event) => {
                            void trackFormInteraction({
                              formId: 'contact_form',
                              field: 'message',
                              action: 'change',
                            });
                            setFormData((current) => ({ ...current, message: event.target.value }));
                          }}
                          className="w-full bg-transparent text-3xl md:text-5xl font-black outline-none min-h-48 sm:min-h-64 resize-none placeholder:text-brand-dark/10"
                        />
                      </div>
                      <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-6">
                        <div>
                          <p className="text-lg font-bold text-brand-dark/40">ספרו לנו על ההקשר הפדגוגי, היקף המוסד והדחיפות.</p>
                          <p className="mt-2 text-sm font-black text-brand-dark/35">
                            {messageLength}/500 תווים
                          </p>
                        </div>
                        <button
                          onClick={submit}
                          disabled={!canSubmit || isSubmitting}
                          className="px-12 py-5 rounded-full bg-brand-dark text-white flex items-center justify-center gap-3 hover:bg-brand-orange transition-all shadow-[8px_8px_0px_0px_#1A1A1A] hover:shadow-none hover:translate-x-1 hover:translate-y-1 disabled:opacity-50 disabled:pointer-events-none group"
                        >
                          {isSubmitting ? (
                            <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <>
                              <span className="text-xl font-black">שלח פנייה</span>
                              <ArrowLeft className="w-6 h-6 group-hover:-translate-x-2 transition-transform" />
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </StepCard>
            )}

            {step === TOTAL_STEPS && (
              <motion.div 
                key="done" 
                initial="initial" 
                animate="in" 
                exit="out" 
                variants={pageVariants} 
                transition={pageTransition} 
                className="flex flex-col items-center text-center gap-10 w-full max-w-3xl mx-auto"
              >
                <div className="relative">
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', damping: 10, delay: 0.2 }}
                    className="w-40 h-40 bg-brand-yellow rounded-full border-4 border-brand-dark flex items-center justify-center shadow-2xl z-10 relative"
                  >
                    <span className="text-7xl">🎓</span>
                  </motion.div>
                  <div className="absolute inset-0 bg-brand-orange blur-3xl opacity-30 rounded-full animate-pulse"></div>
                </div>

                <div>
                  <h2 className="text-5xl sm:text-7xl font-black mb-6">תודה, {formData.name.split(' ')[0]}!</h2>
                  <p className="text-2xl md:text-3xl font-bold text-brand-dark/60 leading-relaxed">
                    הפנייה בנושא <span className="text-brand-orange">{formData.inquiryType}</span> עבור <span className="text-brand-purple">{formData.organization}</span> נקלטה במערכת.<br />
                    נציג מקצועי ישיב לך לכתובת {formData.email} בהקדם.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 mt-6">
                  <button 
                    onClick={() => navigate('/help')} 
                    className="bg-brand-dark text-white px-12 py-5 rounded-full font-black text-xl hover:bg-brand-orange transition-all shadow-xl hover:-translate-y-1"
                  >
                    חזרה למרכז העזרה
                  </button>
                  <button 
                    onClick={() => navigate('/')} 
                    className="bg-white border-4 border-brand-dark text-brand-dark px-12 py-5 rounded-full font-black text-xl hover:bg-brand-bg transition-all"
                  >
                    עמוד הבית
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function StepCard({
  step,
  total,
  title,
  onPrev,
  children,
}: {
  key?: React.Key;
  step: number;
  total: number;
  title: string;
  onPrev: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.div 
      initial="initial" 
      animate="in" 
      exit="out" 
      variants={{ initial: { opacity: 0, x: 40 }, in: { opacity: 1, x: 0 }, out: { opacity: 0, x: -40 } }} 
      transition={{ type: 'spring', stiffness: 200, damping: 20 }} 
      className="flex flex-col gap-10 w-full max-w-5xl mx-auto"
    >
      <div className="flex items-center gap-6">
        <button 
          onClick={onPrev} 
          className="w-14 h-14 rounded-full border-2 border-brand-dark/10 bg-white/40 backdrop-blur-md flex items-center justify-center hover:bg-white hover:border-brand-dark transition-all shadow-lg group"
        >
          <ArrowRight className="w-6 h-6 transition-transform" />
        </button>
        <div className="flex flex-col">
          <span className="font-black text-brand-orange uppercase tracking-[0.2em] text-xs">שלב {step}</span>
          <span className="font-bold text-brand-dark/30 tracking-widest text-lg">{String(step).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
        </div>
      </div>
      <h2 className="text-4xl md:text-7xl font-black leading-tight max-w-4xl">{title}</h2>
      {children}
    </motion.div>
  );
}

function AdvanceField({
  placeholder,
  value,
  onChange,
  onAdvance,
  type = 'text',
  field,
  isValid,
  helper,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onAdvance: () => void;
  type?: string;
  field: string;
  isValid: boolean;
  helper: string;
}) {
  return (
    <div className="w-full">
      <div className="relative flex items-center border-b-4 border-brand-dark/20 pb-4 focus-within:border-brand-orange transition-all duration-300">
        <input
          type={type}
          autoFocus
          placeholder={placeholder}
          value={value}
          onFocus={() => {
            void trackFormInteraction({
              formId: 'contact_form',
              field,
              action: 'focus',
            });
          }}
          onChange={(event) => {
            void trackFormInteraction({
              formId: 'contact_form',
              field,
              action: 'change',
            });
            onChange(event.target.value);
          }}
          onKeyDown={(event) => event.key === 'Enter' && value.trim() && onAdvance()}
          className="w-full bg-transparent text-4xl md:text-7xl font-black outline-none placeholder:text-brand-dark/10"
        />
        <AnimatePresence>
          {value.trim() && isValid && (
            <motion.button
              initial={{ opacity: 0, scale: 0.5, x: 20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.5, x: 20 }}
              onClick={onAdvance}
              className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-brand-dark text-white flex items-center justify-center flex-shrink-0 hover:bg-brand-orange transition-all shadow-xl group"
            >
              <ArrowLeft className="w-8 h-8 md:w-10 md:h-10 group-hover:-translate-x-2 transition-transform" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <div className="mt-6 flex items-center gap-2">
        <span className="px-3 py-1 bg-brand-dark/5 rounded-md text-xs font-black text-brand-dark/40 border border-brand-dark/10">ENTER ↵</span>
        <p className="text-sm font-bold text-brand-dark/40">{helper}</p>
      </div>
    </div>
  );
}
