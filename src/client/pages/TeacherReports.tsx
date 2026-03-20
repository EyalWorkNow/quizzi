import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpLeft,
  ArrowUpRight,
  BrainCircuit,
  RefreshCw,
} from 'lucide-react';
import TeacherSidebar from '../components/TeacherSidebar.tsx';
import { apiFetchJson } from '../lib/api.ts';
import { useTeacherLanguage } from '../lib/teacherLanguage.ts';

const REPORTS_COPY = {
  en: {
    title: 'Reports',
    subtitle: 'Deterministic summaries built from answers, timing, and behavior telemetry across your live sessions.',
    refresh: 'Refresh',
    loading: 'Loading live reports...',
    retry: 'Try Again',
    loadFailedTitle: 'Reports did not load cleanly.',
    loadFailedBody: 'We could not reach your report data right now. Try again in a moment.',
    insightLabel: 'Engine Insight',
    sessionsTitle: 'Recent Sessions',
    sessionsSubtitle: 'Each row is derived from stored answers, timings, and focus events.',
    noSessions: 'No completed sessions yet.',
    view: 'View',
    stats: {
      players: { title: 'Total Players', caption: 'Across hosted sessions' },
      accuracy: { title: 'Avg Accuracy', caption: 'Across tracked answers' },
      quizzes: { title: 'Quizzes Hosted', caption: 'Sessions with activity' },
      stress: { title: 'Avg Stress', caption: 'Behavior pressure index' },
    },
    table: {
      quizName: 'Quiz Name',
      date: 'Date',
      players: 'Players',
      accuracy: 'Accuracy',
      stress: 'Stress',
      action: 'Action',
    },
  },
  he: {
    title: 'דוחות',
    subtitle: 'סיכומים דטרמיניסטיים המבוססים על תשובות, תזמון וטלמטריית התנהגות מכל הסשנים החיים שלך.',
    refresh: 'רענון',
    loading: 'טוען דוחות חיים...',
    retry: 'נסה שוב',
    loadFailedTitle: 'הדוחות לא נטענו כראוי.',
    loadFailedBody: 'לא הצלחנו להגיע לנתוני הדוחות כרגע. נסה שוב בעוד רגע.',
    insightLabel: 'תובנת מנוע',
    sessionsTitle: 'סשנים אחרונים',
    sessionsSubtitle: 'כל שורה נגזרת מתשובות שמורות, זמני תגובה ואירועי פוקוס.',
    noSessions: 'עדיין אין סשנים שהושלמו.',
    view: 'לצפייה',
    stats: {
      players: { title: 'סך שחקנים', caption: 'בכלל הסשנים שהורצו' },
      accuracy: { title: 'דיוק ממוצע', caption: 'על פני כל התשובות שנמדדו' },
      quizzes: { title: 'חידונים שהורצו', caption: 'סשנים עם פעילות' },
      stress: { title: 'לחץ ממוצע', caption: 'מדד עומס התנהגותי' },
    },
    table: {
      quizName: 'שם החידון',
      date: 'תאריך',
      players: 'שחקנים',
      accuracy: 'דיוק',
      stress: 'לחץ',
      action: 'פעולה',
    },
  },
} as const;

