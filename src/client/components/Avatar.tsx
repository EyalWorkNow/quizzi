import React from 'react';

/**
 * Avatar component that handles both legacy emoji-based avatars
 * and new image-based avatars stored as [avatar_n.png] prefixes.
 */
interface AvatarProps {
  nickname: string;
  className?: string;
  imgClassName?: string;
  textClassName?: string;
}

export default function Avatar({ nickname, className = '', imgClassName = '', textClassName = '' }: AvatarProps) {
  // Regex to match [avatar_n.png] or [avatar_nn.png]
  const avatarMatch = nickname?.match(/^\[(avatar_\d+\.png)\]\s*(.*)$/);

  if (avatarMatch) {
    const [, avatarFile, nameOnly] = avatarMatch;
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className={`w-10 h-10 rounded-xl border-2 border-brand-dark overflow-hidden bg-white shrink-0 shadow-[2px_2px_0px_0px_#1A1A1A] ${imgClassName}`}>
          <img 
            src={`/avatars/${avatarFile}`} 
            alt="Avatar" 
            className="w-full h-full object-cover"
            onError={(e) => {
              // Fallback if image fails to load
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
        {nameOnly && <span className={textClassName}>{nameOnly}</span>}
      </div>
    );
  }

  // Fallback for legacy nicknames that started with emojis (e.g. "🦊 Nickname")
  // Or just a plain nickname
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className={textClassName}>{nickname}</span>
    </div>
  );
}
