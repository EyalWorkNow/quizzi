import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Wand2, Plus, Trash2, Save, Sparkles, BookOpen, Upload, Settings2, Languages, Hash, FileText, UploadCloud, X, Library, Search, Layout, Rocket, Play, PlusCircle, ChevronDown, ChevronUp, Monitor, Brain, MessageSquare, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiFetch, apiFetchJson } from '../lib/api.ts';
import { GAME_MODES, getGameMode, type GameModeId } from '../lib/gameModes.ts';
import SessionSoundtrackFields from '../components/SessionSoundtrackFields.tsx';
import { DEFAULT_SESSION_SOUNDTRACKS, type SessionSoundtrackChoice } from '../../shared/sessionSoundtracks.ts';
import { useAppLanguage } from '../lib/appLanguage.tsx';

function recommendModesForDraft(questionCount: number, topicCount: number) {
  if (questionCount <= 5) {
    return ['speed_sprint', 'confidence_climb', 'classic_quiz'] as GameModeId[];
  }
  if (topicCount >= 4 || questionCount >= 12) {
    return ['mastery_matrix', 'peer_pods', 'classic_quiz'] as GameModeId[];
  }
  return ['peer_pods', 'confidence_climb', 'classic_quiz'] as GameModeId[];
}

const BLOOM_LEVELS = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'] as const;

function parseCsvList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const MAX_QUESTION_ANSWERS = 8;
const MAX_QUESTION_IMAGE_FILE_SIZE = 3 * 1024 * 1024;

