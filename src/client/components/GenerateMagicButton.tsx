import type { ButtonHTMLAttributes, ReactNode } from 'react';

type GenerateMagicButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  idleLabel?: string;
  generatingLabel?: string;
  icon?: ReactNode;
};

function renderLetters(label: string) {
  return label.split('').map((letter, index) => (
    <span
      key={`${label}-${index}-${letter === ' ' ? 'space' : letter}`}
      className={`quizzi-generate-letter ${letter === ' ' ? 'quizzi-generate-letter-space' : ''}`}
      aria-hidden="true"
    >
      {letter === ' ' ? '\u00A0' : letter}
    </span>
  ));
}

export default function GenerateMagicButton({
  idleLabel = 'Generate',
  generatingLabel = 'Generating',
  icon,
  className = '',
  disabled,
  ...props
}: GenerateMagicButtonProps) {
  const isGenerating = Boolean(props['aria-busy']);

  return (
    <>
      <style>{`
        .quizzi-generate-button {
          --quizzi-generate-border-radius: 24px;
          --quizzi-generate-padding: 4px;
          --quizzi-generate-transition: 0.35s;
          --quizzi-generate-button-color: #101010;
          --quizzi-generate-shadow-color: rgba(180, 136, 255, 0.62);
          --quizzi-generate-highlight: rgba(255, 90, 54, 0.72);

          position: relative;
          isolation: isolate;
          user-select: none;
          display: inline-flex;
          width: 100%;
          align-items: center;
          justify-content: center;
          gap: 0.9rem;
          padding: 1rem 1.2rem 1rem 1.35rem;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: var(--quizzi-generate-border-radius);
          background:
            radial-gradient(circle at top, rgba(255, 255, 255, 0.18), transparent 58%),
            linear-gradient(135deg, #101010 0%, #1a1a1a 48%, #272727 100%);
          box-shadow:
            inset 0 1px 1px rgba(255,255,255,0.18),
            inset 0 10px 24px rgba(255,255,255,0.06),
            0 14px 32px rgba(0,0,0,0.16),
            0 8px 0 var(--quizzi-generate-shadow-color);
          color: #ffffff;
          cursor: pointer;
          overflow: hidden;
          transition:
            transform var(--quizzi-generate-transition),
            box-shadow var(--quizzi-generate-transition),
            border-color var(--quizzi-generate-transition),
            filter var(--quizzi-generate-transition);
        }

        .quizzi-generate-button::before {
          content: "";
          position: absolute;
          inset: calc(var(--quizzi-generate-padding) * -1);
          border-radius: calc(var(--quizzi-generate-border-radius) + var(--quizzi-generate-padding));
          background: linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04));
          opacity: 0.75;
          z-index: -2;
        }

        .quizzi-generate-button::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background:
            radial-gradient(circle at 15% 0%, rgba(255,255,255,0.45), transparent 30%),
            linear-gradient(110deg, transparent 18%, rgba(255,255,255,0.1) 32%, transparent 48%),
            linear-gradient(180deg, rgba(255,255,255,0.08), transparent 35%);
          opacity: 0.7;
          pointer-events: none;
        }

        .quizzi-generate-button:hover:not(:disabled) {
          transform: translateY(-2px);
          border-color: rgba(255, 90, 54, 0.34);
          box-shadow:
            inset 0 1px 1px rgba(255,255,255,0.18),
            inset 0 10px 24px rgba(255,255,255,0.08),
            0 18px 36px rgba(0,0,0,0.18),
            0 10px 0 rgba(180, 136, 255, 0.78);
        }

        .quizzi-generate-button:active:not(:disabled) {
          transform: translateY(3px);
          box-shadow:
            inset 0 2px 4px rgba(255,255,255,0.12),
            inset 0 10px 24px rgba(255,255,255,0.04),
            0 8px 20px rgba(0,0,0,0.16),
            0 4px 0 rgba(180, 136, 255, 0.5);
        }

        .quizzi-generate-button:disabled {
          cursor: not-allowed;
          opacity: 0.62;
          filter: saturate(0.8);
        }

        .quizzi-generate-button[data-generating="true"] {
          border-color: rgba(255, 90, 54, 0.42);
          box-shadow:
            inset 0 1px 1px rgba(255,255,255,0.18),
            inset 0 10px 24px rgba(255,255,255,0.08),
            0 18px 36px rgba(0,0,0,0.18),
            0 10px 0 rgba(255, 90, 54, 0.54);
        }

        .quizzi-generate-button[data-generating="true"] .quizzi-generate-icon {
          animation: quizzi-generate-flicker 1.1s linear infinite;
        }

        .quizzi-generate-button[data-generating="true"] .quizzi-generate-text-idle {
          opacity: 0;
          transform: translateY(-40%);
        }

        .quizzi-generate-button[data-generating="true"] .quizzi-generate-text-active {
          opacity: 1;
          transform: translateY(0%);
        }

        .quizzi-generate-button[data-generating="true"] .quizzi-generate-letter {
          animation-duration: 1.05s;
        }

        .quizzi-generate-icon {
          flex-shrink: 0;
          display: flex;
          height: 1.65rem;
          width: 1.65rem;
          align-items: center;
          justify-content: center;
          filter: drop-shadow(0 0 4px rgba(255,255,255,0.36));
          transition: transform var(--quizzi-generate-transition), filter var(--quizzi-generate-transition);
        }

        .quizzi-generate-button:hover:not(:disabled) .quizzi-generate-icon {
          transform: rotate(-8deg) scale(1.04);
          filter:
            drop-shadow(0 0 4px rgba(255,255,255,0.36))
            drop-shadow(0 0 8px rgba(255, 90, 54, 0.36));
        }

        .quizzi-generate-labels {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 9.25rem;
          min-height: 1.7rem;
          font-size: 1.06rem;
          line-height: 1;
          font-weight: 800;
          letter-spacing: 0.03em;
        }

        .quizzi-generate-text {
          position: absolute;
          inset: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0;
          white-space: nowrap;
          transition: opacity 0.28s ease, transform 0.28s ease;
        }

        .quizzi-generate-text-active {
          opacity: 0;
          transform: translateY(34%);
        }

        .quizzi-generate-letter {
          color: rgba(255, 255, 255, 0.52);
          text-shadow: 0 0 0 rgba(255,255,255,0);
          animation: quizzi-generate-letter-glow 2s ease-in-out infinite;
        }

        .quizzi-generate-letter-space {
          width: 0.32em;
        }

        .quizzi-generate-letter:nth-child(1) { animation-delay: 0s; }
        .quizzi-generate-letter:nth-child(2) { animation-delay: 0.08s; }
        .quizzi-generate-letter:nth-child(3) { animation-delay: 0.16s; }
        .quizzi-generate-letter:nth-child(4) { animation-delay: 0.24s; }
        .quizzi-generate-letter:nth-child(5) { animation-delay: 0.32s; }
        .quizzi-generate-letter:nth-child(6) { animation-delay: 0.4s; }
        .quizzi-generate-letter:nth-child(7) { animation-delay: 0.48s; }
        .quizzi-generate-letter:nth-child(8) { animation-delay: 0.56s; }
        .quizzi-generate-letter:nth-child(9) { animation-delay: 0.64s; }
        .quizzi-generate-letter:nth-child(10) { animation-delay: 0.72s; }

        @keyframes quizzi-generate-letter-glow {
          0%, 100% {
            color: rgba(255, 255, 255, 0.52);
            text-shadow: 0 0 0 rgba(255,255,255,0);
          }
          50% {
            color: rgba(255, 255, 255, 1);
            text-shadow: 0 0 8px rgba(255,255,255,0.45), 0 0 16px rgba(255,90,54,0.22);
          }
        }

        @keyframes quizzi-generate-flicker {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.42;
          }
        }
      `}</style>

      <button
        type="button"
        className={`quizzi-generate-button ${className}`.trim()}
        disabled={disabled}
        data-generating={isGenerating ? 'true' : 'false'}
        {...props}
      >
        <span className="quizzi-generate-icon" aria-hidden="true">
          {icon || (
            <svg className="h-6 w-6 fill-[#E8E8E8]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
              />
            </svg>
          )}
        </span>

        <span className="quizzi-generate-labels" aria-live="polite">
          <span className="quizzi-generate-text quizzi-generate-text-idle">{renderLetters(idleLabel)}</span>
          <span className="quizzi-generate-text quizzi-generate-text-active">{renderLetters(generatingLabel)}</span>
        </span>
      </button>
    </>
  );
}
