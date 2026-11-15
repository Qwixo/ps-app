// The WhatsApp mark in PS. Meta's brand rules (meta.com/brand/resources/whatsapp, read 14 Nov 2026) say: use only the logo files from
// their brand site, never modify it, never combine it with other marks, never use an image confusingly similar to their logo.
// They do not say a third party may put their logo in an app. So PS does not use the logo: it writes the word "WhatsApp" (capital W
// and A, as they ask) and draws a plain green speech bubble of its own, with no telephone in it. To use the real logo later
// (the developer's call), replace this one file with Meta's own unmodified file.
export function WaMark({ size = 16 }: { size?: number }) {
  return (
    <svg className="wa-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#25D366" d="M12 2.5c5.2 0 9.5 3.9 9.5 8.7s-4.3 8.7-9.5 8.7c-1.2 0-2.3-.2-3.4-.6L3.5 21l1.6-4.1C3.4 15.4 2.5 13.4 2.5 11.2 2.5 6.4 6.8 2.5 12 2.5z" />
    </svg>
  );
}
