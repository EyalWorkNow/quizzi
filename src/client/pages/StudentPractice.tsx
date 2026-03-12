import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, ArrowRight, BrainCircuit, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiFetch, apiFetchJson } from '../lib/api.ts';

const COLORS = [
  { bg: 'bg-rose-500', shadow: 'shadow-[0_8px_0_0_#be123c]' },
  { bg: 'bg-blue-500', shadow: 'shadow-[0_8px_0_0_#1d4ed8]' },
  { bg: 'bg-amber-500', shadow: 'shadow-[0_8px_0_0_#b45309]' },
  { bg: 'bg-emerald-500', shadow: 'shadow-[0_8px_0_0_#047857]' }
];

export default function StudentPractice() {
  const { nickname } = useParams();
  const navigate = useNavigate();
  
  const [questions, setQuestions] = useState<any[]>([]);
  const [strategy, setStrategy] = useState<any>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [status, setStatus] = useState<'LOADING' | 'ACTIVE' | 'FEEDBACK' | 'DONE'>('LOADING');
  const [feedback, setFeedback] = useState<any>(null);
  const [startTime, setStartTime] = useState(0);

  useEffect(() => {
    apiFetchJson(`/api/practice/${nickname}`)
      .then(data => {
        setQuestions(data.questions || []);
        setStrategy(data.strategy || null);
        setStatus('ACTIVE');
        setStartTime(Date.now());
      });
  }, [nickname]);

  const handleAnswer = async (index: number) => {
    if (status !== 'ACTIVE') return;
    
    const responseMs = Date.now() - startTime;
    const question = questions[currentIndex];
    
    try {
      const data = await apiFetchJson(`/api/practice/${nickname}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: question.id,
          chosen_index: index,
          response_ms: responseMs
        })
      });
      setFeedback({ ...data, chosen_index: index });
      setStatus('FEEDBACK');
    } catch (err) {
      console.error(err);
    }
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setStatus('ACTIVE');
      setFeedback(null);
      setStartTime(Date.now());
    } else {
      setStatus('DONE');
    }
  };

  if (status === 'LOADING') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center text-slate-500">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
          <BrainCircuit className="w-16 h-16 text-indigo-300 mb-6" />
        </motion.div>
        <h2 className="text-2xl font-bold text-slate-700">Loading your personalized practice set...</h2>
      </div>
    );
  }

  if (status === 'DONE') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-700 flex flex-col items-center justify-center p-8 text-center text-white overflow-hidden relative">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute -top-32 -right-32 w-96 h-96 bg-white/10 rounded-full blur-3xl"
        />
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', bounce: 0.5 }}
          className="relative z-10 bg-white/10 p-12 rounded-[3rem] backdrop-blur-md border border-white/20 shadow-2xl max-w-lg w-full"
        >
          <div className="inline-flex items-center justify-center w-24 h-24 bg-white/20 rounded-3xl mb-8">
            <Sparkles className="w-12 h-12 text-yellow-300" />
          </div>
          <h2 className="text-5xl font-black mb-4 tracking-tight">Practice Complete!</h2>
          <p className="text-xl text-indigo-100 font-medium mb-12">Your mastery scores have been updated.</p>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate(`/student/dashboard/${nickname}`)}
            className="w-full bg-white text-indigo-600 px-8 py-5 rounded-2xl font-black text-2xl transition-all shadow-[0_8px_0_0_rgba(255,255,255,0.5)] hover:shadow-[0_4px_0_0_rgba(255,255,255,0.5)] hover:translate-y-1 active:shadow-none active:translate-y-2 flex items-center justify-center gap-3"
          >
            Back to Dashboard
            <ArrowRight className="w-6 h-6" />
          </motion.button>
        </motion.div>
      </div>
    );
  }

  const question = questions[currentIndex];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col p-4 md:p-8">
      <div className="max-w-4xl mx-auto w-full flex-1 flex flex-col">
        <div className="bg-white rounded-[2rem] p-6 shadow-sm mb-6 flex justify-between items-center border border-slate-200">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                if(window.confirm('Are you sure you want to end practice early?')) {
                  navigate(`/student/dashboard/${nickname}`);
                }
              }}
              className="p-2 hover:bg-rose-50 text-slate-400 hover:text-rose-500 rounded-full transition-colors"
              title="Exit Practice"
            >
              <XCircle className="w-6 h-6" />
            </button>
            <div className="flex items-center gap-3 text-indigo-600 font-black text-xl">
              <div className="p-2 bg-indigo-100 rounded-xl">
                <BrainCircuit className="w-6 h-6" />
              </div>
              Adaptive Practice
            </div>
          </div>
          <div className="text-slate-500 font-bold bg-slate-100 px-4 py-2 rounded-xl">
            Question {currentIndex + 1} of {questions.length}
          </div>
        </div>

        {strategy && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-[2rem] p-6 mb-6">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-500 mb-2">Practice Strategy</p>
            <h3 className="text-2xl font-black text-slate-900 mb-2">{strategy.headline}</h3>
            <p className="text-slate-600 font-medium">{strategy.body}</p>
          </div>
        )}

        <motion.div 
          key={`q-${currentIndex}`}
          initial={{ x: 50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="bg-white rounded-[3rem] p-10 shadow-sm mb-8 text-center flex-1 flex flex-col justify-center border border-slate-200 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-bl-full -z-10"></div>
          <h2 className="text-4xl md:text-5xl font-black text-slate-900 mb-6 leading-tight">{question?.prompt}</h2>
          {question?.tags_json && (
            <div className="flex justify-center gap-2 mt-4">
              {JSON.parse(question.tags_json).map((tag: string, i: number) => (
                <span key={i} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-sm font-bold capitalize border border-slate-200">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </motion.div>
        
        {status === 'ACTIVE' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {question?.answers?.map((ans: string, i: number) => (
              <motion.button
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: i * 0.1 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                key={i}
                onClick={() => handleAnswer(i)}
                className={`${COLORS[i % 4].bg} ${COLORS[i % 4].shadow} rounded-[2rem] flex items-center justify-center p-8 text-white text-3xl font-black hover:translate-y-1 hover:shadow-[0_4px_0_0_rgba(0,0,0,0.2)] active:translate-y-2 active:shadow-none transition-all min-h-[140px]`}
              >
                {ans}
              </motion.button>
            ))}
          </div>
        ) : (
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="bg-white rounded-[3rem] p-10 shadow-xl border border-slate-200"
          >
            <div className={`flex items-center gap-4 mb-8 ${feedback?.is_correct ? 'text-emerald-500' : 'text-rose-500'}`}>
              {feedback?.is_correct ? <CheckCircle className="w-12 h-12" /> : <XCircle className="w-12 h-12" />}
              <h3 className="text-4xl font-black tracking-tight">
                {feedback?.is_correct ? 'Correct!' : 'Not quite.'}
              </h3>
            </div>
            
            <div className="space-y-4 mb-10">
              {question?.answers?.map((ans: string, i: number) => {
                const isCorrect = i === feedback?.correct_index;
                const isChosen = i === feedback?.chosen_index;
                let borderClass = 'border-slate-200 bg-slate-50 text-slate-400';
                if (isCorrect) borderClass = 'border-emerald-500 bg-emerald-50 text-emerald-800 font-bold shadow-sm';
                else if (isChosen && !isCorrect) borderClass = 'border-rose-500 bg-rose-50 text-rose-800 font-bold';
                
                return (
                  <div key={i} className={`p-5 rounded-2xl border-2 flex items-center justify-between text-xl ${borderClass}`}>
                    <span>{ans}</span>
                    {isCorrect && <CheckCircle className="w-8 h-8 text-emerald-500" />}
                    {isChosen && !isCorrect && <XCircle className="w-8 h-8 text-rose-500" />}
                  </div>
                );
              })}
            </div>

            <div className="bg-indigo-50 rounded-[2rem] p-8 mb-10 border border-indigo-100 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-2 h-full bg-indigo-500"></div>
              <h4 className="font-black text-indigo-900 mb-3 flex items-center gap-2 text-xl">
                <Sparkles className="w-5 h-5 text-indigo-500" />
                Explanation
              </h4>
              <p className="text-indigo-800/80 text-lg font-medium leading-relaxed">{feedback?.explanation}</p>
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleNext}
              className="w-full bg-slate-900 text-white px-8 py-5 rounded-[2rem] font-black text-2xl hover:bg-slate-800 transition-all shadow-[0_8px_0_0_rgba(15,23,42,1)] hover:shadow-[0_4px_0_0_rgba(15,23,42,1)] hover:translate-y-1 active:shadow-none active:translate-y-2 flex items-center justify-center gap-3"
            >
              {currentIndex < questions.length - 1 ? 'Next Question' : 'Finish Practice'}
              <ArrowRight className="w-6 h-6" />
            </motion.button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
