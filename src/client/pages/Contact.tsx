import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, ArrowLeft, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { addContactSubmission } from '../lib/localData.ts';

const INQUIRY_TYPES = ['New project request', 'Media inquiry', 'Product support', 'Something else'];

const TOTAL_STEPS = 5;

export default function Contact() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState({
    inquiryType: '',
    name: '',
    organization: '',
    email: '',
    message: '',
  });

  const pageVariants = {
    initial: { opacity: 0, y: 40 },
    in: { opacity: 1, y: 0 },
    out: { opacity: 0, y: -40 },
  };

  const pageTransition = {
    type: 'tween',
    ease: 'anticipate',
    duration: 0.5,
  };

  const handlePrev = () => setStep((current) => Math.max(0, current - 1));
  const handleNext = () => setStep((current) => Math.min(TOTAL_STEPS, current + 1));

  const submit = () => {
    addContactSubmission(formData);
    setStep(TOTAL_STEPS);
  };

  return (
    <div className="min-h-screen bg-brand-bg font-sans text-brand-dark flex flex-col selection:bg-brand-orange selection:text-white">
      <nav className="flex items-center justify-between p-6 lg:px-12 border-b-4 border-brand-dark bg-white relative z-20">
        <div className="text-3xl font-black tracking-tight flex items-center gap-1 cursor-pointer" onClick={() => navigate('/')}>
          <span className="text-brand-orange">Quiz</span>zi
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="w-12 h-12 rounded-full border-4 border-brand-dark flex items-center justify-center hover:bg-brand-dark hover:text-white transition-colors shadow-[4px_4px_0px_0px_#1A1A1A]">
            <X className="w-6 h-6" />
          </button>
        </div>
      </nav>

      <main className="flex-1 flex items-center justify-center p-6 lg:px-12 relative overflow-hidden">
        <div className="absolute top-20 left-20 w-64 h-64 bg-brand-yellow rounded-full border-4 border-brand-dark opacity-20 -z-10"></div>
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-brand-purple rounded-full border-4 border-brand-dark opacity-20 -z-10"></div>

        <div className="w-full max-w-4xl">
          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div key="step0" initial="initial" animate="in" exit="out" variants={pageVariants} transition={pageTransition} className="flex flex-col gap-8">
                <div>
                  <h1 className="text-4xl font-black mb-4">Let's talk</h1>
                  <p className="text-xl font-bold text-brand-dark/60 max-w-lg">
                    Start a conversation around support, new work, or anything that needs a human response.
                  </p>
                </div>

                <div className="flex flex-col gap-6 mt-8">
                  {INQUIRY_TYPES.map((type) => {
                    const isSelected = formData.inquiryType === type;
                    return (
                      <button
                        key={type}
                        onClick={() => {
                          setFormData((current) => ({ ...current, inquiryType: type }));
                          setTimeout(() => setStep(1), 250);
                        }}
                        className="group flex items-center gap-6 text-left transition-all"
                      >
                        <div className={`w-12 h-12 rounded-full border-4 border-brand-dark flex items-center justify-center transition-colors ${isSelected ? 'bg-brand-orange' : 'bg-transparent group-hover:bg-brand-orange/20'}`}>
                          {isSelected && <div className="w-4 h-4 bg-brand-dark rounded-full"></div>}
                        </div>
                        <span className={`text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight transition-all duration-300 ${isSelected ? 'text-brand-dark' : 'text-transparent'}`} style={{ WebkitTextStroke: isSelected ? '0px' : '2px #1A1A1A' }}>
                          {type}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {step > 0 && step < TOTAL_STEPS && (
              <StepCard key={`step-${step}`} step={step} total={TOTAL_STEPS} title={step === 1 ? "What's your name?" : step === 2 ? 'What organization are you with?' : step === 3 ? 'Which email should we answer?' : 'What do you need help with?'} onPrev={handlePrev}>
                {step === 1 && (
                  <AdvanceField
                    placeholder="Type your name"
                    value={formData.name}
                    onChange={(value) => setFormData((current) => ({ ...current, name: value }))}
                    onAdvance={handleNext}
                  />
                )}
                {step === 2 && (
                  <AdvanceField
                    placeholder="Your organization"
                    value={formData.organization}
                    onChange={(value) => setFormData((current) => ({ ...current, organization: value }))}
                    onAdvance={handleNext}
                  />
                )}
                {step === 3 && (
                  <AdvanceField
                    placeholder="name@company.com"
                    value={formData.email}
                    onChange={(value) => setFormData((current) => ({ ...current, email: value }))}
                    onAdvance={handleNext}
                    type="email"
                  />
                )}
                {step === 4 && (
                  <div className="w-full">
                    <div className="relative border-b-4 border-brand-dark pb-4 focus-within:border-brand-orange transition-colors">
                      <textarea
                        autoFocus
                        placeholder="Write your message"
                        value={formData.message}
                        onChange={(event) => setFormData((current) => ({ ...current, message: event.target.value }))}
                        className="w-full bg-transparent text-3xl sm:text-4xl font-black outline-none min-h-48 resize-none placeholder:text-transparent placeholder:[-webkit-text-stroke:2px_#1A1A1A] placeholder:opacity-30"
                      />
                    </div>
                    <div className="flex items-center justify-between mt-4">
                      <p className="text-sm font-bold text-brand-dark/40">Describe the context, goal and urgency.</p>
                      <button
                        onClick={submit}
                        disabled={!formData.message.trim()}
                        className="w-16 h-16 rounded-full bg-brand-dark text-white flex items-center justify-center flex-shrink-0 hover:bg-brand-orange transition-colors shadow-[4px_4px_0px_0px_#FF5A36] disabled:opacity-50"
                      >
                        <ArrowRight className="w-8 h-8" />
                      </button>
                    </div>
                  </div>
                )}
              </StepCard>
            )}

            {step === TOTAL_STEPS && (
              <motion.div key="done" initial="initial" animate="in" exit="out" variants={pageVariants} transition={pageTransition} className="flex flex-col items-center text-center gap-8 w-full max-w-3xl mx-auto">
                <div className="w-32 h-32 bg-brand-yellow rounded-full border-4 border-brand-dark flex items-center justify-center shadow-[8px_8px_0px_0px_#1A1A1A] mb-8">
                  <span className="text-6xl">🎉</span>
                </div>
                <h2 className="text-5xl sm:text-6xl font-black mb-4">Thanks, {formData.name}!</h2>
                <p className="text-2xl font-bold text-brand-dark/60">
                  Your {formData.inquiryType.toLowerCase()} was saved for {formData.organization}.<br />
                  We'll answer at {formData.email}.
                </p>
                <button onClick={() => navigate('/teacher/help')} className="mt-8 bg-brand-dark text-white px-10 py-5 rounded-full font-black text-xl hover:bg-brand-orange transition-all shadow-[6px_6px_0px_0px_#1A1A1A]">
                  Back to Help Center
                </button>
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
    <motion.div initial="initial" animate="in" exit="out" variants={{ initial: { opacity: 0, y: 40 }, in: { opacity: 1, y: 0 }, out: { opacity: 0, y: -40 } }} transition={{ type: 'tween', ease: 'anticipate', duration: 0.5 }} className="flex flex-col gap-8 w-full max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-4">
        <button onClick={onPrev} className="w-10 h-10 rounded-full border-2 border-brand-dark flex items-center justify-center hover:bg-brand-dark hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="font-bold text-brand-dark/60 tracking-widest">{String(step).padStart(2, '0')}/{String(total).padStart(2, '0')}</span>
      </div>
      <h2 className="text-4xl font-black mb-8">{title}</h2>
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
}: {
  key?: React.Key;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onAdvance: () => void;
  type?: string;
}) {
  return (
    <>
      <div className="relative flex items-end border-b-4 border-brand-dark pb-4 focus-within:border-brand-orange transition-colors">
        <input
          type={type}
          autoFocus
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && value.trim() && onAdvance()}
          className="w-full bg-transparent text-5xl sm:text-6xl font-black outline-none placeholder:text-transparent placeholder:[-webkit-text-stroke:2px_#1A1A1A] placeholder:opacity-30"
        />
        <AnimatePresence>
          {value.trim() && (
            <motion.button
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              onClick={onAdvance}
              className="w-16 h-16 rounded-full bg-brand-dark text-white flex items-center justify-center flex-shrink-0 hover:bg-brand-orange transition-colors shadow-[4px_4px_0px_0px_#FF5A36]"
            >
              <ArrowRight className="w-8 h-8" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <p className="text-sm font-bold text-brand-dark/40 mt-2">Hit Enter ↵</p>
    </>
  );
}
