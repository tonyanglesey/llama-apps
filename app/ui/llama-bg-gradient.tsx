// Decorative full-viewport backdrop for the apps console: a charcoal diagonal
// gradient with a faint diagonal hatch and two soft accent glows. It renders as
// a fixed layer pinned behind all content (-z-10) and is dark-only — in light
// mode the body background shows through instead (the grays would look wrong on
// white). The `dark` variant keys off <html data-theme="dark"> (see globals.css).
export default function LlamaBgGradient({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-0 -z-10 hidden dark:block ${className}`}
    >
      <svg
        className="h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 1440 900"
      >
        <defs>
          <linearGradient id="llamaBgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0f0f0f" />
            <stop offset="35%" stopColor="#1a1a1a" />
            <stop offset="70%" stopColor="#2a2a2a" />
            <stop offset="100%" stopColor="#1f1f1f" />
          </linearGradient>

          {/* Diagonal line texture */}
          <pattern
            id="llamaBgDiagonalLines"
            x="0"
            y="0"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-45)"
          >
            <line x1="0" y1="0" x2="0" y2="40" stroke="#ffffff" strokeWidth="0.5" opacity="0.03" />
          </pattern>
        </defs>

        <rect width="1440" height="900" fill="url(#llamaBgGradient)" />
        <rect width="1440" height="900" fill="url(#llamaBgDiagonalLines)" />

        {/* Subtle accent glows */}
        <circle cx="1000" cy="150" r="400" fill="#3a3a3a" opacity="0.1" />
        <circle cx="200" cy="700" r="350" fill="#2a2a2a" opacity="0.08" />
      </svg>
    </div>
  );
}
