import React from 'react';
import { useAppLanguage } from '../lib/appLanguage.tsx';

const STUDENT_CHART_COPY = {
  en: {
    empty: {
      perQuestion: 'No per-question chart data is available yet.',
      sessionHistory: 'No session history is available yet.',
      revisionCategory: 'No revision-category chart is available for this run.',
      questionStatus: 'No question status data is available yet.',
      mastery: 'No mastery chart is available yet.',
    },
    legend: {
      stress: 'Stress',
      volatility: 'Volatility',
      response: 'Response',
      accuracy: 'Accuracy',
      score: 'Score',
    },
    stats: {
      highestStress: 'Highest stress',
      mostVolatile: 'Most volatile',
      slowestResponse: 'Slowest response',
      stressSuffix: 'stress',
      volatilitySuffix: 'volatility',
      ofQuestions: 'of questions',
      questions: 'questions',
      firstChoice: 'First choice',
      commit: 'commit',
    },
    labels: {
      stable: 'Stable',
      shaky: 'Shaky',
      missed: 'Missed',
      questionPrefix: 'Q',
      sessionPrefix: 'S',
    },
  },
  he: {
    empty: {
      perQuestion: 'עדיין אין נתוני גרף לפי שאלה.',
      sessionHistory: 'עדיין אין היסטוריית סשנים.',
      revisionCategory: 'אין עדיין גרף קטגוריות תיקון לסשן הזה.',
      questionStatus: 'עדיין אין נתוני סטטוס לשאלות.',
      mastery: 'עדיין אין גרף שליטה זמין.',
    },
    legend: {
      stress: 'לחץ',
      volatility: 'תנודתיות',
      response: 'זמן תגובה',
      accuracy: 'דיוק',
      score: 'ציון',
    },
    stats: {
      highestStress: 'הלחץ הגבוה ביותר',
      mostVolatile: 'התנודתיות הגבוהה ביותר',
      slowestResponse: 'התגובה האיטית ביותר',
      stressSuffix: 'לחץ',
      volatilitySuffix: 'תנודתיות',
      ofQuestions: 'מהשאלות',
      questions: 'שאלות',
      firstChoice: 'בחירה ראשונה',
      commit: 'נעילה',
    },
    labels: {
      stable: 'יציב',
      shaky: 'מהוסס',
      missed: 'שגוי',
      questionPrefix: 'ש',
      sessionPrefix: 'ס',
    },
  },
} as const;

