// The dev server only (?whatsnew=demo, views/WhatsNew.tsx): made up points to look at the What's new panel.
// These are NOT patch notes and never reach a build; real notes come only from the developer's approved words.
export const DEMO_WHATSNEW = {
  version: (/^V(\d+\.\d+)$/.exec(__PS_VERSION__.name)?.[1]) || "1.36",
  keyword: __PS_VERSION__.keyword || "Example",
  notes: [
    "Example point one, a short sentence about a change.",
    "Example point two, a little longer so it wraps onto a second line in the panel to show how that looks.",
    "Example point three.",
    "Example point four, the last one.",
  ],
};

// ?whatsnew=demo3 (dev server only): made up earlier versions, so the panel can be looked at as after a jump of three
// (the running version, and the two before it; the last version "seen" is the one before those).
const minor = Number((/^V\d+\.(\d+)$/.exec(__PS_VERSION__.name)?.[1]) || "52");
const ver = (m: number) => `1.${String(m).padStart(2, "0")}`;
export const DEMO_SINCE = ver(minor - 3);
export const DEMO_HISTORY = [
  { version: ver(minor - 1), keyword: "Example B", notes: ["Example point for the version before, a short sentence.", "A second example point for it, a little longer so it wraps onto another line."] },
  { version: ver(minor - 2), keyword: "Example A", notes: ["Example point for the version before that.", "Another one.", "And a third one."] },
];

// ?whatsnew=demo8 (dev server only): a phone or Mac that ran PS before but cannot say which version (V1.53): the last
// five of eight made up versions, headed with the range.
export const DEMO_LONG = Array.from({ length: 8 }, (_, i) => ({
  version: ver(minor - 1 - i), keyword: `Example ${String.fromCharCode(66 + i)}`,
  notes: [`Made up point one for the version ${i + 1} before.`, "A second made up point, a little longer so it wraps onto another line in the list.", ...(i % 2 ? ["A third one."] : [])],
}));
