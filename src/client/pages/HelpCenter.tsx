import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Compass,
  ChevronLeft,
  HelpCircle,
  LogOut,
  ChevronRight,
  Library,
  BarChart,
  Users,
  Settings,
  MessageCircle,
  FileText,
  Video,
  Rocket,
  BrainCircuit,
} from 'lucide-react';
import { motion } from 'motion/react';
import { loadContactSubmissions, loadTeacherSettings } from '../lib/localData.ts';
import { isTeacherAuthenticated, refreshTeacherSession } from '../lib/teacherAuth.ts';
import { apiFetchJson } from '../lib/api.ts';
import TeacherSidebar from '../components/TeacherSidebar.tsx';

const RESOURCES = [
  {
    id: 'start',
    title: 'Getting Started',
    category: 'Onboarding',
    description: 'Create your first pack, host a session and read the first results.',
    body: 'Start in Create Quiz, upload material, generate questions, save the pack and host it from the dashboard. After a live session ends, open Reports or the class analytics screen for behavioral breakdowns.',
    icon: Rocket,
    color: 'bg-brand-yellow',
  },
  {
    id: 'telemetry',
    title: 'Understanding Analytics',
    category: 'Reports',
    description: 'Interpret confidence, swaps, panic changes and focus warnings.',
    body: 'Stress is derived from hesitation, answer swaps, panic changes and focus loss. High confusion alerts usually indicate unclear wording or weak prior knowledge. Use the adaptive practice recommendations right after the session.',
    icon: BrainCircuit,
    color: 'bg-brand-purple',
  },
  {
    id: 'videos',
    title: 'Classroom Workflows',
    category: 'Tutorials',
    description: 'Recommended flows for starting fast with multiple classes.',
    body: 'Create one pack per unit, assign it to a class, and reuse the same class side panel to add students or jump back to the most recent relevant report. This keeps reporting tied to real activity without rebuilding class state every time.',
    icon: Video,
    color: 'bg-brand-orange',
  },
  {
    id: 'support',
    title: 'Support Channels',
    category: 'Support',
    description: 'Know when to use Help Center versus Contact Support.',
    body: 'Use the Help Center for self-serve setup, reports and product behavior. Use Contact Support for billing, deployments, integrations or anything that needs a human follow-up.',
    icon: MessageCircle,
    color: 'bg-brand-dark',
  },
];

const FAQS = [
  {
    id: 'share-quiz',
    question: 'How do I share a quiz with my students?',
    answer: 'Host the pack from the teacher dashboard. A session PIN is generated immediately and students join from the homepage.',
    category: 'Onboarding',
  },
  {
    id: 'reports',
    question: 'How do I interpret panic swaps?',
    answer: 'Panic swaps are answer changes near the end of the timer. A spike usually means distractors are too close or students were uncertain under time pressure.',
    category: 'Reports',
  },
  {
    id: 'classes',
    question: 'What is the fastest way to manage classes?',
    answer: 'Use the Classes page to keep a lightweight roster, assign a pack and jump directly into the latest matching analytics session.',
    category: 'Classroom',
  },
  {
    id: 'practice',
    question: 'How is adaptive practice chosen?',
    answer: 'The Python engine scores mastery by tag and prioritizes questions from the weakest areas with low recent success.',
    category: 'Reports',
  },
];