function formatMs(value: number) {
  if (!Number.isFinite(value)) return '0ms';
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function statusTone(status?: string, isCorrect?: boolean) {
  if (status === 'missed' || isCorrect === false) return '#FF5A36';
  if (status === 'shaky') return '#F6CD3B';
  return '#8B5CF6';
}

export function QuestionFlowChart({
  rows,
  responseKey = 'response_ms',
  volatilityKey = 'decision_volatility',
}: {
  rows: any[];
  responseKey?: string;
  volatilityKey?: string;
}) {
  const { language, direction } = useAppLanguage();
  const copy = STUDENT_CHART_COPY[language as keyof typeof STUDENT_CHART_COPY] || STUDENT_CHART_COPY.en;
  if (!rows.length) {
    return <p className="font-bold text-brand-dark/60">{copy.empty.perQuestion}</p>;
  }

  const width = 760;
  const height = 232;
  const padding = 28;
  const graphHeight = height - padding * 2 - 14;
  const step = rows.length === 1 ? 0 : (width - padding * 2) / (rows.length - 1);
  const maxResponse = Math.max(...rows.map((row) => Number(row?.[responseKey] || 0)), 1);

  const stressPoints = rows
    .map((row, index) => {
      const x = padding + step * index;
      const y = padding + ((100 - clampPercent(Number(row.stress_index || 0))) / 100) * graphHeight;
      return `${x},${y}`;
    })
    .join(' ');

  const volatilityPoints = rows
    .map((row, index) => {
      const x = padding + step * index;
      const y = padding + ((100 - clampPercent(Number(row?.[volatilityKey] || 0))) / 100) * graphHeight;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div dir={direction}>
      <div className="flex flex-wrap gap-3 mb-4">
        <LegendSwatch label={copy.legend.stress} color="bg-brand-orange" />
        <LegendSwatch label={copy.legend.volatility} color="bg-brand-purple" />
        <LegendSwatch label={copy.legend.response} color="bg-brand-yellow" />
      </div>
      <div className="chart-scroll-shell">
        <svg dir="ltr" viewBox={`0 0 ${width} ${height}`} className="h-[190px] min-w-[340px] w-full sm:h-[220px] sm:min-w-0">
          {[0, 25, 50, 75, 100].map((tick) => {
            const y = padding + ((100 - tick) / 100) * graphHeight;
            return (
              <g key={`tick-${tick}`}>
                <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#1A1A1A" strokeOpacity="0.12" strokeWidth="1" />
                <text x={6} y={y + 4} fontSize="11" fontWeight="800" fill="#1A1A1A">
                  {tick}
                </text>
              </g>
            );
          })}

          {rows.map((row, index) => {
            const x = padding + step * index;
            const barHeight = (Number(row?.[responseKey] || 0) / maxResponse) * (graphHeight * 0.5);
            const y = height - padding - barHeight;
            return (
              <g key={`bar-${row.question_index || index}`}>
                <rect
                  x={x - 11}
                  y={y}
                  width="22"
                  height={Math.max(8, barHeight)}
                  rx="10"
                  fill={statusTone(row.status, row.is_correct)}
                  fillOpacity="0.82"
                  stroke="#1A1A1A"
                  strokeWidth="2"
                />
                <text x={x} y={height - 4} textAnchor="middle" fontSize="10" fontWeight="900" fill="#1A1A1A">
                  {copy.labels.questionPrefix}{row.question_index || index + 1}
                </text>
              </g>
            );
          })}

          <polyline fill="none" stroke="#FF5A36" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" points={stressPoints} />
          <polyline fill="none" stroke="#8B5CF6" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" points={volatilityPoints} />

          {rows.map((row, index) => {
            const x = padding + step * index;
            const stressY = padding + ((100 - clampPercent(Number(row.stress_index || 0))) / 100) * graphHeight;
            const volatilityY = padding + ((100 - clampPercent(Number(row?.[volatilityKey] || 0))) / 100) * graphHeight;
            return (
              <g key={`dots-${row.question_index || index}`}>
                <circle cx={x} cy={stressY} r="4.5" fill="#FF5A36" stroke="#1A1A1A" strokeWidth="2" />
                <circle cx={x} cy={volatilityY} r="4.5" fill="#8B5CF6" stroke="#1A1A1A" strokeWidth="2" />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="grid grid-cols-1 gap-3 mt-4 sm:grid-cols-2 xl:grid-cols-3">
        <ChartStat
          label={copy.stats.highestStress}
          value={`${copy.labels.questionPrefix}${rows.reduce((best, row) => (Number(row.stress_index || 0) > Number(best.stress_index || 0) ? row : best), rows[0]).question_index}`}
          body={`${Number(rows.reduce((best, row) => (Number(row.stress_index || 0) > Number(best.stress_index || 0) ? row : best), rows[0]).stress_index || 0).toFixed(0)}% ${copy.stats.stressSuffix}`}
        />
        <ChartStat
          label={copy.stats.mostVolatile}
          value={`${copy.labels.questionPrefix}${rows.reduce((best, row) => (Number(row?.[volatilityKey] || 0) > Number(best?.[volatilityKey] || 0) ? row : best), rows[0]).question_index}`}
          body={`${Number(rows.reduce((best, row) => (Number(row?.[volatilityKey] || 0) > Number(best?.[volatilityKey] || 0) ? row : best), rows[0])?.[volatilityKey] || 0).toFixed(0)}% ${copy.stats.volatilitySuffix}`}
        />
        <ChartStat
          label={copy.stats.slowestResponse}
          value={`${copy.labels.questionPrefix}${rows.reduce((best, row) => (Number(row?.[responseKey] || 0) > Number(best?.[responseKey] || 0) ? row : best), rows[0]).question_index}`}
          body={formatMs(Number(rows.reduce((best, row) => (Number(row?.[responseKey] || 0) > Number(best?.[responseKey] || 0) ? row : best), rows[0])?.[responseKey] || 0))}
        />
      </div>
    </div>
  );
}

export function SessionHistoryTrendChart({ rows }: { rows: any[] }) {
  const { language, direction } = useAppLanguage();
  const copy = STUDENT_CHART_COPY[language as keyof typeof STUDENT_CHART_COPY] || STUDENT_CHART_COPY.en;
  if (!rows.length) {
    return <p className="font-bold text-brand-dark/60">{copy.empty.sessionHistory}</p>;
  }

  const width = 760;
  const height = 238;
  const padding = 28;
  const graphHeight = height - padding * 2 - 14;
  const step = rows.length === 1 ? 0 : (width - padding * 2) / (rows.length - 1);
  const maxScore = Math.max(...rows.map((row) => Number(row.score || 0)), 1);

  const accuracyPoints = rows
    .map((row, index) => `${padding + step * index},${padding + ((100 - clampPercent(Number(row.accuracy || 0))) / 100) * graphHeight}`)
    .join(' ');
  const stressPoints = rows
    .map((row, index) => `${padding + step * index},${padding + ((100 - clampPercent(Number(row.avg_stress || 0))) / 100) * graphHeight}`)
    .join(' ');

  return (
    <div dir={direction}>
      <div className="flex flex-wrap gap-3 mb-4">
        <LegendSwatch label={copy.legend.accuracy} color="bg-brand-purple" />
        <LegendSwatch label={copy.legend.stress} color="bg-brand-orange" />
        <LegendSwatch label={copy.legend.score} color="bg-brand-yellow" />
      </div>
      <div className="chart-scroll-shell">
        <svg dir="ltr" viewBox={`0 0 ${width} ${height}`} className="h-[190px] min-w-[340px] w-full sm:h-[224px] sm:min-w-0">
          {[0, 25, 50, 75, 100].map((tick) => {
            const y = padding + ((100 - tick) / 100) * graphHeight;
            return (
              <g key={`timeline-${tick}`}>
                <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#1A1A1A" strokeOpacity="0.12" strokeWidth="1" />
                <text x={6} y={y + 4} fontSize="11" fontWeight="800" fill="#1A1A1A">
                  {tick}
                </text>
              </g>
            );
          })}

          {rows.map((row, index) => {
            const x = padding + step * index;
            const barHeight = (Number(row.score || 0) / maxScore) * (graphHeight * 0.42);
            const y = height - padding - barHeight;
            return (
              <g key={`session-score-${row.session_id || index}`}>
                <rect x={x - 12} y={y} width="24" height={Math.max(10, barHeight)} rx="10" fill="#F6CD3B" stroke="#1A1A1A" strokeWidth="2" />
                <text x={x} y={height - 4} textAnchor="middle" fontSize="10" fontWeight="900" fill="#1A1A1A">
                  {copy.labels.sessionPrefix}{index + 1}
                </text>
              </g>
            );
          })}

          <polyline fill="none" stroke="#8B5CF6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" points={accuracyPoints} />
          <polyline fill="none" stroke="#FF5A36" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" points={stressPoints} />

          {rows.map((row, index) => {
            const x = padding + step * index;
            const accuracyY = padding + ((100 - clampPercent(Number(row.accuracy || 0))) / 100) * graphHeight;
            const stressY = padding + ((100 - clampPercent(Number(row.avg_stress || 0))) / 100) * graphHeight;
            return (
              <g key={`session-dots-${row.session_id || index}`}>
                <circle cx={x} cy={accuracyY} r="4.5" fill="#8B5CF6" stroke="#1A1A1A" strokeWidth="2" />
                <circle cx={x} cy={stressY} r="4.5" fill="#FF5A36" stroke="#1A1A1A" strokeWidth="2" />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export function RevisionCategoryChart({ categories }: { categories: any[] }) {
  const { language, direction } = useAppLanguage();
  const copy = STUDENT_CHART_COPY[language as keyof typeof STUDENT_CHART_COPY] || STUDENT_CHART_COPY.en;
  const rows = Array.isArray(categories) ? categories.filter((row) => Number(row.count || 0) > 0) : [];
  if (!rows.length) {
    return <p className="font-bold text-brand-dark/60">{copy.empty.revisionCategory}</p>;
  }

  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);

  return (
    <div dir={direction}>
      <div className={`h-6 rounded-full border-2 border-brand-dark overflow-hidden flex mb-4 ${direction === 'rtl' ? 'flex-row-reverse' : ''}`}>
        {rows.map((row) => (
          <div
            key={`revision-stack-${row.id}`}
            className={`h-full ${row.id === 'incorrect_to_correct' || row.id === 'correct_verified' ? 'bg-emerald-400' : row.id === 'correct_to_incorrect' ? 'bg-brand-orange' : 'bg-brand-yellow'}`}
            style={{ width: `${(Number(row.count || 0) / Math.max(1, total)) * 100}%` }}
            title={`${row.label}: ${row.count}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-[1.35rem] border-2 border-brand-dark bg-brand-bg p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="font-black leading-tight">{row.label}</p>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45 mt-1">{row.count} {copy.stats.questions}</p>
              </div>
              <span className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark font-black shrink-0">
                {Number(row.rate || 0).toFixed(1)}%
              </span>
            </div>
            <div className="h-3 rounded-full border-2 border-brand-dark bg-white overflow-hidden">
              <div
                className={`h-full ${row.id === 'incorrect_to_correct' || row.id === 'correct_verified' ? 'bg-emerald-400' : row.id === 'correct_to_incorrect' ? 'bg-brand-orange' : 'bg-brand-yellow'}`}
                style={{ width: `${clampPercent(Number(row.rate || 0))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function QuestionStatusStripChart({ rows }: { rows: any[] }) {
  const { language, direction } = useAppLanguage();
  const copy = STUDENT_CHART_COPY[language as keyof typeof STUDENT_CHART_COPY] || STUDENT_CHART_COPY.en;
  const counts = rows.reduce(
    (acc, row) => {
      const key = row.status === 'missed' ? 'missed' : row.status === 'shaky' ? 'shaky' : 'stable';
      acc[key] += 1;
      return acc;
    },
    { stable: 0, shaky: 0, missed: 0 },
  );
  const total = counts.stable + counts.shaky + counts.missed;

  if (!total) {
    return <p className="font-bold text-brand-dark/60">{copy.empty.questionStatus}</p>;
  }

  const cards = [
    { id: 'stable', label: copy.labels.stable, count: counts.stable, tone: 'bg-emerald-300' },
    { id: 'shaky', label: copy.labels.shaky, count: counts.shaky, tone: 'bg-brand-yellow' },
    { id: 'missed', label: copy.labels.missed, count: counts.missed, tone: 'bg-brand-orange' },
  ];

  return (
    <div dir={direction}>
      <div className={`h-6 rounded-full border-2 border-brand-dark overflow-hidden flex mb-4 ${direction === 'rtl' ? 'flex-row-reverse' : ''}`}>
        {cards.map((card) => (
          <div
            key={`status-${card.id}`}
            className={`${card.tone} h-full`}
            style={{ width: `${(card.count / total) * 100}%` }}
            title={`${card.label}: ${card.count}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <React.Fragment key={card.id}>
            <ChartStat
              label={card.label}
              value={`${card.count}`}
              body={`${((card.count / total) * 100).toFixed(0)}% ${copy.stats.ofQuestions}`}
              tone={card.tone}
            />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export function MasteryBarChart({
  rows,
  limit = 8,
}: {
  rows: any[];
  limit?: number;
}) {
  const { language, direction } = useAppLanguage();
  const copy = STUDENT_CHART_COPY[language as keyof typeof STUDENT_CHART_COPY] || STUDENT_CHART_COPY.en;
  const items = [...(Array.isArray(rows) ? rows : [])]
    .sort((left, right) => Number(right.score || right.accuracy || 0) - Number(left.score || left.accuracy || 0))
    .slice(0, limit);

  if (!items.length) {
    return <p className="font-bold text-brand-dark/60">{copy.empty.mastery}</p>;
  }

  return (
    <div dir={direction} className="space-y-3">
      {items.map((item) => {
        const value = Number(item.score ?? item.accuracy ?? 0);
        return (
          <div key={item.tag || item.label} className="rounded-[1.25rem] border-2 border-brand-dark bg-brand-bg p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="font-black">{item.tag || item.label}</p>
              <span className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark font-black">
                {value.toFixed(0)}%
              </span>
            </div>
            <div className="h-3 rounded-full border-2 border-brand-dark bg-white overflow-hidden">
              <div
                className={value >= 80 ? 'h-full bg-emerald-400' : value >= 55 ? 'h-full bg-brand-yellow' : 'h-full bg-brand-orange'}
                style={{ width: `${clampPercent(value)}%` }}
              />
            </div>
            {'first_choice_accuracy' in item || 'avg_commitment_latency_ms' in item ? (
              <p className="font-medium text-sm text-brand-dark/66 mt-3">
                {copy.stats.firstChoice} {Number(item.first_choice_accuracy || 0).toFixed(0)}% · {copy.stats.commit} {formatMs(Number(item.avg_commitment_latency_ms || 0))}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function LegendSwatch({ label, color }: { label: string; color: string }) {
  const { direction } = useAppLanguage();
  return (
    <div className={`flex items-center gap-2 ${direction === 'rtl' ? 'flex-row-reverse' : ''}`}>
      <div className={`w-4 h-4 rounded-full border-2 border-brand-dark ${color}`} />
      <span className="text-sm font-black">{label}</span>
    </div>
  );
}

function ChartStat({
  label,
  value,
  body,
  tone = 'bg-white',
}: {
  label: string;
  value: string;
  body: string;
  tone?: string;
}) {
  const { direction } = useAppLanguage();
  return (
    <div className={`${tone} min-w-0 rounded-[1.2rem] border-2 border-brand-dark p-4 ${direction === 'rtl' ? 'text-right' : 'text-left'}`}>
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45 mb-2">{label}</p>
      <p className="text-xl font-black leading-none sm:text-2xl break-words">{value}</p>
      <p className="font-medium text-sm text-brand-dark/68 mt-2">{body}</p>
    </div>
  );
}