function createEmptyQuestion() {
  return {
    prompt: '',
    image_url: '',
    answers: ['', '', '', ''],
    correct_index: 0,
    explanation: '',
    tags: ['general'],
    time_limit_seconds: 20,
    learning_objective: '',
    bloom_level: '',
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

function formatQuestionBankAccuracy(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'No outcome data yet';
  return `${Math.round(numeric * 100)}% correct`;
}

function getQuestionReuseSignal(item: any) {
  const usageCount = Number(item?.usage_count || 0);
  const accuracy = Number(item?.accuracy || 0);

  if (usageCount >= 4 && accuracy >= 0.72) {
    return {
      label: 'Proven reuse',
      detail: 'Students are handling this well. Safe to reuse as-is.',
      badgeClassName: 'bg-emerald-100 text-emerald-900 border-emerald-300',
      cardClassName: 'border-emerald-300 bg-emerald-50/70',
    };
  }

  if (usageCount >= 3 && accuracy > 0 && accuracy <= 0.55) {
    return {
      label: 'Reteach / revise',
      detail: 'This has been used repeatedly but still produces weak outcomes.',
      badgeClassName: 'bg-brand-orange/15 text-brand-dark border-brand-orange',
      cardClassName: 'border-brand-orange/60 bg-brand-orange/5',
    };
  }

  if (usageCount >= 1) {
    return {
      label: 'Watch closely',
      detail: 'Usable, but keep an eye on accuracy and distractors.',
      badgeClassName: 'bg-brand-yellow/40 text-brand-dark border-brand-dark',
      cardClassName: 'border-brand-yellow/80 bg-brand-yellow/10',
    };
  }

  return {
    label: 'Fresh question',
    detail: 'No classroom signal yet. Good candidate when you want something new.',
    badgeClassName: 'bg-brand-purple/15 text-brand-dark border-brand-purple',
    cardClassName: 'border-brand-purple/50 bg-brand-purple/5',
  };
}

export default function TeacherCreatePack() {
  const { language: appLanguage } = useAppLanguage();
  const navigate = useNavigate();
  const { id } = useParams();
  const editPackId = Number(id || 0);
  const isEditMode = Number.isFinite(editPackId) && editPackId > 0;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const questionImageInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const [title, setTitle] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [questions, setQuestions] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isHosting, setIsHosting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [materialProfile, setMaterialProfile] = useState<any>(null);
  const [generationMeta, setGenerationMeta] = useState<any>(null);
  const [genError, setGenError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [academicMeta, setAcademicMeta] = useState({
    course_code: '',
    course_name: '',
    section_name: '',
    academic_term: '',
    week_label: '',
    learning_objectives: [] as string[],
    bloom_levels: [] as string[],
    pack_notes: '',
  });
  const [questionBankQuery, setQuestionBankQuery] = useState('');
  const [questionBankItems, setQuestionBankItems] = useState<any[]>([]);
  const [isQuestionBankLoading, setIsQuestionBankLoading] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [isLoadingPack, setIsLoadingPack] = useState(isEditMode);
  const [packLoadError, setPackLoadError] = useState('');

  // Advanced Generation Settings
  const [questionCount, setQuestionCount] = useState(5);
  const [difficulty, setDifficulty] = useState('Medium');
  const [language, setLanguage] = useState('English');
  const [questionFormat, setQuestionFormat] = useState('Multiple Choice');
  const [cognitiveLevel, setCognitiveLevel] = useState('Mixed');
  const [explanationDetail, setExplanationDetail] = useState('Concise');
  const [showAdvancedGen, setShowAdvancedGen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedLaunchMode, setSelectedLaunchMode] = useState<GameModeId>('classic_quiz');
  const [selectedTeamCount, setSelectedTeamCount] = useState<number>(4);
  const [selectedLobbyTrackId, setSelectedLobbyTrackId] = useState<SessionSoundtrackChoice>(
    DEFAULT_SESSION_SOUNDTRACKS.lobby_track_id,
  );
  const [selectedGameplayTrackId, setSelectedGameplayTrackId] = useState<SessionSoundtrackChoice>(
    DEFAULT_SESSION_SOUNDTRACKS.gameplay_track_id,
  );
  const [creationStep, setCreationStep] = useState<'CONTENT' | 'QUESTIONS'>('CONTENT');
  const createPackCopy = {
    he: {
      extractFailed: 'חילוץ הטקסט מהקובץ נכשל',
      editPack: 'עריכת חבילת חידון',
      createPack: 'יצירת חבילת חידון',
      editBody: 'חדד שאלות, שמור על זרימת הכיתה ופרסם גרסה בטוחה יותר בעת הצורך.',
      createBody: 'תכנן את השאלות שלך או תן ל־AI לעזור.',
      updating: 'מעדכן...',
      saving: 'שומר...',
      updatePack: 'עדכן חבילה',
      savePack: 'שמור חבילה',
      launching: 'מפעיל...',
      updateAndHost: 'עדכן וארח',
      saveAndHost: 'שמור וארח',
      stepContent: '1. חומר וקסם',
      stepQuestions: '2. סקירה והפעלה',
    },
    ar: {
      extractFailed: 'تعذر استخراج النص من الملف',
      editPack: 'تحرير حزمة الاختبار',
      createPack: 'إنشاء حزمة اختبار',
      editBody: 'حسّن الأسئلة، واحفظ تدفق الحصة، وانشر نسخة أكثر أمانًا عند الحاجة.',
      createBody: 'صمّم أسئلتك أو دع الذكاء الاصطناعي يساعدك.',
      updating: 'جارٍ التحديث...',
      saving: 'جارٍ الحفظ...',
      updatePack: 'حدّث الحزمة',
      savePack: 'احفظ الحزمة',
      launching: 'جارٍ الإطلاق...',
      updateAndHost: 'حدّث واستضف',
      saveAndHost: 'احفظ واستضف',
      stepContent: '1. المادة والشرارة',
      stepQuestions: '2. المراجعة والإطلاق',
    },
    en: {
      extractFailed: 'Failed to extract text from file',
      editPack: 'Edit Quiz Pack',
      createPack: 'Create Quiz Pack',
      editBody: 'Refine questions, keep the classroom flow, and publish a safer revision when needed',
      createBody: 'Design your questions or let AI help',
      updating: 'Updating...',
      saving: 'Saving...',
      updatePack: 'Update Pack',
      savePack: 'Save Pack',
      launching: 'Launching...',
      updateAndHost: 'Update & Host',
      saveAndHost: 'Save & Host',
      stepContent: '1. Material & Magic',
      stepQuestions: '2. Review & Launch',
    },
  }[appLanguage];
  const recommendedLaunchModes = useMemo(
    () => recommendModesForDraft(questions.length || questionCount, materialProfile?.topic_fingerprint?.length || 0),
    [materialProfile?.topic_fingerprint?.length, questionCount, questions.length],
  );
  const questionBankSummary = useMemo(() => {
    return questionBankItems.reduce(
      (summary, item) => {
        const signal = getQuestionReuseSignal(item);
        summary.total += 1;
        if (signal.label === 'Proven reuse') summary.proven += 1;
        else if (signal.label === 'Reteach / revise') summary.revise += 1;
        else if (signal.label === 'Watch closely') summary.watch += 1;
        else summary.fresh += 1;
        return summary;
      },
      { total: 0, proven: 0, revise: 0, watch: 0, fresh: 0 },
    );
  }, [questionBankItems]);

  useEffect(() => {
    if (!isEditMode) {
      setIsLoadingPack(false);
      setPackLoadError('');
      return;
    }

    let cancelled = false;
    setIsLoadingPack(true);
    setPackLoadError('');

    apiFetchJson(`/api/teacher/packs/${editPackId}`)
      .then((pack) => {
        if (cancelled) return;
        const initialQuestionCount = Number(pack?.question_count || pack?.questions?.length || 5);
        setTitle(String(pack?.title || ''));
        setSourceText(String(pack?.source_text || ''));
        setQuestions(
          Array.isArray(pack?.questions)
            ? pack.questions.map((question: any, index: number) => ({
                id: question.id,
                prompt: question.prompt || '',
                image_url: question.image_url || '',
                answers: Array.isArray(question.answers)
                  ? question.answers.slice(0, MAX_QUESTION_ANSWERS)
                  : ['', '', '', ''],
                correct_index: Number(question.correct_index || 0),
                explanation: question.explanation || '',
                tags: Array.isArray(question.tags) && question.tags.length > 0 ? question.tags : ['general'],
                time_limit_seconds: Number(question.time_limit_seconds || 20),
                learning_objective: question.learning_objective || '',
                bloom_level: question.bloom_level || '',
                question_order: Number(question.question_order || index + 1),
              }))
            : [],
        );
        setLanguage(String(pack?.source_language || 'English'));
        setAcademicMeta({
          course_code: pack?.course_code || '',
          course_name: pack?.course_name || '',
          section_name: pack?.section_name || '',
          academic_term: pack?.academic_term || '',
          week_label: pack?.week_label || '',
          learning_objectives: Array.isArray(pack?.learning_objectives) ? pack.learning_objectives : [],
          bloom_levels: Array.isArray(pack?.bloom_levels) ? pack.bloom_levels : [],
          pack_notes: pack?.pack_notes || '',
        });
        setGenerationMeta(
          pack?.generation_provider || pack?.generation_model || pack?.generation_contract
            ? {
                provider: pack?.generation_provider || '',
                model: pack?.generation_model || '',
                contract_version: pack?.generation_contract || '',
              }
            : null,
        );
        setIsPublic(Number(pack?.is_public || 0) === 1);
        setQuestionCount(Number.isFinite(initialQuestionCount) ? Math.max(5, Math.min(20, initialQuestionCount)) : 5);
        setCreationStep(Array.isArray(pack?.questions) && pack.questions.length > 0 ? 'QUESTIONS' : 'CONTENT');
      })
      .catch((error: any) => {
        if (cancelled) return;
        setPackLoadError(error?.message || 'Failed to load this pack for editing.');
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingPack(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editPackId, isEditMode]);

  const buildSaveNotice = (savedPack: any) => {
    if (savedPack?.saved_as_new_revision) {
      return {
        tone: 'success' as const,
        message: `${savedPack.title || 'A revised pack'} was saved as a new revision so past session analytics stay intact.`,
      };
    }
    return {
      tone: 'success' as const,
      message: `${savedPack?.title || title || 'Your pack'} was ${isEditMode ? 'updated' : 'saved'} successfully.`,
    };
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsQuestionBankLoading(true);
      apiFetchJson(`/api/teacher/question-bank?q=${encodeURIComponent(questionBankQuery)}&limit=8`)
        .then((rows) => {
          setQuestionBankItems(Array.isArray(rows) ? rows : []);
        })
        .catch(() => {
          setQuestionBankItems([]);
        })
        .finally(() => {
          setIsQuestionBankLoading(false);
        });
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [questionBankQuery]);

  const processFile = async (file: File) => {
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
        // Auto-title from filename
        if (!title) {
          const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
          setTitle(baseName.charAt(0).toUpperCase() + baseName.slice(1));
        }
      } else if (data.error) {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
      alert(createPackCopy.extractFailed);
    } finally {
      setIsExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const clearSource = () => {
    setSourceText('');
    setMaterialProfile(null);
    setGenerationMeta(null);
    setIsGenerating(false);
    setGenError('');
  };

  const handleGenerate = async () => {
    if (!sourceText.trim()) return;
    setIsGenerating(true);
    setGenError('');
    setSaveError('');
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
          language,
          question_format: questionFormat,
          cognitive_level: cognitiveLevel,
          explanation_detail: explanationDetail,
        })
      });
      if (data.questions) {
        setQuestions(data.questions);
        setMaterialProfile(data.material_profile || materialProfile);
        setGenerationMeta(data.generation_meta || null);
        setCreationStep('QUESTIONS');
      }
    } catch (err: any) {
      console.error(err);
      setGenError(err?.message || 'Failed to generate questions. Check your source material and try again.');
    } finally {
      setIsGenerating(false);
      setGenerationStep('');
    }
  };

  const persistPack = async () => {
    if (!title.trim() || questions.length === 0) {
      throw new Error('Pack title and at least one question are required.');
    }
    const preparedQuestions = questions.map((question, index) => {
      const prompt = String(question?.prompt || '').trim();
      if (!prompt) {
        throw new Error(`Question ${index + 1} needs a prompt.`);
      }

      const answerEntries = (Array.isArray(question?.answers) ? question.answers : [])
        .map((answer: string, answerIndex: number) => ({
          answer: String(answer || '').trim(),
          answerIndex,
        }))
        .filter((entry) => entry.answer)
        .slice(0, MAX_QUESTION_ANSWERS);

      if (answerEntries.length < 2) {
        throw new Error(`Question ${index + 1} needs at least two answer choices.`);
      }

      const correctAnswerIndex = answerEntries.findIndex(
        (entry) => entry.answerIndex === Number(question?.correct_index || 0),
      );
      if (correctAnswerIndex < 0) {
        throw new Error(`Question ${index + 1} must mark one of the filled answers as correct.`);
      }

      return {
        ...question,
        prompt,
        image_url: String(question?.image_url || ''),
        answers: answerEntries.map((entry) => entry.answer),
        correct_index: correctAnswerIndex,
        question_order: index + 1,
      };
    });

    const res = await apiFetch(isEditMode ? `/api/teacher/packs/${editPackId}` : '/api/packs', {
      method: isEditMode ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        source_text: sourceText,
        questions: preparedQuestions,
        language,
        academic_meta: academicMeta,
        generation_meta: generationMeta
          ? {
              provider: generationMeta.provider || '',
              model: generationMeta.model || '',
              contract_version: generationMeta.contract_version || '',
            }
          : undefined,
        is_public: isPublic,
      })
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.error || 'Failed to save pack');
    }
    return res.json();
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError('');
    try {
      const savedPack = await persistPack();
      navigate('/teacher/dashboard', {
        state: { notice: buildSaveNotice(savedPack) },
      });
    } catch (err: any) {
      console.error(err);
      setSaveError(err?.message || 'Failed to save pack.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAndHost = async () => {
    const mode = getGameMode(selectedLaunchMode);
    setIsHosting(true);
    setSaveError('');
    try {
      const savedPack = await persistPack();
      const response = await apiFetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quiz_pack_id: savedPack.id,
          game_type: mode.id,
          team_count: mode.teamBased ? selectedTeamCount : 0,
          mode_config: {
            ...mode.defaultModeConfig,
            lobby_track_id: selectedLobbyTrackId,
            gameplay_track_id: selectedGameplayTrackId,
          },
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to start live session');
      }
      const session = await response.json();
      navigate(`/teacher/session/${session.pin}/host`, {
        state: { sessionId: session.id, packId: savedPack.id },
      });
    } catch (err: any) {
      console.error(err);
      setSaveError(err?.message || 'Failed to launch live session.');
    } finally {
      setIsHosting(false);
    }
  };

  const addQuestion = () => {
    setSaveError('');
    setQuestions([...questions, createEmptyQuestion()]);
  };

  const updateQuestion = (index: number, field: string, value: any) => {
    setSaveError('');
    const newQuestions = [...questions];
    newQuestions[index][field] = value;
    setQuestions(newQuestions);
  };

  const updateAnswer = (qIndex: number, aIndex: number, value: string) => {
    setSaveError('');
    const newQuestions = [...questions];
    newQuestions[qIndex].answers[aIndex] = value;
    setQuestions(newQuestions);
  };

  const addAnswer = (qIndex: number) => {
    setSaveError('');
    setQuestions((current) =>
      current.map((question, index) =>
        index === qIndex
          ? {
              ...question,
              answers:
                question.answers.length < MAX_QUESTION_ANSWERS
                  ? [...question.answers, '']
                  : question.answers,
            }
          : question,
      ),
    );
  };

  const removeAnswer = (qIndex: number, aIndex: number) => {
    setSaveError('');
    setQuestions((current) =>
      current.map((question, index) => {
        if (index !== qIndex || question.answers.length <= 2) return question;
        const nextAnswers = question.answers.filter((_: string, answerIndex: number) => answerIndex !== aIndex);
        let nextCorrectIndex = Number(question.correct_index || 0);
        if (nextCorrectIndex === aIndex) {
          nextCorrectIndex = 0;
        } else if (nextCorrectIndex > aIndex) {
          nextCorrectIndex -= 1;
        }
        return {
          ...question,
          answers: nextAnswers,
          correct_index: Math.max(0, Math.min(nextCorrectIndex, nextAnswers.length - 1)),
        };
      }),
    );
  };

  const removeQuestion = (index: number) => {
    setSaveError('');
    const newQuestions = [...questions];
    newQuestions.splice(index, 1);
    setQuestions(newQuestions);
  };

  const handleQuestionImageUpload = async (qIndex: number, file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setSaveError('Question images must be image files.');
      return;
    }
    if (file.size > MAX_QUESTION_IMAGE_FILE_SIZE) {
      setSaveError('Question images must be 3MB or smaller.');
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      updateQuestion(qIndex, 'image_url', dataUrl);
    } catch (error: any) {
      setSaveError(error?.message || 'Failed to attach question image.');
    } finally {
      const input = questionImageInputRefs.current[qIndex];
      if (input) input.value = '';
    }
  };

  const importQuestionFromBank = (item: any) => {
    setSaveError('');
    setQuestions((current) => [
      ...current,
      {
        prompt: item.prompt || '',
        image_url: item.image_url || '',
        answers: Array.isArray(item.answers) ? item.answers.slice(0, MAX_QUESTION_ANSWERS) : ['', '', '', ''],
        correct_index: Number(item.correct_index || 0),
        explanation: item.explanation || '',
        tags: Array.isArray(item.tags) && item.tags.length > 0 ? item.tags : ['general'],
        time_limit_seconds: Number(item.time_limit_seconds || 20),
        learning_objective: item.learning_objective || '',
        bloom_level: item.bloom_level || '',
      },
    ]);
  };

  if (isLoadingPack) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center px-6">
        <div className="rounded-[2rem] border-4 border-brand-dark bg-white px-10 py-9 shadow-[10px_10px_0px_0px_#1A1A1A] text-center">
          <div className="mx-auto mb-5 h-14 w-14 rounded-full border-4 border-brand-dark border-t-brand-orange animate-spin" />
          <p className="text-2xl font-black text-brand-dark">{isEditMode ? 'Loading pack editor...' : 'Loading...'}</p>
        </div>
      </div>
    );
  }

  if (packLoadError) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center px-6">
        <div className="w-full max-w-2xl rounded-[2rem] border-4 border-brand-dark bg-white p-8 shadow-[10px_10px_0px_0px_#1A1A1A]">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-3">Pack editor</p>
          <h1 className="text-4xl font-black text-brand-dark mb-3">This quiz could not be opened for editing.</h1>
          <p className="font-bold text-brand-dark/65 mb-6">{packLoadError}</p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => navigate('/teacher/dashboard')}
              className="px-6 py-3 rounded-full border-2 border-brand-dark bg-white font-black shadow-[3px_3px_0px_0px_#1A1A1A]"
            >
              Back to dashboard
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 rounded-full border-2 border-brand-dark bg-brand-orange text-white font-black shadow-[3px_3px_0px_0px_#1A1A1A]"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

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
              <h1 className="text-2xl font-black text-brand-dark tracking-tight">{isEditMode ? createPackCopy.editPack : createPackCopy.createPack}</h1>
              <p className="text-sm font-bold text-brand-dark/60">
                {isEditMode ? createPackCopy.editBody : createPackCopy.createBody}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 justify-end">
            <button
              onClick={handleSave}
              disabled={isSaving || isHosting || !title.trim() || questions.length === 0}
              className="bg-brand-purple text-white px-6 py-3 rounded-full font-bold border-2 border-brand-dark hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[4px_4px_0px_0px_#1A1A1A] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_#1A1A1A] active:shadow-none active:translate-y-[4px] active:translate-x-[4px] flex items-center gap-2"
            >
              <Save className="w-5 h-5" />
              {isSaving ? (isEditMode ? createPackCopy.updating : createPackCopy.saving) : isEditMode ? createPackCopy.updatePack : createPackCopy.savePack}
            </button>
            <button
              onClick={handleSaveAndHost}
              disabled={isSaving || isHosting || !title.trim() || questions.length === 0}
              className="bg-brand-orange text-white px-6 py-3 rounded-full font-bold border-2 border-brand-dark hover:bg-[#e84d2a] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[4px_4px_0px_0px_#1A1A1A] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_#1A1A1A] active:shadow-none active:translate-y-[4px] active:translate-x-[4px] flex items-center gap-2"
            >
              <Sparkles className="w-5 h-5" />
              {isHosting ? createPackCopy.launching : `${isEditMode ? createPackCopy.updateAndHost : createPackCopy.saveAndHost} ${getGameMode(selectedLaunchMode).shortLabel}`}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 mt-8">
        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-8 mb-12">
          {[
            { id: 'CONTENT', label: createPackCopy.stepContent, icon: Sparkles },
            { id: 'QUESTIONS', label: createPackCopy.stepQuestions, icon: Layout },
          ].map((step) => {
            const isActive = creationStep === step.id;
            return (
              <button
                key={step.id}
                onClick={() => setCreationStep(step.id as any)}
                className={`flex items-center gap-3 px-8 py-4 rounded-2xl border-4 transition-all ${
                  isActive
                    ? 'bg-brand-orange text-white border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A] scale-105'
                    : 'bg-white text-brand-dark/40 border-brand-dark/5 hover:border-brand-dark/20'
                }`}
              >
                <step.icon className={`w-6 h-6 ${isActive ? 'text-white' : 'text-brand-dark/20'}`} />
                <span className="font-black text-lg uppercase tracking-widest">{step.label}</span>
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          {creationStep === 'CONTENT' ? (
            <motion.div
              key="step-content"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-20"
            >
              <div className="lg:col-span-12">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Left Column - Metadata */}
                  <div className="space-y-6">
                    <div className="premium-card p-10">
                      <div className="flex items-center gap-4 mb-8">
                        <div className="w-14 h-14 bg-brand-yellow/20 border-2 border-brand-dark rounded-2xl flex items-center justify-center shadow-[4px_4px_0px_0px_#1A1A1A]">
                          <BookOpen className="w-8 h-8 text-brand-dark" />
                        </div>
                        <div>
                          <h2 className="text-2xl font-black text-brand-dark">Academic Context</h2>
                          <p className="text-xs font-bold text-brand-dark/40 uppercase tracking-widest">Metadata mapping</p>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div className="group">
                          <label className="block text-[10px] font-black text-brand-dark/40 mb-2 uppercase tracking-[0.2em]">Pack Title</label>
                          <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="e.g. Molecular Biology Quiz"
                            className="w-full p-4 bg-brand-bg border-4 border-brand-dark rounded-2xl focus:outline-none font-black text-lg"
                          />
                        </div>
                        {/* More meta... abbreviated for replacement clarity but kept functional */}
                        <div className="grid grid-cols-2 gap-4">
                          <input
                            type="text"
                            value={academicMeta.course_code}
                            onChange={(e) => setAcademicMeta(c => ({...c, course_code: e.target.value}))}
                            placeholder="BIO101"
                            className="w-full p-4 bg-white border-2 border-brand-dark rounded-xl font-bold"
                          />
                          <input
                            type="text"
                            value={academicMeta.academic_term}
                            onChange={(e) => setAcademicMeta(c => ({...c, academic_term: e.target.value}))}
                            placeholder="Spring 2026"
                            className="w-full p-4 bg-white border-2 border-brand-dark rounded-xl font-bold"
                          />
                        </div>
                        <textarea
                          value={academicMeta.pack_notes}
                          onChange={(e) => setAcademicMeta(c => ({...c, pack_notes: e.target.value}))}
                          placeholder="Teaching notes & framing..."
                          className="w-full min-h-[140px] p-4 bg-white border-2 border-brand-dark rounded-xl font-bold resize-none"
                        />
                      </div>
                    </div>

                    <div className="premium-card p-10">
                      <div className="flex items-center gap-4 mb-8">
                        <div className="w-14 h-14 bg-brand-purple/20 border-2 border-brand-dark rounded-2xl flex items-center justify-center shadow-[4px_4px_0px_0px_#1A1A1A]">
                          <Settings2 className="w-8 h-8 text-brand-dark" />
                        </div>
                        <div>
                          <h2 className="text-2xl font-black text-brand-dark">Gen Parameters</h2>
                          <p className="text-xs font-bold text-brand-dark/40 uppercase tracking-widest">AI Tuning</p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-brand-dark/40 uppercase tracking-widest flex items-center gap-2">
                              <Hash className="w-3 h-3" /> Question Count
                            </label>
                            <select 
                              value={questionCount} 
                              onChange={e => setQuestionCount(Number(e.target.value))}
                              className="w-full p-4 bg-white border-2 border-brand-dark rounded-xl font-bold shadow-[2px_2px_0px_0px_#1A1A1A] focus:translate-y-[1px] focus:translate-x-[1px] focus:shadow-none transition-all outline-none"
                            >
                              {[5, 10, 15, 20].map(n => <option key={n} value={n}>{n} Items</option>)}
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-brand-dark/40 uppercase tracking-widest flex items-center gap-2">
                              <Rocket className="w-3 h-3" /> Difficulty
                            </label>
                            <select 
                              value={difficulty} 
                              onChange={e => setDifficulty(e.target.value)}
                              className="w-full p-4 bg-white border-2 border-brand-dark rounded-xl font-bold shadow-[2px_2px_0px_0px_#1A1A1A] focus:translate-y-[1px] focus:translate-x-[1px] focus:shadow-none transition-all outline-none"
                            >
                              {['Easy', 'Medium', 'Hard'].map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                          </div>
                        </div>

                        {/* Advanced Settings Toggle */}
                        <button
                          onClick={() => setShowAdvancedGen(!showAdvancedGen)}
                          className="w-full py-3 px-4 flex items-center justify-between bg-brand-bg border-2 border-brand-dark rounded-xl hover:bg-brand-yellow/10 transition-colors group"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-1.5 bg-white border-2 border-brand-dark rounded-lg shadow-[1px_1px_0px_0px_#1A1A1A] group-hover:bg-brand-yellow transition-colors">
                              <Settings2 className="w-4 h-4 text-brand-dark" />
                            </div>
                            <span className="text-sm font-black text-brand-dark uppercase tracking-widest">Advanced Tuning</span>
                          </div>
                          {showAdvancedGen ? <ChevronUp className="w-5 h-5 text-brand-dark" /> : <ChevronDown className="w-5 h-5 text-brand-dark" />}
                        </button>

                        <AnimatePresence>
                          {showAdvancedGen && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.3, ease: 'easeInOut' }}
                              className="overflow-hidden"
                            >
                              <div className="pt-2 grid grid-cols-1 gap-4">
                                <div className="grid grid-cols-2 gap-4">
                                  <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-brand-dark/40 uppercase tracking-widest flex items-center gap-2">
                                      <Languages className="w-3 h-3" /> Language
                                    </label>
                                    <select 
                                      value={language} 
                                      onChange={e => setLanguage(e.target.value)}
                                      className="w-full p-3 bg-white border-2 border-brand-dark rounded-xl font-bold text-sm"
                                    >
                                      <option value="English">🇬🇧 English</option>
                                      <option value="Hebrew">🇮🇱 עברית</option>
                                    </select>
                                  </div>
                                  <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-brand-dark/40 uppercase tracking-widest flex items-center gap-2">
                                      <Layout className="w-3 h-3" /> Question Style
                                    </label>
                                    <select 
                                      value={questionFormat} 
                                      onChange={e => setQuestionFormat(e.target.value)}
                                      className="w-full p-3 bg-white border-2 border-brand-dark rounded-xl font-bold text-sm"
                                    >
                                      <option value="Multiple Choice">Multiple Choice</option>
                                      <option value="True/False">True / False Only</option>
                                      <option value="Mixed">Mixed Formats</option>
                                    </select>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                  <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-brand-dark/40 uppercase tracking-widest flex items-center gap-2">
                                      <Brain className="w-3 h-3" /> Knowledge Depth
                                    </label>
                                    <select 
                                      value={cognitiveLevel} 
                                      onChange={e => setCognitiveLevel(e.target.value)}
                                      className="w-full p-3 bg-white border-2 border-brand-dark rounded-xl font-bold text-sm"
                                    >
                                      <option value="Foundational">Foundational</option>
                                      <option value="Mixed">Level Mix (Recommended)</option>
                                      <option value="Higher Order">Higher Order Thinking</option>
                                    </select>
                                  </div>
                                  <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-brand-dark/40 uppercase tracking-widest flex items-center gap-2">
                                      <MessageSquare className="w-3 h-3" /> Explanations
                                    </label>
                                    <select 
                                      value={explanationDetail} 
                                      onChange={e => setExplanationDetail(e.target.value)}
                                      className="w-full p-3 bg-white border-2 border-brand-dark rounded-xl font-bold text-sm"
                                    >
                                      <option value="Concise">Concise Tips</option>
                                      <option value="Detailed">Academic Detail</option>
                                    </select>
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>

                  {/* Right Column - Content Portal */}
                  <div className="space-y-6">
                    <div 
                      className={`premium-card p-0 overflow-hidden relative min-h-[500px] border-4 flex flex-col ${isDragging ? 'border-brand-purple bg-brand-purple/5' : 'border-brand-dark bg-white'}`}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      <div className="p-10 border-b-4 border-brand-dark bg-brand-bg flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Sparkles className="w-6 h-6 text-brand-orange" />
                          <h2 className="text-2xl font-black uppercase tracking-widest">Content Portal</h2>
                        </div>
                        <button onClick={() => fileInputRef.current?.click()} className="text-sm font-black text-brand-purple hover:underline">UPLOAD DOC</button>
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                      </div>
                      
                      <div className="flex-1 relative">
                        {!sourceText && !isExtracting && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-12 text-center pointer-events-none">
                            <UploadCloud className="w-16 h-16 text-brand-purple/30 mb-6" />
                            <h3 className="text-2xl font-black text-brand-dark mb-2">Feed the AI intelligence</h3>
                            <p className="font-bold text-brand-dark/40 max-w-[300px]">Drop course materials, slides, or paste core text directly here.</p>
                          </div>
                        )}
                        <textarea
                          value={sourceText}
                          onChange={(e) => setSourceText(e.target.value)}
                          placeholder="Paste material here..."
                          className="w-full h-full min-h-[400px] p-10 font-bold text-xl leading-relaxed resize-none focus:outline-none"
                        />
                      </div>

                      <div className="p-8 bg-brand-bg border-t-4 border-brand-dark">
                        <button
                          onClick={handleGenerate}
                          disabled={isGenerating || !sourceText.trim()}
                          className="w-full py-6 bg-brand-dark text-white rounded-2xl font-black text-2xl shadow-[8px_8px_0px_0px_#B488FF] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all flex items-center justify-center gap-4 disabled:opacity-50"
                        >
                          <Wand2 className="w-8 h-8" />
                          GENERATE MAGIC
                        </button>
                        {genError && <p className="mt-4 text-red-600 font-bold text-center">⚠️ {genError}</p>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="step-questions"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-20"
            >
              {/* Questions List */}
              <div className="lg:col-span-8 space-y-8">
                <div className="flex items-center justify-between">
                   <h2 className="text-4xl font-black text-brand-dark italic">Design Board</h2>
                   <button onClick={addQuestion} className="px-6 py-3 bg-white border-4 border-brand-dark rounded-xl font-black shadow-[4px_4px_0px_0px_#1A1A1A] hover:bg-brand-yellow transition-all">+ Add Manually</button>
                </div>
                {saveError && (
                  <div className="rounded-[1.5rem] border-4 border-brand-dark bg-brand-orange/10 p-5 font-black text-brand-dark">
                    {saveError}
                  </div>
                )}

                {questions.length === 0 ? (
                  <div className="premium-card p-20 text-center flex flex-col items-center gap-6 border-dashed opacity-50">
                    <Layout className="w-20 h-20" />
                    <p className="text-2xl font-black">No questions in board yet.</p>
                  </div>
                ) : (
                  questions.map((q, qIndex) => (
                    <motion.div
                      layout
                      key={`q-edit-${qIndex}`}
                      className="premium-card p-10 relative overflow-hidden group"
                    >
                      <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-all">
                        <button onClick={() => removeQuestion(qIndex)} className="text-brand-orange hover:scale-110 transition-transform"><Trash2 className="w-8 h-8" /></button>
                      </div>
                      
                      <div className="flex items-center gap-4 mb-8">
                        <span className="w-12 h-12 rounded-xl border-4 border-brand-dark bg-brand-yellow flex items-center justify-center font-black text-2xl">{qIndex + 1}</span>
                        <input
                          type="text"
                          value={q.prompt}
                          onChange={(e) => updateQuestion(qIndex, 'prompt', e.target.value)}
                          className="flex-1 bg-transparent border-none text-3xl font-black focus:ring-0 p-0"
                          placeholder="Enter your question prompt..."
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-3 mb-6">
                        <button
                          type="button"
                          onClick={() => questionImageInputRefs.current[qIndex]?.click()}
                          className="px-4 py-2 bg-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2"
                        >
                          <Upload className="w-4 h-4" />
                          {q.image_url ? 'Replace Question Image' : 'Upload Question Image'}
                        </button>
                        {q.image_url && (
                          <button
                            type="button"
                            onClick={() => updateQuestion(qIndex, 'image_url', '')}
                            className="px-4 py-2 bg-brand-bg border-2 border-brand-dark rounded-full font-black flex items-center gap-2"
                          >
                            <X className="w-4 h-4" />
                            Remove Image
                          </button>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          ref={(node) => {
                            questionImageInputRefs.current[qIndex] = node;
                          }}
                          onChange={(event) => handleQuestionImageUpload(qIndex, event.target.files?.[0])}
                          className="hidden"
                        />
                      </div>

                      {q.image_url && (
                        <div className="mb-6 rounded-[1.8rem] border-4 border-brand-dark bg-white overflow-hidden shadow-[4px_4px_0px_0px_#1A1A1A]">
                          <img
                            src={q.image_url}
                            alt={`Question ${qIndex + 1}`}
                            className="w-full max-h-[320px] object-contain bg-white"
                          />
                        </div>
                      )}

                      <div
                        className="grid gap-4"
                        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
                      >
                        {q.answers.map((ans, aIndex) => (
                          <div 
                            key={`a-edit-${qIndex}-${aIndex}`}
                            className={`flex items-center gap-4 p-4 rounded-2xl border-4 ${q.correct_index === aIndex ? 'bg-brand-orange/10 border-brand-dark' : 'bg-brand-bg/30 border-brand-dark/10'}`}
                          >
                            <button 
                              type="button"
                              onClick={() => updateQuestion(qIndex, 'correct_index', aIndex)}
                              className={`w-10 h-10 rounded-full border-4 ${q.correct_index === aIndex ? 'bg-brand-orange border-brand-dark shadow-[2px_2px_0px_0px_#1A1A1A]' : 'bg-white border-brand-dark/20'}`}
                            />
                            <span className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40">
                              {String.fromCharCode(65 + (aIndex % 26))}
                            </span>
                            <input
                              type="text"
                              value={ans}
                              onChange={(e) => updateAnswer(qIndex, aIndex, e.target.value)}
                              className="flex-1 bg-transparent border-none font-bold text-lg focus:ring-0"
                            />
                            {q.answers.length > 2 && (
                              <button
                                type="button"
                                onClick={() => removeAnswer(qIndex, aIndex)}
                                className="w-10 h-10 rounded-full border-2 border-brand-dark bg-white flex items-center justify-center shrink-0"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="mt-5 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => addAnswer(qIndex)}
                          disabled={q.answers.length >= MAX_QUESTION_ANSWERS}
                          className="px-4 py-2 bg-brand-yellow border-2 border-brand-dark rounded-full font-black flex items-center gap-2 disabled:opacity-50"
                        >
                          <Plus className="w-4 h-4" />
                          Add Answer
                        </button>
                        <p className="text-sm font-bold text-brand-dark/55">
                          Up to {MAX_QUESTION_ANSWERS} answers per question.
                        </p>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>

              {/* Launch Settings */}
              <div className="lg:col-span-4 space-y-6">
                <div className="premium-card p-10 sticky top-32">
                   <div className="flex items-center gap-3 mb-8">
                     <Rocket className="w-8 h-8 text-brand-orange" />
                     <h2 className="text-2xl font-black uppercase tracking-widest">Launch Pad</h2>
                   </div>

                   <div className="space-y-8">
                     <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5">
                       <div className="flex items-start gap-3">
                         <div className={`w-12 h-12 rounded-2xl border-2 border-brand-dark flex items-center justify-center shrink-0 ${isPublic ? 'bg-emerald-100' : 'bg-white'}`}>
                           <Globe className="w-5 h-5 text-brand-dark" />
                         </div>
                         <div className="min-w-0 flex-1">
                           <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-2">Discover visibility</p>
                           <p className="font-black leading-tight">{isPublic ? 'This pack can appear in Discover' : 'This pack stays private by default'}</p>
                           <p className="text-sm font-medium text-brand-dark/62 mt-2">
                             Turn this on only if you want other teachers to be able to find it in Discover.
                           </p>
                         </div>
                       </div>
                       <button
                         type="button"
                         onClick={() => setIsPublic((current) => !current)}
                         className={`mt-4 w-full py-3 rounded-2xl border-2 border-brand-dark font-black shadow-[2px_2px_0px_0px_#1A1A1A] transition-colors ${isPublic ? 'bg-emerald-100 text-brand-dark' : 'bg-white text-brand-dark'}`}
                       >
                         {isPublic ? 'Visible in Discover' : 'Keep Private'}
                       </button>
                     </div>

                     <div>
                       <label className="text-xs font-black uppercase tracking-widest text-brand-dark/40 mb-3 block">Selected Format</label>
                       <div className="grid grid-cols-1 gap-3">
                         {GAME_MODES.slice(0, 4).map(mode => {
                           const isRecommended = recommendedLaunchModes.includes(mode.id);
                           const isActive = selectedLaunchMode === mode.id;
                           return (
                             <button
                               key={`mode-sel-${mode.id}`}
                               onClick={() => setSelectedLaunchMode(mode.id)}
                               className={`w-full text-left p-5 rounded-2xl border-4 transition-all relative overflow-hidden ${
                                 isActive 
                                   ? 'bg-brand-yellow border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A] scale-[1.02]' 
                                   : 'bg-brand-bg/50 border-brand-dark/5 hover:border-brand-dark/20'
                               }`}
                             >
                                <div className="flex items-center justify-between">
                                  <p className="font-black text-brand-dark">{mode.label}</p>
                                  {isRecommended && (
                                    <span className="bg-brand-purple text-white text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter shadow-[1px_1px_0px_0px_#1A1A1A]">
                                      Recommended
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs font-bold text-brand-dark/50 leading-tight mt-1">{mode.quickSummary}</p>
                                {isActive && (
                                  <div className="absolute -right-2 -bottom-2 opacity-10">
                                    <Sparkles className="w-12 h-12" />
                                  </div>
                                )}
                             </button>
                           );
                         })}
                       </div>
                     </div>

                     <SessionSoundtrackFields
                       lobbyTrackId={selectedLobbyTrackId}
                       gameplayTrackId={selectedGameplayTrackId}
                       onLobbyTrackChange={setSelectedLobbyTrackId}
                       onGameplayTrackChange={setSelectedGameplayTrackId}
                       compact
                     />

                     <button
                       onClick={handleSaveAndHost}
                       disabled={isSaving || isHosting || questions.length === 0}
                       className="w-full py-6 bg-brand-orange text-white rounded-[2rem] border-4 border-brand-dark font-black text-2xl shadow-[8px_8px_0px_0px_#1A1A1A] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all flex items-center justify-center gap-4 disabled:opacity-50"
                     >
                       <Play className="w-8 h-8 fill-white" />
                       FIRE AWAY
                     </button>

                     <button
                       onClick={handleSave}
                       disabled={isSaving || questions.length === 0}
                       className="w-full py-4 text-brand-dark font-black uppercase tracking-widest hover:underline disabled:opacity-30"
                     >
                       Save to Library only
                     </button>
                   </div>
                </div>

                <div className="premium-card p-8">
                  <div className="flex items-start gap-3 mb-6">
                    <div className="w-12 h-12 rounded-2xl border-2 border-brand-dark bg-brand-purple/15 flex items-center justify-center shadow-[3px_3px_0px_0px_#1A1A1A] shrink-0">
                      <Library className="w-5 h-5 text-brand-dark" />
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-1">Reuse Intelligence</p>
                      <h3 className="text-2xl font-black text-brand-dark leading-tight">Import strong questions from your library</h3>
                      <p className="text-sm font-medium text-brand-dark/62 mt-2">
                        Pull in proven questions fast, and flag the ones that probably need rewriting before reuse.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4 mb-5">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-2 block">
                      Search your question bank
                    </label>
                    <div className="flex items-center gap-3 rounded-2xl border-2 border-brand-dark bg-white px-4 py-3">
                      <Search className="w-4 h-4 text-brand-dark/55 shrink-0" />
                      <input
                        type="text"
                        value={questionBankQuery}
                        onChange={(event) => setQuestionBankQuery(event.target.value)}
                        placeholder="Search by topic, prompt, or concept..."
                        className="w-full bg-transparent border-none focus:outline-none font-bold text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-5">
                    <IntelPill label="Proven" value={questionBankSummary.proven} />
                    <IntelPill label="Needs revision" value={questionBankSummary.revise} />
                    <IntelPill label="Watchlist" value={questionBankSummary.watch} />
                    <IntelPill label="Fresh" value={questionBankSummary.fresh} />
                  </div>

                  <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
                    {isQuestionBankLoading ? (
                      <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-5 font-black text-brand-dark/65">
                        Scanning your library...
                      </div>
                    ) : questionBankItems.length === 0 ? (
                      <div className="rounded-[1.5rem] border-2 border-dashed border-brand-dark/30 bg-brand-bg/50 p-6 text-center">
                        <p className="font-black text-brand-dark mb-2">No library matches yet.</p>
                        <p className="text-sm font-medium text-brand-dark/55">
                          Try a topic keyword, course code, or a core concept from this pack.
                        </p>
                      </div>
                    ) : (
                      questionBankItems.map((item, itemIndex) => {
                        const signal = getQuestionReuseSignal(item);
                        return (
                          <div
                            key={`question-bank-${item.id || itemIndex}`}
                            className={`rounded-[1.5rem] border-2 p-4 ${signal.cardClassName}`}
                          >
                            <div className="flex items-start justify-between gap-3 mb-3">
                              <div className="min-w-0">
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-1">
                                  {item.pack_title || 'Library question'}
                                </p>
                                <p className="font-black text-brand-dark leading-snug line-clamp-3">
                                  {item.prompt || 'Untitled question'}
                                </p>
                              </div>
                              <span
                                className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${signal.badgeClassName}`}
                              >
                                {signal.label}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 mb-3">
                              <IntelPill label="Usage" value={Number(item?.usage_count || 0)} />
                              <IntelPill label="Accuracy" value={formatQuestionBankAccuracy(item?.accuracy)} />
                            </div>

                            <p className="text-sm font-medium text-brand-dark/70 leading-snug mb-4">
                              {signal.detail}
                            </p>

                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-xs font-black text-brand-dark/55 uppercase tracking-[0.18em] mb-1">
                                  Tags
                                </p>
                                <p className="text-sm font-bold text-brand-dark/70 truncate">
                                  {Array.isArray(item?.tags) && item.tags.length > 0 ? item.tags.join(', ') : 'general'}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => importQuestionFromBank(item)}
                                className="shrink-0 rounded-full border-2 border-brand-dark bg-white px-4 py-2 font-black shadow-[2px_2px_0px_0px_#1A1A1A] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
                              >
                                Import
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-brand-bg/98 backdrop-blur-md"
          >
            {/* Playful Floating Elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {[...Array(8)].map((_, i) => (
                <motion.div
                  key={i}
                  animate={{
                    y: [0, -30, 0],
                    rotate: [0, 360],
                    scale: [1, 1.2, 1],
                  }}
                  transition={{
                    duration: 4 + Math.random() * 4,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.5,
                  }}
                  className={`absolute opacity-20 text-6xl`}
                  style={{
                    top: `${Math.random() * 80 + 10}%`,
                    left: `${Math.random() * 80 + 10}%`,
                  }}
                >
                  {['✨', '🧬', '🧪', '👾', '🚀', '🧠', '🎈', '⭐'][i % 8]}
                </motion.div>
              ))}
              
              {/* Bold Geometric background shapes */}
              <div className="absolute top-[-10%] left-[-5%] w-96 h-96 bg-brand-yellow/10 rounded-full border-8 border-brand-dark/5" />
              <div className="absolute bottom-[-10%] right-[-5%] w-[400px] h-[400px] bg-brand-purple/10 rounded-full border-8 border-brand-dark/5" />
            </div>

            <div className="max-w-2xl w-full px-8 text-center relative z-10">
              <motion.div
                animate={{
                  scale: [1, 1.08, 1],
                  rotate: [-2, 2, -2],
                }}
                transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                className="w-48 h-48 bg-white rounded-[3.5rem] border-8 border-brand-dark flex items-center justify-center mx-auto mb-10 shadow-[20px_20px_0px_0px_#FF5A36] relative"
              >
                <div className="absolute inset-0 bg-brand-yellow/20 animate-pulse rounded-[3rem]" />
                <Sparkles className="w-24 h-24 text-brand-dark relative z-10 animate-bounce" />
                
                {/* Floating particles around central icon */}
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-[-20px] border-4 border-dashed border-brand-purple/40 rounded-full"
                />
              </motion.div>

              <div className="space-y-4 mb-10">
                <h3 className="text-6xl md:text-7xl font-black text-brand-dark tracking-tighter italic uppercase leading-none">
                  Brewing<br/>
                  <span className="text-brand-orange drop-shadow-[4px_4px_0px_#1A1A1A]">Magic...</span>
                </h3>
              </div>
              
              <div className="max-w-md mx-auto">
                <div className="w-full h-8 bg-white rounded-full border-4 border-brand-dark overflow-hidden mb-6 shadow-[6px_6px_0px_0px_#1A1A1A]">
                  <motion.div
                    className="h-full bg-brand-yellow border-r-4 border-brand-dark"
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 12, ease: "linear" }}
                  />
                </div>

                <div className="flex flex-col items-center gap-3">
                  <motion.p 
                    key={generationStep}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-brand-purple font-black text-2xl uppercase tracking-[0.2em] italic"
                  >
                    {generationStep}
                  </motion.p>
                  
                  <div className="flex items-center gap-4 bg-white px-6 py-3 rounded-2xl border-4 border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]">
                    <div className="w-3 h-3 bg-brand-orange rounded-full animate-ping" />
                    <span className="text-brand-dark font-black uppercase tracking-widest text-xs">Quizzi AI engine is active</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
