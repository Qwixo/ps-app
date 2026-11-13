// The G Squad mark (a G), drawn the same as the Home Screen icon (todolist-mobile/static/*.png). No side effects:
// the sign in screen (views/Lock.tsx) shares it with the website's code.
export function AppMark({ size = 56 }: { size?: number }) {
  return (
    <span className="psm-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 64 64" width={size * 0.58} height={size * 0.58} fill="none" stroke="currentColor" strokeWidth={7.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M50.5 17.5A24 24 0 1 0 56 33H37" />
      </svg>
    </span>
  );
}
