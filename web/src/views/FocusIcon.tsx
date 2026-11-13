// The focus mode icons (V1.43, core/dnd.ts FOCUS_ICONS): one line drawing each, 24 by 24, drawn in currentColor so
// they follow every look. The moon is the same solid crescent as the Do Not Disturb button.
import type { FocusIcon as Icon } from "../core/dnd";

const P: Record<Icon, React.ReactNode> = {
  moon: <path d="M19.6 14.9A7.9 7.9 0 0 1 9.1 4.4a7.9 7.9 0 1 0 10.5 10.5z" fill="currentColor" stroke="none" />,
  brain: <><path d="M9 4.5a3 3 0 0 0-3 3v.3a3 3 0 0 0-1.6 5.2A3 3 0 0 0 7 17.6V18a2.5 2.5 0 0 0 5 0V6.5a2 2 0 0 0-3-2z" /><path d="M15 4.5a3 3 0 0 1 3 3v.3a3 3 0 0 1 1.6 5.2 3 3 0 0 1-2.6 4.6V18a2.5 2.5 0 0 1-5 0" /></>,
  phone: <path d="M6.6 3.5h2.6l1.4 4-2 1.3a10.5 10.5 0 0 0 6.6 6.6l1.3-2 4 1.4v2.6a2 2 0 0 1-2.2 2A16 16 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" />,
  bed: <><path d="M3 18.5V6.5M3 14h18v4.5M21 14v-2.5a3 3 0 0 0-3-3h-7V14" /><circle cx="7" cy="10.5" r="1.8" /></>,
  book: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z" /></>,
  head: <><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3.5" y="13.5" width="4" height="6" rx="1.6" /><rect x="16.5" y="13.5" width="4" height="6" rx="1.6" /></>,
  leaf: <><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z" /><path d="M5 19l7-7" /></>,
  bolt: <path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" />,
  car: <><path d="M4 16.5v-3.2l2-5A2 2 0 0 1 7.9 7h8.2a2 2 0 0 1 1.9 1.3l2 5v3.2z" /><circle cx="7.5" cy="16.5" r="1.7" /><circle cx="16.5" cy="16.5" r="1.7" /></>,
  heart: <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />,
};

export function FocusIcon({ icon, size = 20 }: { icon: Icon; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[icon] ?? P.moon}
    </svg>
  );
}

/** Words for each icon (the picker's screen reader names). */
export const ICON_NAMES: Record<Icon, string> = {
  moon: "Moon", brain: "Brain", phone: "Phone", bed: "Bed", book: "Book", head: "Headphones", leaf: "Leaf", bolt: "Lightning", car: "Car", heart: "Heart",
};
