import React, { type InputHTMLAttributes } from 'react';
import { Search, XCircle } from 'lucide-react';

type UiverseSearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  label?: string;
  shellClassName?: string;
  accent?: 'orange' | 'purple';
  dir?: 'rtl' | 'ltr';
  onClear?: () => void;
};

export default function UiverseSearchField({
  value,
  onChange,
  label,
  id,
  placeholder,
  shellClassName = '',
  accent = 'orange',
  dir = 'ltr',
  onClear,
  ...inputProps
}: UiverseSearchFieldProps) {
  const isRtl = dir === 'rtl';

  return (
    <div className={`w-full ${shellClassName}`}>
      <style>{`
        .quizzi-search-shell {
          position: relative;
          border-radius: 999px;
          transition: transform 220ms ease, box-shadow 220ms ease;
        }

        .quizzi-search-shell::before {
          content: "";
          position: absolute;
          inset: -2px;
          border-radius: inherit;
          background: linear-gradient(135deg, rgba(255, 90, 54, 0.28), rgba(180, 136, 255, 0.24));
          opacity: 0.88;
          z-index: 0;
          transition: opacity 220ms ease, transform 220ms ease;
        }

        .quizzi-search-shell[data-accent="purple"]::before {
          background: linear-gradient(135deg, rgba(180, 136, 255, 0.34), rgba(255, 209, 59, 0.22));
        }

        .quizzi-search-shell:hover,
        .quizzi-search-shell:focus-within {
          transform: translateY(-1px);
        }

        .quizzi-search-shell:hover::before,
        .quizzi-search-shell:focus-within::before {
          opacity: 1;
          transform: scale(1.005);
        }

        .quizzi-search-shell__surface {
          position: relative;
          z-index: 1;
          min-height: 58px;
          border: 2px solid #1a1a1a;
          border-radius: inherit;
          background:
            radial-gradient(circle at top left, rgba(255, 255, 255, 0.96), rgba(255, 248, 236, 0.92) 54%, rgba(255, 255, 255, 0.96)),
            #fff;
          box-shadow:
            0 12px 24px rgba(26, 26, 26, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);
          transition: box-shadow 220ms ease, background 220ms ease;
        }

        .quizzi-search-shell:focus-within .quizzi-search-shell__surface {
          box-shadow:
            0 18px 30px rgba(180, 136, 255, 0.16),
            inset 0 1px 0 rgba(255, 255, 255, 0.95);
        }

        .quizzi-search-shell input::placeholder {
          color: rgba(26, 26, 26, 0.38);
        }

        .quizzi-search-shell__spark {
          animation: quizziSearchPulse 2.1s ease-in-out infinite;
        }

        @keyframes quizziSearchPulse {
          0%,
          100% {
            transform: scale(0.92);
            opacity: 0.5;
          }

          50% {
            transform: scale(1.08);
            opacity: 1;
          }
        }
      `}</style>

      {label ? (
        <label htmlFor={id} className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/50">
          {label}
        </label>
      ) : null}

      <div className="quizzi-search-shell" data-accent={accent}>
        <div className="quizzi-search-shell__surface flex items-center rounded-full">
          <div className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${isRtl ? 'right-4' : 'left-4'}`}>
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-brand-dark/10 bg-white/90 shadow-[0_3px_10px_rgba(26,26,26,0.08)]">
              <Search className="h-4 w-4 text-brand-dark/55" />
            </div>
          </div>

          <input
            id={id}
            type="text"
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            className={`w-full rounded-full bg-transparent py-4 text-base font-black text-brand-dark outline-none ${isRtl ? 'pr-16 pl-14 text-right' : 'pl-16 pr-14 text-left'}`}
            dir={dir}
            {...inputProps}
          />

          {value ? (
            <button
              type="button"
              onClick={onClear}
              className={`absolute top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-brand-dark/35 transition hover:text-brand-orange ${isRtl ? 'left-4' : 'right-4'}`}
              aria-label="Clear search"
            >
              <XCircle className="h-5 w-5" />
            </button>
          ) : (
            <div
              className={`quizzi-search-shell__spark absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full ${accent === 'purple' ? 'bg-brand-purple' : 'bg-brand-orange'} ${isRtl ? 'left-6' : 'right-6'}`}
              aria-hidden="true"
            />
          )}
        </div>
      </div>
    </div>
  );
}
