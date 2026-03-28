import React, { useId } from 'react';

type QuizziPencilLoaderProps = {
  size?: number;
  className?: string;
  label?: string;
  caption?: string;
};

export default function QuizziPencilLoader({
  size = 140,
  className = '',
  label,
  caption,
}: QuizziPencilLoaderProps) {
  const clipPathId = useId().replace(/:/g, '');
  const isCompact = size <= 90;

  return (
    <div className={`flex flex-col items-center justify-center text-center text-brand-dark ${className}`}>
      <style>{`
        .quizzi-pencil-loader {
          display: block;
          width: 10em;
          height: 10em;
          color: #1a1a1a;
        }

        .quizzi-pencil-loader__body1,
        .quizzi-pencil-loader__body2,
        .quizzi-pencil-loader__body3,
        .quizzi-pencil-loader__eraser,
        .quizzi-pencil-loader__eraser-skew,
        .quizzi-pencil-loader__point,
        .quizzi-pencil-loader__rotate,
        .quizzi-pencil-loader__stroke {
          animation-duration: 3s;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }

        .quizzi-pencil-loader__body1,
        .quizzi-pencil-loader__body2,
        .quizzi-pencil-loader__body3 {
          transform: rotate(-90deg);
        }

        .quizzi-pencil-loader__body1 {
          animation-name: quizziPencilBody1;
          stroke: #b488ff;
        }

        .quizzi-pencil-loader__body2 {
          animation-name: quizziPencilBody2;
          stroke: #ff5a36;
        }

        .quizzi-pencil-loader__body3 {
          animation-name: quizziPencilBody3;
          stroke: #ffd13b;
        }

        .quizzi-pencil-loader__eraser {
          animation-name: quizziPencilEraser;
          transform: rotate(-90deg) translate(49px, 0);
        }

        .quizzi-pencil-loader__eraser-skew {
          animation-name: quizziPencilEraserSkew;
          animation-timing-function: ease-in-out;
        }

        .quizzi-pencil-loader__point {
          animation-name: quizziPencilPoint;
          transform: rotate(-90deg) translate(49px, -30px);
        }

        .quizzi-pencil-loader__rotate {
          animation-name: quizziPencilRotate;
        }

        .quizzi-pencil-loader__stroke {
          animation-name: quizziPencilStroke;
          transform: translate(100px, 100px) rotate(-113deg);
          stroke: rgba(26, 26, 26, 0.32);
        }

        @keyframes quizziPencilBody1 {
          from,
          to {
            stroke-dashoffset: 351.86;
            transform: rotate(-90deg);
          }

          50% {
            stroke-dashoffset: 150.8;
            transform: rotate(-225deg);
          }
        }

        @keyframes quizziPencilBody2 {
          from,
          to {
            stroke-dashoffset: 406.84;
            transform: rotate(-90deg);
          }

          50% {
            stroke-dashoffset: 174.36;
            transform: rotate(-225deg);
          }
        }

        @keyframes quizziPencilBody3 {
          from,
          to {
            stroke-dashoffset: 296.88;
            transform: rotate(-90deg);
          }

          50% {
            stroke-dashoffset: 127.23;
            transform: rotate(-225deg);
          }
        }

        @keyframes quizziPencilEraser {
          from,
          to {
            transform: rotate(-45deg) translate(49px, 0);
          }

          50% {
            transform: rotate(0deg) translate(49px, 0);
          }
        }

        @keyframes quizziPencilEraserSkew {
          from,
          32.5%,
          67.5%,
          to {
            transform: skewX(0);
          }

          35%,
          65% {
            transform: skewX(-4deg);
          }

          37.5%,
          62.5% {
            transform: skewX(8deg);
          }

          40%,
          45%,
          50%,
          55%,
          60% {
            transform: skewX(-15deg);
          }

          42.5%,
          47.5%,
          52.5%,
          57.5% {
            transform: skewX(15deg);
          }
        }

        @keyframes quizziPencilPoint {
          from,
          to {
            transform: rotate(-90deg) translate(49px, -30px);
          }

          50% {
            transform: rotate(-225deg) translate(49px, -30px);
          }
        }

        @keyframes quizziPencilRotate {
          from {
            transform: translate(100px, 100px) rotate(0);
          }

          to {
            transform: translate(100px, 100px) rotate(720deg);
          }
        }

        @keyframes quizziPencilStroke {
          from {
            stroke-dashoffset: 439.82;
            transform: translate(100px, 100px) rotate(-113deg);
          }

          50% {
            stroke-dashoffset: 164.93;
            transform: translate(100px, 100px) rotate(-113deg);
          }

          75%,
          to {
            stroke-dashoffset: 439.82;
            transform: translate(100px, 100px) rotate(112deg);
          }
        }
      `}</style>

      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 200 200"
        className="quizzi-pencil-loader"
        width={size}
        height={size}
        aria-hidden="true"
      >
        <defs>
          <clipPath id={clipPathId}>
            <rect height="30" width="30" rx="5" ry="5" />
          </clipPath>
        </defs>
        <circle
          className="quizzi-pencil-loader__stroke"
          cx="100"
          cy="100"
          r="70"
          fill="none"
          strokeWidth="2"
          strokeDasharray="439.82 439.82"
          strokeDashoffset="439.82"
          strokeLinecap="round"
          transform="rotate(-113,100,100)"
        />
        <g transform="translate(100,100)" className="quizzi-pencil-loader__rotate">
          <g fill="none">
            <circle
              className="quizzi-pencil-loader__body1"
              r="64"
              strokeWidth="30"
              strokeDasharray="402.12 402.12"
              strokeDashoffset="402"
              transform="rotate(-90)"
            />
            <circle
              className="quizzi-pencil-loader__body2"
              r="74"
              strokeWidth="10"
              strokeDasharray="464.96 464.96"
              strokeDashoffset="465"
              transform="rotate(-90)"
            />
            <circle
              className="quizzi-pencil-loader__body3"
              r="54"
              strokeWidth="10"
              strokeDasharray="339.29 339.29"
              strokeDashoffset="339"
              transform="rotate(-90)"
            />
          </g>
          <g transform="rotate(-90) translate(49,0)" className="quizzi-pencil-loader__eraser">
            <g className="quizzi-pencil-loader__eraser-skew">
              <rect height="30" width="30" rx="5" ry="5" fill="#ff5a36" />
              <rect clipPath={`url(#${clipPathId})`} height="30" width="5" fill="#e84928" />
              <rect height="20" width="30" fill="#f4efe7" />
              <rect height="20" width="15" fill="#ddd1c4" />
              <rect height="20" width="5" fill="#ece1d4" />
              <rect height="2" width="30" y="6" fill="rgba(26,26,26,0.18)" />
              <rect height="2" width="30" y="13" fill="rgba(26,26,26,0.18)" />
            </g>
          </g>
          <g transform="rotate(-90) translate(49,-30)" className="quizzi-pencil-loader__point">
            <polygon points="15 0,30 30,0 30" fill="#ffd19b" />
            <polygon points="15 0,6 30,0 30" fill="#f8a74d" />
            <polygon points="15 0,20 10,10 10" fill="#1a1a1a" />
          </g>
        </g>
      </svg>

      {label ? <p className={`mt-3 font-black tracking-tight ${isCompact ? 'text-lg' : 'text-2xl'}`}>{label}</p> : null}
      {caption ? <p className={`mt-2 max-w-md font-bold text-brand-dark/60 ${isCompact ? 'text-xs' : 'text-sm'}`}>{caption}</p> : null}
    </div>
  );
}
