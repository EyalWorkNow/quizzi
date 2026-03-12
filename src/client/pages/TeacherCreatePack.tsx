import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Wand2, Plus, Trash2, Save, Sparkles, BookOpen, Upload, Settings2, Languages, Hash } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiFetch, apiFetchJson } from '../lib/api.ts';

export default function TeacherCreatePack() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [questions, setQuestions] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [materialProfile, setMaterialProfile] = useState<any>(null);
  const [generationMeta, setGenerationMeta] = useState<any>(null);

  // Advanced Generation Settings
  const [questionCount, setQuestionCount] = useState(5);
  const [difficulty, setDifficulty] = useState('Medium');
  const [language, setLanguage] = useState('English');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExtracting(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await apiFetch('/api/extract-text', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.text) {
        setSourceText(data.text);
        setMaterialProfile(data.material_profile || null);
      } else if (data.error) {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to extract text from file');
    } finally {
      setIsExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleGenerate = async () => {
    if (!sourceText.trim()) return;
    setIsGenerating(true);
    setGenerationStep('Analyzing your material...');

    try {
      // Simulate steps for better UX
      setTimeout(() => setGenerationStep('Formulating questions...'), 1500);
      setTimeout(() => setGenerationStep('Crafting tricky answers...'), 3000);

      const data = await apiFetchJson('/api/packs/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_text: sourceText,
          count: questionCount,
          difficulty,
          language
        })
      });
      if (data.questions) {
        setQuestions(data.questions);
        setMaterialProfile(data.material_profile || materialProfile);
        setGenerationMeta(data.generation_meta || null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
      setGenerationStep('');
    }
  };

  const handleSave = async () => {
    if (!title.trim() || questions.length === 0) return;
    setIsSaving(true);
    try {
      const res = await apiFetch('/api/packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, source_text: sourceText, questions })
      });
      if (res.ok) {
        navigate('/teacher/dashboard');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const addQuestion = () => {
    setQuestions([...questions, {
      prompt: '',
      answers: ['', '', '', ''],
      correct_index: 0,
      explanation: '',
      tags: ['general'],
      time_limit_seconds: 20
    }]);
  };

  const updateQuestion = (index: number, field: string, value: any) => {
    const newQuestions = [...questions];
    newQuestions[index][field] = value;
    setQuestions(newQuestions);
  };

  const updateAnswer = (qIndex: number, aIndex: number, value: string) => {
    const newQuestions = [...questions];
    newQuestions[qIndex].answers[aIndex] = value;
    setQuestions(newQuestions);
  };

  const removeQuestion = (index: number) => {
    const newQuestions = [...questions];
    newQuestions.splice(index, 1);
    setQuestions(newQuestions);
  };

  return (
    <div className="min-h-screen bg-brand-bg pb-20 font-sans text-brand-dark selection:bg-brand-orange selection:text-white">
      {/* Header */}
      <div className="bg-white border-b-4 border-brand-dark sticky top-0 z-20 shadow-[0_4px_0_0_#1A1A1A]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/teacher/dashboard')}
              className="w-12 h-12 flex items-center justify-center bg-white border-2 border-brand-dark rounded-full hover:bg-brand-yellow transition-colors shadow-[2px_2px_0px_0px_#1A1A1A] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none active:bg-brand-orange"
            >
              <ArrowLeft className="w-6 h-6 text-brand-dark" />
            </button>
            <div>
              <h1 className="text-2xl font-black text-brand-dark tracking-tight">Create Quiz Pack</h1>
              <p className="text-sm font-bold text-brand-dark/60">Design your questions or let AI help</p>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving || !title.trim() || questions.length === 0}
            className="bg-brand-purple text-white px-6 py-3 rounded-full font-bold border-2 border-brand-dark hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[4px_4px_0px_0px_#1A1A1A] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_#1A1A1A] active:shadow-none active:translate-y-[4px] active:translate-x-[4px] flex items-center gap-2"
          >
            <Save className="w-5 h-5" />
            {isSaving ? 'Saving...' : 'Save Pack'}
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 mt-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* Left Column - Pack Details & AI Generation */}
          <div className="lg:col-span-4 space-y-6">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="premium-card p-8 sticky top-32"
            >
              <div className="flex items-center gap-4 mb-8">
                <div className="w-14 h-14 bg-brand-yellow/20 border-2 border-brand-dark rounded-2xl flex items-center justify-center shadow-[4px_4px_0px_0px_#1A1A1A]">
                  <BookOpen className="w-8 h-8 text-brand-dark" />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-brand-dark">Quiz Intel</h2>
                  <p className="text-xs font-bold text-brand-dark/40 uppercase tracking-widest">Setup metadata</p>
                </div>
              </div>

              <div className="space-y-8">
                <div className="group">
                  <label htmlFor="pack-title" className="block text-[10px] font-black text-brand-dark/40 mb-2 uppercase tracking-[0.2em] group-focus-within:text-brand-purple transition-colors">Core Title</label>
                  <input
                    id="pack-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Quantum Physics 101"
                    aria-label="Pack Title"
                    className="w-full p-4 bg-brand-bg border-4 border-brand-dark rounded-2xl focus:outline-none focus:ring-8 focus:ring-brand-purple/10 transition-all font-bold placeholder:text-brand-dark/20 text-lg"
                  />
                </div>

                <div className="pt-8 border-t-4 border-dashed border-brand-dark/5">
                  <div className="flex items-center justify-between mb-4">
                    <label htmlFor="source-text" className="text-[10px] font-black text-brand-dark/40 uppercase tracking-[0.2em] flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-brand-orange" />
                      Knowledge Source
                    </label>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isExtracting}
                      className="text-[10px] font-black text-brand-purple uppercase tracking-widest flex items-center gap-1 hover:text-purple-600 transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {isExtracting ? 'Reading...' : 'Upload File'}
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      className="hidden"
                      accept=".pdf,.docx,.txt"
                    />
                  </div>
                  <textarea
                    id="source-text"
                    value={sourceText}
                    onChange={(e) => {
                      setSourceText(e.target.value);
                      setMaterialProfile(null);
                      setGenerationMeta(null);
                    }}
                    placeholder="Drop your lecture notes, articles, or raw data here..."
                    aria-label="Source text for AI generation"
                    className="w-full p-5 bg-brand-bg border-4 border-brand-dark rounded-2xl h-64 resize-none focus:outline-none focus:ring-8 focus:ring-brand-purple/10 transition-all font-bold placeholder:text-brand-dark/20 text-base leading-relaxed"
                  />
                </div>

                {(materialProfile || generationMeta) && (
                  <div className="pt-8 border-t-4 border-dashed border-brand-dark/5 space-y-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-brand-orange" />
                      <span className="text-[10px] font-black text-brand-dark/40 uppercase tracking-[0.2em]">Material Compression Intel</span>
                    </div>

                    {generationMeta && (
                      <div className="grid grid-cols-3 gap-3">
                        <IntelPill label="Mode" value={generationMeta.source_mode || 'raw'} />
                        <IntelPill label="Prompt" value={generationMeta.estimated_prompt_tokens || 0} />
                        <IntelPill label="Save" value={`${generationMeta.token_savings_pct || 0}%`} />
                      </div>
                    )}

                    {materialProfile?.source_excerpt && (
                      <div className="rounded-2xl border-2 border-brand-dark bg-brand-bg p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Compact brief</p>
                        <p className="font-bold text-brand-dark/70 text-sm leading-relaxed whitespace-pre-line">
                          {materialProfile.teaching_brief || materialProfile.source_excerpt}
                        </p>
                      </div>
                    )}

                    {(materialProfile?.topic_fingerprint || []).length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {materialProfile.topic_fingerprint.slice(0, 6).map((topic: string) => (
                          <span key={topic} className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark text-[10px] font-black uppercase tracking-[0.15em]">
                            {topic}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Advanced Settings */}
                <div className="pt-8 border-t-4 border-dashed border-brand-dark/5 space-y-6">
                  <div className="flex items-center gap-2 mb-2">
                    <Settings2 className="w-4 h-4 text-brand-purple" />
                    <span className="text-[10px] font-black text-brand-dark/40 uppercase tracking-[0.2em]">Generation DNA</span>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-brand-dark/60 uppercase flex items-center gap-1">
                        <Hash className="w-3 h-3" /> Questions
                      </label>
                      <select
                        value={questionCount}
                        onChange={(e) => setQuestionCount(Number(e.target.value))}
                        className="w-full p-3 bg-white border-2 border-brand-dark rounded-xl font-bold text-sm focus:outline-none focus:bg-brand-yellow/10"
                      >
                        {[3, 5, 10, 15, 20].map(n => <option key={n} value={n}>{n} Items</option>)}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-brand-dark/60 uppercase flex items-center gap-1">
                        <ArrowLeft className="w-3 h-3 rotate-180" /> Difficulty
                      </label>
                      <select
                        value={difficulty}
                        onChange={(e) => setDifficulty(e.target.value)}
                        className="w-full p-3 bg-white border-2 border-brand-dark rounded-xl font-bold text-sm focus:outline-none focus:bg-brand-yellow/10"
                      >
                        {['Easy', 'Medium', 'Hard', 'Expert'].map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-brand-dark/60 uppercase flex items-center gap-1">
                      <Languages className="w-3 h-3" /> Output Language
                    </label>
                    <div className="flex gap-2">
                      {['English', 'Hebrew'].map(lang => (
                        <button
                          key={lang}
                          onClick={() => setLanguage(lang)}
                          className={`flex-1 p-3 rounded-xl border-2 font-bold text-sm transition-all ${language === lang ? 'bg-brand-orange border-brand-dark text-white shadow-[2px_2px_0px_0px_#1A1A1A] scale-[1.02]' : 'bg-white border-brand-dark/10 text-brand-dark/40 hover:border-brand-dark'}`}
                        >
                          {lang}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !sourceText.trim()}
                  className="magic-glow w-full bg-brand-dark text-white py-5 rounded-[1.5rem] font-black text-lg hover:bg-black disabled:opacity-50 transition-all flex items-center justify-center gap-3 shadow-[6px_6px_0px_0px_#B488FF] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_#B488FF] active:shadow-none active:translate-y-[6px] active:translate-x-[6px] border-2 border-brand-dark group"
                >
                  <Wand2 className={`w-6 h-6 transition-transform group-hover:rotate-12 ${isGenerating ? 'animate-spin' : ''}`} />
                  {isGenerating ? 'Magic in Progress...' : 'Spark Questions'}
                </button>
              </div>
            </motion.div>
          </div>

          <AnimatePresence>
            {isGenerating && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-brand-bg/90 backdrop-blur-md"
              >
                <div className="text-center">
                  <motion.div
                    animate={{
                      scale: [1, 1.1, 1],
                      rotate: [0, 5, -5, 0]
                    }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="w-32 h-32 bg-brand-yellow rounded-[2.5rem] border-4 border-brand-dark flex items-center justify-center mx-auto mb-8 shadow-[8px_8px_0px_0px_#1A1A1A]"
                  >
                    <Wand2 className="w-16 h-16 text-brand-dark" />
                  </motion.div>
                  <h3 className="text-4xl font-black text-brand-dark mb-2">Magic Brewing...</h3>
                  <p className="text-brand-purple font-black text-xl uppercase tracking-widest animate-pulse">
                    {generationStep}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Right Column - Questions List */}
          <div className="lg:col-span-8 space-y-6">
            <div className="flex items-center justify-between bg-white p-6 rounded-[2rem] shadow-[4px_4px_0px_0px_#1A1A1A] border-4 border-brand-dark">
              <h2 className="text-3xl font-black text-brand-dark">Questions <span className="text-brand-dark/40 font-bold text-xl ml-2">({questions.length})</span></h2>
              <button
                onClick={addQuestion}
                className="text-brand-dark font-bold hover:bg-brand-yellow flex items-center gap-2 bg-white border-2 border-brand-dark px-6 py-3 rounded-full transition-colors shadow-[2px_2px_0px_0px_#1A1A1A] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none active:bg-brand-orange"
              >
                <Plus className="w-5 h-5" /> Add Manual
              </button>
            </div>

            {questions.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white rounded-[2rem] p-16 shadow-[8px_8px_0px_0px_#1A1A1A] border-4 border-dashed border-brand-dark/30 text-center"
              >
                <div className="inline-flex items-center justify-center w-24 h-24 bg-brand-bg border-4 border-brand-dark/20 text-brand-dark/40 rounded-full mb-6">
                  <Wand2 className="w-12 h-12" />
                </div>
                <h3 className="text-3xl font-black text-brand-dark mb-4">No questions yet</h3>
                <p className="text-brand-dark/60 font-bold max-w-sm mx-auto text-lg">
                  Paste some text on the left and hit auto-generate, or add questions manually to get started.
                </p>
              </motion.div>
            ) : (
              <div className="space-y-8">
                <AnimatePresence>
                  {questions.map((q, qIndex) => (
                    <motion.div
                      layout
                      initial={{ opacity: 0, y: 20, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9, rotate: -2 }}
                      transition={{ type: "spring", stiffness: 300, damping: 25 }}
                      key={qIndex}
                      className="premium-card p-10 relative group bg-white"
                    >
                      <div className="absolute top-0 left-0 w-6 h-full bg-brand-purple/40 rounded-l-[1.5rem] border-r-4 border-brand-dark opacity-20 group-hover:opacity-100 transition-opacity"></div>

                      <div className="flex justify-between items-center mb-10 pl-6">
                        <div className="flex items-center gap-4">
                          <span className="w-12 h-12 flex items-center justify-center bg-brand-orange text-white font-black rounded-2xl text-xl shadow-[4px_4px_0px_0px_#1A1A1A] border-2 border-brand-dark">
                            {qIndex + 1}
                          </span>
                          <h4 className="text-xs font-black text-brand-dark/30 uppercase tracking-[0.3em]">Active Question</h4>
                        </div>
                        <button
                          onClick={() => removeQuestion(qIndex)}
                          className="text-brand-dark/40 hover:text-white hover:bg-brand-orange p-3 rounded-xl transition-colors border-2 border-transparent hover:border-brand-dark hover:shadow-[2px_2px_0px_0px_#1A1A1A]"
                          title="Remove Question"
                        >
                          <Trash2 className="w-6 h-6" />
                        </button>
                      </div>

                      <div className="mb-8 pl-4">
                        <input
                          id={`question-${qIndex}`}
                          type="text"
                          value={q.prompt}
                          onChange={(e) => updateQuestion(qIndex, 'prompt', e.target.value)}
                          placeholder="What is the question?"
                          aria-label={`Question ${qIndex + 1} prompt`}
                          className="w-full p-5 bg-brand-bg border-4 border-brand-dark rounded-2xl focus:outline-none focus:ring-4 focus:ring-brand-purple/20 text-2xl font-black text-brand-dark transition-all placeholder:text-brand-dark/30 shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]"
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 pl-4">
                        {q.answers.map((ans: string, aIndex: number) => (
                          <div
                            key={aIndex}
                            className={`flex items-center gap-4 p-3 rounded-2xl border-4 transition-all ${q.correct_index === aIndex ? 'border-brand-dark bg-brand-orange/10 shadow-[4px_4px_0px_0px_#1A1A1A]' : 'border-brand-dark/20 bg-white hover:border-brand-dark/50'}`}
                          >
                            <button
                              type="button"
                              aria-label={`Mark answer ${aIndex + 1} as correct`}
                              aria-pressed={q.correct_index === aIndex}
                              onClick={() => updateQuestion(qIndex, 'correct_index', aIndex)}
                              className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors border-2 border-brand-dark focus-visible:ring-4 focus-visible:ring-brand-orange focus:outline-none ${q.correct_index === aIndex ? 'bg-brand-orange text-white' : 'bg-brand-bg text-brand-dark/20 hover:bg-brand-dark/10'}`}
                            >
                              {q.correct_index === aIndex && <div className="w-4 h-4 bg-white rounded-full"></div>}
                            </button>
                            <input
                              id={`answer-${qIndex}-${aIndex}`}
                              type="text"
                              value={ans}
                              onChange={(e) => updateAnswer(qIndex, aIndex, e.target.value)}
                              placeholder={`Answer option ${aIndex + 1}`}
                              aria-label={`Answer option ${aIndex + 1}`}
                              className={`w-full p-3 bg-transparent border-none focus:ring-0 outline-none font-bold text-lg ${q.correct_index === aIndex ? 'text-brand-dark' : 'text-brand-dark/70'}`}
                            />
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-8 border-t-4 border-brand-dark/10 pl-4">
                        <div>
                          <label htmlFor={`explanation-${qIndex}`} className="block text-sm font-black text-brand-dark/60 mb-2 uppercase tracking-wide">Explanation (Optional)</label>
                          <input
                            id={`explanation-${qIndex}`}
                            type="text"
                            value={q.explanation}
                            onChange={(e) => updateQuestion(qIndex, 'explanation', e.target.value)}
                            placeholder="Why is this correct?"
                            className="w-full p-4 bg-brand-bg border-2 border-brand-dark rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-purple/20 transition-all text-base font-bold shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]"
                          />
                        </div>
                        <div>
                          <label htmlFor={`tags-${qIndex}`} className="block text-sm font-black text-brand-dark/60 mb-2 uppercase tracking-wide">Tags (Comma separated)</label>
                          <input
                            id={`tags-${qIndex}`}
                            type="text"
                            value={q.tags.join(', ')}
                            onChange={(e) => updateQuestion(qIndex, 'tags', e.target.value.split(',').map(t => t.trim()))}
                            placeholder="e.g. biology, cells, science"
                            className="w-full p-4 bg-brand-bg border-2 border-brand-dark rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-purple/20 transition-all text-base font-bold shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]"
                          />
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function IntelPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border-2 border-brand-dark bg-white p-3">
      <p className="text-[9px] font-black text-brand-dark/40 uppercase tracking-[0.2em] mb-1">{label}</p>
      <p className="text-sm font-black">{value}</p>
    </div>
  );
}
