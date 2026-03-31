import type { ButtonHTMLAttributes, CSSProperties } from 'react';

type DeleteActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label?: string;
  compact?: boolean;
};

export default function DeleteActionButton({
  label = 'Delete',
  compact = false,
  className = '',
  type = 'button',
  ...props
}: DeleteActionButtonProps) {
  return (
    <>
      <style>{`
        .quizzi-bin-button {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: var(--bin-size, 55px);
          height: var(--bin-size, 55px);
          border-radius: 999px;
          background-color: rgb(255, 95, 95);
          cursor: pointer;
          border: 2px solid rgb(255, 201, 201);
          transition:
            transform 0.2s ease,
            background-color 0.3s ease,
            box-shadow 0.3s ease,
            opacity 0.2s ease;
          position: relative;
          overflow: hidden;
          box-shadow: 0 10px 24px rgba(255, 95, 95, 0.2);
        }

        .quizzi-bin-button:hover:not(:disabled),
        .quizzi-bin-button:focus-visible:not(:disabled) {
          background-color: rgb(255, 0, 0);
          box-shadow: 0 14px 28px rgba(255, 0, 0, 0.24);
        }

        .quizzi-bin-button:active:not(:disabled) {
          transform: scale(0.9);
        }

        .quizzi-bin-button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .quizzi-bin-button:focus-visible {
          outline: 3px solid rgba(255, 209, 59, 0.7);
          outline-offset: 3px;
        }

        .quizzi-bin-button__bottom {
          width: var(--bin-bottom-width, 15px);
          z-index: 2;
          display: block;
          flex: 0 0 auto;
        }

        .quizzi-bin-button__top {
          width: var(--bin-top-width, 17px);
          transform-origin: right;
          transition-duration: 0.3s;
          z-index: 2;
          display: block;
          flex: 0 0 auto;
          margin-bottom: 1px;
        }

        .quizzi-bin-button:hover:not(:disabled) .quizzi-bin-button__top,
        .quizzi-bin-button:focus-visible:not(:disabled) .quizzi-bin-button__top {
          transform: rotate(45deg);
        }

        .quizzi-bin-button__garbage {
          position: absolute;
          width: var(--bin-garbage-width, 14px);
          height: auto;
          z-index: 1;
          opacity: 0;
          transition: all 0.3s;
        }

        .quizzi-bin-button:hover:not(:disabled) .quizzi-bin-button__garbage,
        .quizzi-bin-button:focus-visible:not(:disabled) .quizzi-bin-button__garbage {
          animation: quizzi-bin-throw 0.4s linear;
        }

        @keyframes quizzi-bin-throw {
          from {
            transform: translate(-400%, -700%);
            opacity: 0;
          }
          to {
            transform: translate(0%, 0%);
            opacity: 1;
          }
        }
      `}</style>

      <button
        type={type}
        className={`quizzi-bin-button ${className}`.trim()}
        aria-label={label}
        title={label}
        style={
          compact
            ? ({
                '--bin-size': '42px',
                '--bin-bottom-width': '12px',
                '--bin-top-width': '14px',
                '--bin-garbage-width': '11px',
              } as CSSProperties)
            : undefined
        }
        {...props}
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 39 7" className="quizzi-bin-button__top" aria-hidden="true">
          <line strokeWidth="4" stroke="white" y2="5" x2="39" y1="5" />
          <line strokeWidth="3" stroke="white" y2="1.5" x2="26.0357" y1="1.5" x1="12" />
        </svg>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 33 39" className="quizzi-bin-button__bottom" aria-hidden="true">
          <mask fill="white" id="quizzi-bin-mask">
            <path d="M0 0H33V35C33 37.2091 31.2091 39 29 39H4C1.79086 39 0 37.2091 0 35V0Z" />
          </mask>
          <path mask="url(#quizzi-bin-mask)" fill="white" d="M0 0H33H0ZM37 35C37 39.4183 33.4183 43 29 43H4C-0.418278 43 -4 39.4183 -4 35H4H29H37ZM4 43C-0.418278 43 -4 39.4183 -4 35V0H4V35V43ZM37 0V35C37 39.4183 33.4183 43 29 43V35V0H37Z" />
          <path strokeWidth="4" stroke="white" d="M12 6L12 29" />
          <path strokeWidth="4" stroke="white" d="M21 6V29" />
        </svg>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 89 80" className="quizzi-bin-button__garbage" aria-hidden="true">
          <path fill="white" d="M20.5 10.5L37.5 15.5L42.5 11.5L51.5 12.5L68.75 0L72 11.5L79.5 12.5H88.5L87 22L68.75 31.5L75.5066 25L86 26L87 35.5L77.5 48L70.5 49.5L80 50L77.5 71.5L63.5 58.5L53.5 68.5L65.5 70.5L45.5 73L35.5 79.5L28 67L16 63L12 51.5L0 48L16 25L22.5 17L20.5 10.5Z" />
        </svg>
      </button>
    </>
  );
}
