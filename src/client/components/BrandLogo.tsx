type BrandLogoProps = {
  className?: string;
  imageClassName?: string;
  alt?: string;
  onClick?: () => void;
};

export default function BrandLogo({
  className = '',
  imageClassName = 'h-10 w-auto',
  alt = 'Quizzi',
  onClick,
}: BrandLogoProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-orange/25 ${className}`}
      aria-label={alt}
    >
      <img src="/Quizzi%20LOGO.svg" alt={alt} className={imageClassName} />
    </button>
  );
}