export default function TeacherReports() {
  const navigate = useNavigate();
  const { language, direction } = useTeacherLanguage();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const copy = REPORTS_COPY[language];
  const isRtl = direction === 'rtl';

  const loadReport = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const payload = await apiFetchJson('/api/dashboard/teacher/overview');
      setReport(payload);
    } catch (loadError: any) {
      console.error('Failed to load teacher overview:', loadError);
      setError(loadError?.message || copy.loadFailedBody);
    } finally {
      setLoading(false);
    }
  }, [copy.loadFailedBody]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const stats = useMemo(
    () => [
      {
        id: 'players',
        title: copy.stats.players.title,
        value: report?.summary?.total_players || 0,
        caption: copy.stats.players.caption,
        color: 'bg-brand-yellow',
      },
      {
        id: 'accuracy',
        title: copy.stats.accuracy.title,
        value: `${(report?.summary?.avg_accuracy || 0).toFixed(1)}%`,
        caption: copy.stats.accuracy.caption,
        color: 'bg-brand-orange',
      },
      {
        id: 'quizzes',
        title: copy.stats.quizzes.title,
        value: report?.summary?.quizzes_hosted || 0,
        caption: copy.stats.quizzes.caption,
        color: 'bg-brand-purple',
        textColor: 'text-white',
      },
      {
        id: 'stress',
        title: copy.stats.stress.title,
        value: `${(report?.summary?.avg_stress || 0).toFixed(0)}%`,
        caption: copy.stats.stress.caption,
        color: 'bg-brand-dark',
        textColor: 'text-white',
      },
    ],
    [copy, report],
  );

  return (
    <div
      dir={direction}
      data-no-translate="true"
      className="min-h-screen bg-brand-bg text-brand-dark font-sans flex overflow-hidden selection:bg-brand-orange selection:text-white"
    >
      <TeacherSidebar />

      <main className="flex-1 h-screen overflow-y-auto p-6 lg:p-8 relative bg-brand-bg">
        <div className="max-w-[1200px] mx-auto relative z-10">
          <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 ${isRtl ? 'md:flex-row-reverse' : ''}`}>
            <div className={isRtl ? 'text-right' : ''}>
              <h1 className="text-3xl lg:text-4xl font-black tracking-tight">{copy.title}</h1>
              <p className="text-brand-dark/60 font-bold mt-2 max-w-3xl">{copy.subtitle}</p>
            </div>
            <button
              onClick={loadReport}
              className={`px-6 py-3 bg-brand-purple text-white border-2 border-brand-dark rounded-full flex items-center gap-2 hover:bg-purple-500 transition-colors font-black text-base shadow-[2px_2px_0px_0px_#1A1A1A] w-fit ${isRtl ? 'self-end md:self-auto flex-row-reverse' : ''}`}
            >
              <RefreshCw className="w-5 h-5" />
              {copy.refresh}
            </button>
          </div>

          {loading ? (
            <div className={`bg-white border-2 border-brand-dark rounded-[2rem] p-12 shadow-[4px_4px_0px_0px_#1A1A1A] text-center ${isRtl ? 'text-right' : ''}`}>
              <p className="text-2xl font-black">{copy.loading}</p>
            </div>
          ) : error ? (
            <div className={`bg-white border-2 border-brand-dark rounded-[2rem] p-8 shadow-[4px_4px_0px_0px_#1A1A1A] ${isRtl ? 'text-right' : ''}`}>
              <h2 className="text-2xl font-black mb-2">{copy.loadFailedTitle}</h2>
              <p className="font-bold text-brand-dark/60 mb-5">{error}</p>
              <button
                onClick={() => void loadReport()}
                className={`px-6 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full inline-flex items-center gap-2 font-black shadow-[2px_2px_0px_0px_#1A1A1A] ${isRtl ? 'flex-row-reverse' : ''}`}
              >
                <RefreshCw className="w-5 h-5" />
                {copy.retry}
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
                {stats.map((stat) => (
                  <StatCard
                    key={stat.id}
                    title={stat.title}
                    value={stat.value}
                    caption={stat.caption}
                    color={stat.color}
                    textColor={stat.textColor}
                    align={direction}
                  />
                ))}
              </div>

              {report.insights?.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                  {report.insights.map((insight: any, index: number) => (
                    <div key={index} className="bg-white border-2 border-brand-dark rounded-[2rem] shadow-[4px_4px_0px_0px_#1A1A1A] p-6">
                      <div className={`flex items-start gap-4 ${isRtl ? 'flex-row-reverse text-right' : ''}`}>
                        <div className="w-12 h-12 rounded-2xl bg-brand-purple text-white border-2 border-brand-dark flex items-center justify-center shrink-0">
                          <BrainCircuit className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{copy.insightLabel}</p>
                          <h2 className="text-2xl font-black mb-2">{insight.title}</h2>
                          <p className="text-brand-dark/70 font-medium leading-relaxed">{insight.body}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-white border-2 border-brand-dark rounded-[2rem] shadow-[4px_4px_0px_0px_#1A1A1A] overflow-hidden">
                <div className={`p-6 border-b-2 border-brand-dark bg-slate-50 ${isRtl ? 'text-right' : ''}`}>
                  <h2 className="text-2xl font-black">{copy.sessionsTitle}</h2>
                  <p className="text-sm font-bold text-brand-dark/60 mt-1">{copy.sessionsSubtitle}</p>
                </div>

                <div className="overflow-x-auto">
                  <table className={`w-full border-collapse ${isRtl ? 'text-right' : 'text-left'}`}>
                    <thead>
                      <tr className="border-b-2 border-brand-dark bg-white">
                        <th className="p-4 font-black text-sm uppercase tracking-wider">{copy.table.quizName}</th>
                        <th className="p-4 font-black text-sm uppercase tracking-wider">{copy.table.date}</th>
                        <th className="p-4 font-black text-sm uppercase tracking-wider">{copy.table.players}</th>
                        <th className="p-4 font-black text-sm uppercase tracking-wider">{copy.table.accuracy}</th>
                        <th className="p-4 font-black text-sm uppercase tracking-wider">{copy.table.stress}</th>
                        <th className="p-4 font-black text-sm uppercase tracking-wider">{copy.table.action}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.recent_sessions?.length > 0 ? (
                        report.recent_sessions.map((row: any) => (
                          <tr key={row.session_id} className="border-b-2 border-brand-dark/10 hover:bg-slate-50 transition-colors">
                            <td className="p-4">
                              <p className="font-bold">{row.quiz_name}</p>
                              <p className="text-xs font-bold text-brand-dark/50 mt-1">{row.headline}</p>
                            </td>
                            <td className="p-4 text-brand-dark/70 font-medium">{row.date}</td>
                            <td className="p-4 font-bold">{row.players}</td>
                            <td className="p-4">
                              <span
                                className={`px-3 py-1 rounded-full text-xs font-black border-2 ${
                                  (row.avg_accuracy || 0) > 80
                                    ? 'bg-emerald-100 border-emerald-500 text-emerald-700'
                                    : (row.avg_accuracy || 0) > 60
                                      ? 'bg-brand-yellow/30 border-brand-yellow text-brand-dark'
                                      : 'bg-brand-orange/20 border-brand-orange text-brand-dark'
                                }`}
                              >
                                {(row.avg_accuracy || 0).toFixed(1)}%
                              </span>
                            </td>
                            <td className="p-4 font-bold">{(row.stress_index || 0).toFixed(0)}%</td>
                            <td className="p-4">
                              <button
                                onClick={() => navigate(`/teacher/analytics/class/${row.session_id}`)}
                                className={`text-brand-purple hover:text-purple-700 font-black text-sm inline-flex items-center gap-1 ${isRtl ? 'flex-row-reverse' : ''}`}
                              >
                                {copy.view}
                                {isRtl ? <ArrowUpLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="p-10 text-center text-brand-dark/50 font-bold">
                            {copy.noSessions}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function StatCard({
  title,
  value,
  caption,
  color,
  textColor = 'text-brand-dark',
  align,
}: {
  key?: React.Key;
  title: string;
  value: string | number;
  caption: string;
  color: string;
  textColor?: string;
  align: 'ltr' | 'rtl';
}) {
  return (
    <div className={`${color} ${textColor} border-2 border-brand-dark rounded-[2rem] p-6 shadow-[4px_4px_0px_0px_#1A1A1A] ${align === 'rtl' ? 'text-right' : ''}`}>
      <p className="text-sm font-bold uppercase tracking-wider opacity-80 mb-2">{title}</p>
      <p className="text-4xl font-black mb-2">{value}</p>
      <span className="inline-block bg-white/20 px-2 py-1 rounded-lg text-sm font-black border border-current/20">
        {caption}
      </span>
    </div>
  );
}