export default function HelpCenter() {
  const navigate = useNavigate();
  const [teacherSignedIn, setTeacherSignedIn] = useState(() => isTeacherAuthenticated());
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [openFaqId, setOpenFaqId] = useState<string | null>(FAQS[0].id);
  const [selectedResourceId, setSelectedResourceId] = useState<string>(RESOURCES[0].id);
  
  const teacherProfile = loadTeacherSettings().profile;
  const recentContacts = loadContactSubmissions().slice(0, 3);

  React.useEffect(() => {
    let cancelled = false;
    refreshTeacherSession()
      .then((session) => {
        if (!cancelled) setTeacherSignedIn(!!session);
      })
      .catch(() => {
        if (!cancelled) setTeacherSignedIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = ['All', ...Array.from(new Set([...RESOURCES.map((item) => item.category), ...FAQS.map((item) => item.category)]))];

  const filteredResources = useMemo(() => {
    return RESOURCES.filter((item) => {
      const matchesQuery =
        !query ||
        item.title.toLowerCase().includes(query.toLowerCase()) ||
        item.description.toLowerCase().includes(query.toLowerCase()) ||
        item.body.toLowerCase().includes(query.toLowerCase());
      const matchesCategory = activeCategory === 'All' || item.category === activeCategory;
      return matchesQuery && matchesCategory;
    });
  }, [query, activeCategory]);

  const filteredFaqs = useMemo(() => {
    return FAQS.filter((item) => {
      const matchesQuery =
        !query ||
        item.question.toLowerCase().includes(query.toLowerCase()) ||
        item.answer.toLowerCase().includes(query.toLowerCase());
      const matchesCategory = activeCategory === 'All' || item.category === activeCategory;
      return matchesQuery && matchesCategory;
    });
  }, [query, activeCategory]);

  const selectedResource = filteredResources.find((item) => item.id === selectedResourceId) || filteredResources[0] || RESOURCES[0];

  return (
    <div className={`min-h-screen bg-brand-bg text-brand-dark font-sans flex overflow-hidden selection:bg-brand-orange selection:text-white`}>
      {teacherSignedIn && <TeacherSidebar />}

      <div className="flex-1 h-screen overflow-y-auto relative">
        <div className="absolute inset-x-0 top-0 h-[430px] bg-[radial-gradient(circle_at_top_left,_rgba(255,90,54,0.16),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(180,136,255,0.18),_transparent_36%)] pointer-events-none" />

        {!teacherSignedIn && (
          <nav className="page-shell-wide relative z-20 flex flex-wrap items-center justify-between gap-4 py-5">
            <div className="text-3xl font-black tracking-tight flex items-center gap-1 cursor-pointer" onClick={() => navigate('/')}>
              <span className="text-brand-orange">Quiz</span>zi
            </div>
            <div className="hidden md:flex items-center gap-10 font-bold text-lg">
              <button onClick={() => navigate('/explore')} className="hover:text-brand-orange transition-colors">Explore</button>
              <button onClick={() => navigate('/auth')} className="hover:text-brand-orange transition-colors">For Teachers</button>
              <button onClick={() => navigate('/contact')} className="hover:text-brand-orange transition-colors">Contact Us</button>
            </div>
            <div className="action-row w-full md:w-auto md:justify-end">
              <button onClick={() => navigate('/')} className="font-bold px-8 py-3 rounded-full border-2 border-brand-dark hover:bg-brand-dark hover:text-white transition-colors">
                Home
              </button>
            </div>
          </nav>
        )}

      <main className={`flex-1 min-h-screen overflow-y-auto p-6 lg:p-8 relative bg-brand-bg ${teacherSignedIn ? '' : 'pt-20'}`}>
        <div className="max-w-[1200px] mx-auto relative z-10">
          <div className="text-center mb-10">
            <h1 className="text-4xl lg:text-5xl font-black tracking-tight mb-4">Teacher Help Center</h1>
            <p className="text-xl font-bold text-brand-dark/60 max-w-3xl mx-auto">Search product guides, reporting explanations and classroom workflows. Everything below is browsable and filterable.</p>
          </div>

          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 mb-8">
            <div className="relative mb-6">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-dark/40" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search for analytics, hosting, classes, support..."
                className="w-full bg-brand-bg border-2 border-brand-dark rounded-full py-4 pl-14 pr-6 text-lg font-black placeholder:text-brand-dark/40 focus:outline-none focus:ring-4 focus:ring-brand-orange/20"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black ${activeCategory === category ? 'bg-brand-dark text-white' : 'bg-white text-brand-dark'}`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-8">
            <section className="space-y-8">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <FileText className="w-6 h-6 text-brand-purple" />
                  <h2 className="text-3xl font-black">Guides</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {filteredResources.map((resource) => {
                    const Icon = resource.icon;
                    return (
                      <button
                        key={resource.id}
                        onClick={() => setSelectedResourceId(resource.id)}
                        className={`text-left bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 transition-transform hover:-translate-y-1 ${selectedResource?.id === resource.id ? 'ring-4 ring-brand-orange/20' : ''}`}
                      >
                        <div className={`w-16 h-16 ${resource.color} rounded-full border-4 border-brand-dark flex items-center justify-center mb-5 ${resource.color === 'bg-brand-dark' ? 'text-white' : resource.color === 'bg-brand-purple' || resource.color === 'bg-brand-orange' ? 'text-white' : 'text-brand-dark'}`}>
                          <Icon className="w-7 h-7" />
                        </div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-2">{resource.category}</p>
                        <h3 className="text-2xl font-black mb-2">{resource.title}</h3>
                        <p className="font-bold text-brand-dark/70">{resource.description}</p>
                      </button>
                    );
                  })}
                </div>
                {filteredResources.length === 0 && <EmptyState text="No guides matched this search." />}
              </div>

              <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-8">
                <h2 className="text-3xl font-black mb-6">Frequently Asked Questions</h2>
                <div className="space-y-4">
                  {filteredFaqs.map((faq) => (
                    <FAQItem
                      key={faq.id}
                      question={faq.question}
                      answer={faq.answer}
                      isOpen={openFaqId === faq.id}
                      onToggle={() => setOpenFaqId((current) => (current === faq.id ? null : faq.id))}
                    />
                  ))}
                  {filteredFaqs.length === 0 && <EmptyState text="No FAQ matched this search." compact />}
                </div>
              </div>
            </section>

            <aside className="space-y-8">
              <div className="bg-brand-dark text-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#FF5A36] p-8">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-white/50 mb-2">Selected Guide</p>
                <h2 className="text-3xl font-black mb-3">{selectedResource.title}</h2>
                <p className="font-bold text-white/70 mb-5">{selectedResource.description}</p>
                <p className="font-medium leading-relaxed text-white/80">{selectedResource.body}</p>
              </div>

              <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-8">
                <h2 className="text-2xl font-black mb-4">Recent Support Requests</h2>
                <div className="space-y-3">
                  {recentContacts.length > 0 ? recentContacts.map((submission) => (
                    <div key={submission.id} className="rounded-2xl border-2 border-brand-dark/10 bg-brand-bg p-4">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{submission.inquiryType}</p>
                      <p className="font-black">{submission.name} · {submission.organization}</p>
                      <p className="font-medium text-brand-dark/60 mt-1 line-clamp-2">{submission.message || submission.email}</p>
                    </div>
                  )) : (
                    <p className="font-bold text-brand-dark/50">No contact requests have been sent from this browser yet.</p>
                  )}
                </div>
                <button onClick={() => navigate('/contact')} className="mt-5 w-full px-6 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black">
                  Contact Support
                </button>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  </div>
);
}

function FAQItem({ question, answer, isOpen, onToggle }: any) {
  return (
    <div className="border-2 border-brand-dark rounded-2xl overflow-hidden text-left">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-6 bg-brand-bg hover:bg-brand-yellow/20 transition-colors text-left">
        <span className="text-xl font-black pr-8">{question}</span>
        <div className={`w-8 h-8 rounded-full border-2 border-brand-dark flex items-center justify-center flex-shrink-0 transition-transform ${isOpen ? 'rotate-90 bg-brand-yellow' : 'bg-white'}`}>
          <ChevronRight className="w-5 h-5" />
        </div>
      </button>
      {isOpen && (
        <div className="p-6 bg-white border-t-2 border-brand-dark">
          <p className="text-lg font-bold text-brand-dark/70 leading-relaxed">{answer}</p>
        </div>
      )}
    </div>
  );
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div className={`rounded-2xl border-2 border-dashed border-brand-dark/20 bg-white/50 ${compact ? 'p-4' : 'p-8'} text-center`}>
      <p className="font-bold text-brand-dark/50">{text}</p>
    </div>
  );
}
