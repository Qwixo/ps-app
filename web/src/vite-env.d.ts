/// <reference types="vite/client" />

/** The PS version and its keyword, from ps-version.json at build time (vite.config.ts). */
declare const __PS_VERSION__: { name: string; keyword: string };
/** This build's source fingerprint, the same as its version.json "src" (empty on the dev server). */
declare const __WEB_SRC__: string;
/** When this build was made (ISO), the same as its version.json "built" (empty on the dev server). */
declare const __WEB_BUILT__: string;
/** The What's new panel's notes for this version (vite.config.ts psWhatsNew): only words the developer approved, else none. */
declare const __PS_WHATSNEW__: { version: string; keyword: string; notes: string[]; code: string; built: string; history?: { version: string; keyword: string; notes: string[] }[] };
