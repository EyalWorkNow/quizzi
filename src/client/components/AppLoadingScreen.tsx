import React from 'react';
import QuizziPencilLoader from './QuizziPencilLoader.tsx';

type AppLoadingScreenProps = {
  label: string;
  caption?: string;
  fullScreen?: boolean;
  dir?: 'rtl' | 'ltr';
  panelClassName?: string;
  size?: number;
};

export default function AppLoadingScreen({
  label,
  caption,
  fullScreen = true,
  dir,
  panelClassName = '',
  size = 132,
}: AppLoadingScreenProps) {
  return (
    <div
      dir={dir}
      className={fullScreen ? 'min-h-screen bg-brand-bg flex items-center justify-center px-6' : 'flex items-center justify-center'}
    >
      <div
        className={`w-full max-w-2xl rounded-[2.4rem] border-4 border-brand-dark bg-white px-6 py-8 shadow-[10px_10px_0px_0px_#1A1A1A] sm:px-8 ${panelClassName}`}
      >
        <QuizziPencilLoader size={size} label={label} caption={caption} />
      </div>
    </div>
  );
}
