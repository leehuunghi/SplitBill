import React from 'react';

const PALETTE = [
  '#FFD6E0',
  '#CDF3DF',
  '#FFEFA8',
  '#DCD3FF',
  '#C9E4FF',
  '#FFD9C2',
  '#BDEFEC',
  '#F3D1F7',
  '#E2F0B5',
  '#FFC9C9',
];

export const avatarColor = id => PALETTE[(Math.abs(Number(id) || 1) - 1) % PALETTE.length];

// Avatar: ảnh member.avatar nếu có, không thì chữ cái đầu trên nền pastel theo id.
export function Avatar({ member, size = 40, className = '' }) {
  const [failed, setFailed] = React.useState(false);
  const src = member?.avatar || '';
  React.useEffect(() => setFailed(false), [src]);

  return (
    <div
      style={{
        width: size,
        height: size,
        background: avatarColor(member?.id),
        fontSize: Math.round(size * 0.46),
      }}
      className={`flex flex-none items-center justify-center overflow-hidden rounded-full border-2 border-solid border-white font-display font-extrabold text-ink ${className}`}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          draggable="false"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{String(member?.name || '?').trim().charAt(0).toUpperCase()}</span>
      )}
    </div>
  );
}

// Nền chung: hình tròn pastel nổi lơ lửng + khung nội dung căn giữa.
export function AppShell({ children }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas font-sans text-ink">
      <div
        aria-hidden="true"
        className="blob-float pointer-events-none absolute -right-14 -top-20 h-60 w-60 rounded-full bg-sun/70 md:h-80 md:w-80"
      />
      <div
        aria-hidden="true"
        className="blob-float pointer-events-none absolute -left-20 bottom-24 h-52 w-52 rounded-full bg-mint/70 md:h-72 md:w-72"
        style={{ animationDelay: '-1.4s' }}
      />
      <div className="relative mx-auto max-w-5xl p-4 md:p-6">{children}</div>
    </div>
  );
}
