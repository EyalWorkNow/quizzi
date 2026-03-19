import React from 'react';

type QuestionImageCardProps = {
  imageUrl?: string;
  alt?: string;
  className?: string;
  imgClassName?: string;
};

export default function QuestionImageCard({
  imageUrl,
  alt = 'Question image',
  className = '',
  imgClassName = '',
}: QuestionImageCardProps) {
  if (!imageUrl) return null;

  return (
    <div className={`rounded-[2rem] border-4 border-brand-dark bg-white shadow-[6px_6px_0px_0px_#1A1A1A] overflow-hidden ${className}`}>
      <img
        src={imageUrl}
        alt={alt}
        className={`w-full h-full object-contain bg-white ${imgClassName}`}
        loading="lazy"
      />
    </div>
  );
}
