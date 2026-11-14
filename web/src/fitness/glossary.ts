// PS Fitness glossary (V1.47, the developer: "There are a lot of settings where, if you're not the one who created them or you're
// not experienced in fitness, you don't know what they mean. Everywhere, if you hover over anything, or little info
// icons, there should be a lot more information about what it means, so it's easy to understand for everybody.")
//
// ONE place for every Fitness word, so the (i) cards, the hover cards on the Mac, Settings' "Every word explained" and
// the setup questions all say the same thing. Each entry: what it is in plain words, a short example, and why it
// matters, written for someone on their first week in a gym. Pure (no React), tested in tests/fitness-glossary.test.ts:
// every Fitness setting points at an entry here (PREF_TERMS is typed against FitPrefs, so a new setting with no entry
// fails tsc), and no entry has an em or en dash.
import type { FitPrefs } from "../core/fitness.ts";

export interface Term {
  /** The word as it shows on screen. */
  title: string;
  /** What it is, in one or two plain sentences. */
  what: string;
  /** A short example. */
  example: string;
  /** Why it matters to you. */
  why: string;
  /** Where it sits in "Every word explained". */
  group: TermGroup;
}
export type TermGroup = "basics" | "effort" | "plan" | "gym" | "progress" | "settings" | "setup";
export const GROUPS: { k: TermGroup; title: string }[] = [
  { k: "basics", title: "The basics" },
  { k: "effort", title: "How hard to go" },
  { k: "plan", title: "Programs and days" },
  { k: "gym", title: "In the gym" },
  { k: "progress", title: "Progress" },
  { k: "settings", title: "Settings" },
  { k: "setup", title: "Setting up your training" },
];

const T = <K extends string>(m: Record<K, Term>) => m;

export const GLOSSARY = T({
  // ---------- the basics ----------
  rep: {
    group: "basics", title: "Rep",
    what: "One repetition: you lift the weight once and bring it back.",
    example: "Ten curls in a row is 10 reps.",
    why: "Reps are how you count the work. Fewer reps with a heavy weight build strength; more reps with a lighter one build size and fitness.",
  },
  set: {
    group: "basics", title: "Set",
    what: "A group of reps done in a row without stopping, followed by a rest.",
    example: "3 sets of 10 means: 10 reps, rest, 10 reps, rest, 10 reps.",
    why: "Doing several sets gives your muscles enough work to grow, while the rests let each set be done well.",
  },
  "sets-reps": {
    group: "basics", title: "Sets x reps",
    what: "The short way plans write how much to do: the number of sets, then the reps in each.",
    example: "3 x 10 is 3 sets of 10 reps. 4 x 8 to 10 is 4 sets of 8, 9 or 10 reps.",
    why: "It tells you exactly what to aim for, so every session has a clear target.",
  },
  "rep-range": {
    group: "basics", title: "Rep range",
    what: "A target written as a low and a high number of reps instead of one number.",
    example: "8 to 12: pick a weight you can lift at least 8 times. When you reach 12 on every set, it is time for a little more weight.",
    why: "A range gives you room on a bad day and tells you when to add weight.",
  },
  compound: {
    group: "basics", title: "Compound exercise",
    what: "A big lift where several joints move at once, so many muscles work together.",
    example: "Squat, bench press, rows, lat pulldown, shoulder press.",
    why: "They give the most results for your time and are the most tiring, so they come first in a session and get the long rest.",
  },
  isolation: {
    group: "basics", title: "Isolation exercise",
    what: "A small lift where only one joint moves, so it works one muscle on its own.",
    example: "Bicep curls, lateral raises, leg extensions, triceps pushdowns.",
    why: "Great for bringing up one muscle. They are less tiring, so they come after the big lifts and get the short rest.",
  },
  rest: {
    group: "basics", title: "Rest between sets",
    what: "The pause after a set before the next one. The timer starts by itself when you tick a set.",
    example: "Finish a set of squats, rest 2 minutes, then do the next set.",
    why: "Your muscles need a moment to recover. Too little rest and the next set gets weaker; too much just makes the session longer.",
  },
  "long-rest": {
    group: "basics", title: "Long rest",
    what: "The rest after a set of a big (compound) lift. 2 minutes to start.",
    example: "Squat, bench press, rows and pulldowns use the long rest.",
    why: "Big lifts tire your whole body, so a longer rest keeps the next set strong. Research shows about 2 to 3 minutes works best for them.",
  },
  "short-rest": {
    group: "basics", title: "Short rest",
    what: "The rest after a set of a small (isolation) lift. 90 seconds to start.",
    example: "Curls, raises and pushdowns use the short rest.",
    why: "Small lifts recover faster, so a shorter rest saves time without making the next set weaker.",
  },
  "per-side": {
    group: "basics", title: "kg each",
    what: "The weight in one hand (or on one side), not both added together.",
    example: "Two 12 kg dumbbells is logged as 12 kg each, not 24 kg.",
    why: "It is how dumbbells are labelled, so your numbers match what you pick up next time.",
  },
  "to-failure": {
    group: "basics", title: "To failure",
    what: "Doing reps until you cannot do another one with good form.",
    example: "A plan that says \"last set to failure\" means keep going on that set until the next rep would not happen.",
    why: "It is very hard work. Use it rarely, on small lifts, and never on heavy squats or bench without a spotter.",
  },

  // ---------- effort ----------
  rir: {
    group: "effort", title: "RIR (reps in reserve)",
    what: "After a set, how many more good reps you think you could have done. Tap 0, 1, 2, 3 or 4+.",
    example: "You did 10 reps and could have managed 2 more: that is RIR 2.",
    why: "It shows how hard a set really was, so you (or your trainer) know when to add weight. Being one off is normal; it is a feel, not a test.",
  },
  "target-rir": {
    group: "effort", title: "Target RIR (the goal)",
    what: "How hard a plan wants each set to be, as reps left in reserve. Marked Goal on the chips.",
    example: "Target RIR 2: stop each set when you think 2 more reps would still be possible.",
    why: "It keeps you working hard enough to improve without going so hard that you get hurt or too sore to train again.",
  },
  rpe: {
    group: "effort", title: "RPE (effort score)",
    what: "Rate of perceived exertion: how hard a set felt from 1 to 10. Fitness uses RIR instead and turns RPE into RIR for you.",
    example: "RPE 8 is RIR 2 (two reps left). RPE 10 is RIR 0 (nothing left).",
    why: "Some trainers write RPE in their sheets. When you import one, Fitness converts it so you only ever see one scale.",
  },
  "progressive-overload": {
    group: "effort", title: "Progressive overload",
    what: "Slowly asking your body for a bit more over the weeks: a little more weight, a rep more, or a set more.",
    example: "Week 1: 20 kg x 10. Week 3: 20 kg x 12. Week 4: 22.5 kg x 9.",
    why: "It is the main reason people get stronger and bigger. Doing the exact same thing forever stops working after a while.",
  },
  "add-weight": {
    group: "effort", title: "Add weight hint",
    what: "A quiet suggestion to go up a small step when your sets have felt easy and every rep was done.",
    example: "Two sessions in a row at RIR 3 when the goal was 2: try 2.5 kg more.",
    why: "Small steady jumps beat big ones. It is only a hint: you or your trainer decide.",
  },
  "weight-step": {
    group: "effort", title: "Weight step",
    what: "The usual jump in weight for that kind of equipment.",
    example: "Barbells and cables go up 2.5 kg, dumbbells 2 kg, machine stacks 5 kg.",
    why: "The plus and minus buttons and the add weight hint use it, so the numbers match what is in the gym.",
  },
  deload: {
    group: "effort", title: "Deload",
    what: "A planned easier week: the same exercises with less weight or fewer sets.",
    example: "Every 6 to 8 weeks, do 2 sets instead of 3 at about 80 percent of your usual weights.",
    why: "It lets joints and energy catch up, so you come back stronger. Not needed in your first months.",
  },

  // ---------- programs and days ----------
  program: {
    group: "plan", title: "Program",
    what: "Your plan for a training week: the days, the exercises on each and what to aim for. One program is active at a time.",
    example: "\"Build muscle plan\": Day 1 Upper, Day 2 Lower, Day 3 Upper, Day 4 Lower.",
    why: "With a program, Fitness opens on the right day with the right exercises and your last weights, so you never plan in the gym.",
  },
  "program-day": {
    group: "plan", title: "Program day",
    what: "One session of your program. Days are done in order, not on set weekdays.",
    example: "Day 2: Pull. If you trained Day 1 on Monday, Day 2 comes up next, whether that is Tuesday or Friday.",
    why: "Missing a gym day never breaks the plan: you just carry on with the next day.",
  },
  week: {
    group: "plan", title: "Week number",
    what: "How many times you have gone through every day of the program. After the last day, a new week starts.",
    example: "Week 3 · Day 1 means you have done the whole program twice already.",
    why: "It shows how far you are, and trainers often change the plan every few weeks.",
  },
  "repeat-day": {
    group: "plan", title: "Repeat this day",
    what: "Fitness keeps opening the same day, even after you train it, until you turn it off. It used to be called Lock this day.",
    example: "Your trainer wants you on Day 1 every visit this week: turn on Repeat Day 1.",
    why: "Handy when you want to master one session. Off, the next day comes up by itself.",
  },
  "free-workout": {
    group: "plan", title: "Free workout",
    what: "A workout with no program: add any exercise as you go.",
    example: "No plan today? Start a free workout, add squats and rows, log your sets.",
    why: "You never have to plan before you train. You can save a free workout as a plan afterwards.",
  },
  split: {
    group: "plan", title: "Split",
    what: "How a program shares out the body over the week.",
    example: "Full body (everything each day), Upper and Lower, or Push, Pull and Legs.",
    why: "Fewer days a week suit full body; more days let each session focus on fewer muscles.",
  },

  // ---------- in the gym ----------
  "warm-up": {
    group: "gym", title: "Warm up sets",
    what: "Light sets before your real (working) sets, to get the muscles and joints ready.",
    example: "Working weight 60 kg: do 10 reps with the bar, then 5 with 40 kg, then start.",
    why: "They lower the risk of injury and make the heavy sets feel better. They never count as a best or in volume.",
  },
  "extra-set": {
    group: "gym", title: "Add set",
    what: "One more set after the planned ones, with the same weight and reps as the last.",
    example: "All 3 sets done and you feel fresh: Add set gives a 4th, tagged EXTRA.",
    why: "Extra work on a good day, without changing the plan for next time.",
  },
  "drop-set": {
    group: "gym", title: "Drop set",
    what: "Straight after a set, with no rest, take about 20 percent off the weight and keep going.",
    example: "10 reps at 20 kg, then right away as many as you can at 16 kg.",
    why: "It squeezes more work out of a muscle in little time. Very tiring, so one per exercise at most.",
  },
  "finish-exercise": {
    group: "gym", title: "Finish exercise",
    what: "Ends this exercise for today. The sets you did count as normal; the ones left are taken out. Undo is in the message that follows.",
    example: "Planned 4 sets, did 3 and your arm is done: tap Finish exercise.",
    why: "No guilt and no half filled sets in your history. Next time still starts with your usual number of sets.",
  },
  "own-rest": {
    group: "gym", title: "Rest for one exercise",
    what: "In the gym, tap Rest on an exercise to give it the short rest, the long rest or your own time. It keeps that from then on.",
    example: "Lateral raises always on 60 seconds: tap Rest, then -15 twice.",
    why: "Some exercises need more or less rest than the default. Settings can reset them all.",
  },
  "own-sets": {
    group: "gym", title: "Sets for one exercise",
    what: "In the gym, tap the sets on an exercise to change how many it has. It keeps your number next time too.",
    example: "Your plan says 3 sets of curls but you like 4: tap 3 sets, then +1.",
    why: "Your own number comes before the program's. Settings can reset them all.",
  },

  // ---------- progress ----------
  pb: {
    group: "progress", title: "Personal best (PB)",
    what: "The best you have ever done on an exercise: your heaviest set, your strongest set, or the most reps at a weight.",
    example: "Your best bench was 60 kg x 5. Today you did 62.5 kg x 5: a new PB, marked with a star.",
    why: "It is the clearest proof you are getting stronger, and a great reason to keep going.",
  },
  e1rm: {
    group: "progress", title: "Estimated max",
    what: "The most you could probably lift once, worked out from a set you did (no need to try it).",
    example: "80 kg x 6 works out to about 96 kg for one rep.",
    why: "It lets you compare a heavy set of 3 with a lighter set of 10, so progress shows even when your reps change.",
  },
  volume: {
    group: "progress", title: "Volume",
    what: "How much work you did: weight times reps, added up over every working set.",
    example: "3 sets of 10 at 20 kg is 600 kg of volume.",
    why: "Over the weeks, more volume (done well) usually means more muscle. Warm up sets are left out.",
  },
  "percent-better": {
    group: "progress", title: "Percent better",
    what: "How much stronger you are now than before: your best estimated max on each exercise in the last 4 weeks, compared with the 8 weeks before, averaged.",
    example: "Bench up 5 percent and rows up 3 percent: about 4 percent better.",
    why: "One number for \"am I improving?\", fair across different exercises. It needs a few weeks of history to show.",
  },
  "week-goal": {
    group: "progress", title: "Week goal",
    what: "How many days a week you want to train. History counts your days, Monday to Sunday, and your weeks in a row.",
    example: "Goal 3: train Monday, Wednesday and Saturday and the week is met.",
    why: "Showing up regularly matters more than any single workout. A goal you can keep beats an ambitious one.",
  },

  // ---------- settings ----------
  "sets-default": {
    group: "settings", title: "Sets per exercise",
    what: "How many sets a new exercise starts with when no program says otherwise.",
    example: "Set to 3: add any exercise in a free workout and it comes with 3 sets.",
    why: "3 sets is a good start for most people. A program's own number, or yours for one exercise, comes first.",
  },
  look: {
    group: "settings", title: "Look",
    what: "The colours of Fitness. Volt is dark and gold, Chalk is high contrast for a bright gym, Pulse is a deep blue glow.",
    example: "Bright gym lights making the screen hard to read? Pick Chalk.",
    why: "Your numbers need to be readable at a glance, mid set. Light or dark is remembered on each device.",
  },
  "rest-sound": {
    group: "settings", title: "Rest sound on the Mac",
    what: "When a rest ends, the Mac plays a sound and shows a card.",
    example: "Training with your laptop open: the chime tells you to start the next set.",
    why: "You do not have to watch the timer. Turn it off for a quiet room.",
  },
  "gym-scan": {
    group: "settings", title: "Gym scan",
    what: "In a workout on the phone, Scan reads the label on a machine, puts German into English, and finds the exercise in your list.",
    example: "Point it at a sign that says Beinpresse: it shows Leg press with a big green Yes, adds it, and shows how it is done.",
    why: "You do not have to know what a machine is called. The picture is read on the phone and thrown away, never saved or sent.",
  },
  "gym-reminder": {
    group: "settings", title: "Gym reminder",
    what: "Reminders before your gym time on the days you pick: cards on the Mac, notifications and a ring on the phone. Nag mode reminds you every few minutes until you say Yes.",
    example: "Gym at 08:00 on Monday, Wednesday and Friday: reminders at 06:00, 07:00, 07:30 and 07:50. Or nag from 10:00 every 15 min, gym 23:00 to 01:00, ring at 22:55.",
    why: "Showing up is the hardest part. Say Yes on one device and both stop.",
  },
  "sleep-settings": {
    group: "settings", title: "Sleep",
    what: "Your sleep target and the once a day \"How did you sleep?\" question.",
    example: "Target 8 h: History shows which nights you got there.",
    why: "Muscles recover and grow while you sleep. Poor sleep makes the gym feel harder.",
  },
  "squad-sharing": {
    group: "settings", title: "G Squad sharing",
    what: "What your G Squad friends see on your shared gym boards. Each switch turns one thing on or off.",
    example: "Share days trained and personal bests, keep sleep private.",
    why: "Friends keep you going, and you decide exactly what they see. Notes and RIR are never shared.",
  },
  sync: {
    group: "settings", title: "Sync",
    what: "Everything is saved on this device first and sent to your other devices when there is signal.",
    example: "No signal in the basement gym: log as normal, it syncs on the way home.",
    why: "You never lose a set, even offline. Everything is encrypted, like the rest of your vault.",
  },

  // ---------- setting up ----------
  setup: {
    group: "setup", title: "Set up your training",
    what: "A few short questions, then a suggested program built from Fitness's exercises, which you can change before saving.",
    example: "Build muscle, 3 days a week, 45 minutes, new to the gym, full gym: you get a 3 day full body plan.",
    why: "It takes the guesswork out of the start. Every answer is saved as you go, so you can finish later.",
  },
  "goal-muscle": {
    group: "setup", title: "Build muscle",
    what: "Aim to grow muscle size. Moderate weights for 8 to 12 reps, 3 sets, rest 1.5 to 2 minutes.",
    example: "Bench press 3 x 8 to 12.",
    why: "This rep range is the most proven way to grow muscle while staying safe.",
  },
  "goal-strength": {
    group: "setup", title: "Get stronger",
    what: "Aim to lift heavier. Big lifts for 4 to 6 reps with long rests, small lifts for 8 to 12.",
    example: "Squat 3 x 4 to 6 with 3 minutes rest.",
    why: "Heavier weights for fewer reps teach your body to use more muscle at once.",
  },
  "goal-fat": {
    group: "setup", title: "Lose fat",
    what: "Keep your muscle while you eat less. 10 to 15 reps with shorter rests keep the session moving.",
    example: "Lunges 3 x 12 to 15 with 75 seconds rest.",
    why: "Fat loss comes mostly from food. Lifting tells your body to keep its muscle while the scale goes down.",
  },
  "goal-fit": {
    group: "setup", title: "Stay fit",
    what: "A balanced mix for health and energy. 10 to 12 reps, the whole body each week.",
    example: "Full body twice a week, 45 minutes.",
    why: "Regular strength training helps your heart, bones, sleep and mood.",
  },
  "goal-custom": {
    group: "setup", title: "Something else",
    what: "Write your own goal in a few words. The plan uses balanced settings you can change.",
    example: "\"Stronger back for climbing\" or \"Get ready for ski season\".",
    why: "Your words are saved with the plan, so you remember why you started.",
  },
  experience: {
    group: "setup", title: "Experience",
    what: "How long you have been lifting. New: under 6 months. Some: 6 months to 2 years. Experienced: over 2 years.",
    example: "Been to the gym on and off for a year: pick Some.",
    why: "New lifters get machines and fewer sets, which are easier to learn and safer. Experienced lifters get free weights and more sets.",
  },
  equipment: {
    group: "setup", title: "Equipment",
    what: "What you can train with. Full gym has everything; Dumbbells only; Home has dumbbells and a kettlebell; Bodyweight uses no weights.",
    example: "Pick Home if you have a couple of dumbbells and a kettlebell.",
    why: "The plan only picks exercises you can actually do where you train.",
  },
  "session-length": {
    group: "setup", title: "Session length",
    what: "About how long one workout should take, rests included.",
    example: "45 minutes fits about 4 exercises of 3 sets.",
    why: "A plan that fits your time is one you will keep doing.",
  },
  "days-week": {
    group: "setup", title: "Days per week",
    what: "How many days a week you can train. It also becomes your week goal.",
    example: "3 days: a full body plan. 4 days: Upper and Lower.",
    why: "Two or three good days beat five you cannot keep. You can change it any time.",
  },
  avoid: {
    group: "setup", title: "Areas to go easy on",
    what: "Joints or body parts that hurt or that you want to protect. Exercises that load them hard are left out.",
    example: "Pick Knees and the plan leaves out squats and lunges, and uses leg curls and bridges.",
    why: "Training around a sore spot keeps you training. For real pain, see a doctor or physio first.",
  },
});

export type TermKey = keyof typeof GLOSSARY;
export const TERM_KEYS = Object.keys(GLOSSARY) as TermKey[];
export const term = (k: TermKey): Term => GLOSSARY[k];
export const isTerm = (k: unknown): k is TermKey => typeof k === "string" && Object.prototype.hasOwnProperty.call(GLOSSARY, k);
/** The short line for a hover card (the hover card keeps 140 characters). */
export const tipLine = (k: TermKey): string => { const w = GLOSSARY[k].what; return w.length <= 140 ? w : `${w.slice(0, 137).replace(/\s+\S*$/, "")}...`; };

/** Every Fitness setting (the "fit" record) and the word that explains it. null: kept by the app, never shown as a
 *  setting. Typed against FitPrefs: a new setting with no line here fails tsc. */
export const PREF_TERMS: { [K in keyof Required<FitPrefs>]: TermKey | null } = {
  style: "look",
  programId: "program",
  lock: "repeat-day",
  restCompound: "long-rest",
  restIsolation: "short-rest",
  restBy: "own-rest",
  restKind: "own-rest",
  setsDefault: "sets-default",
  setsBy: "own-sets",
  sound: "rest-sound",
  scan: "gym-scan",
  weekGoal: "week-goal",
  sleepTarget: "sleep-settings",
  sleepAsk: "sleep-settings",
  sleepSkip: null,
  sleepShare: "squad-sharing",
  sleepOpen: null,
  setup: "setup",
  setupDone: null,
  at: null,
};
/** The gym reminder lives in the main settings record (core/gym.ts GymPrefs). */
export const GYM_TERMS = { on: "gym-reminder", time: "gym-reminder", end: "gym-reminder", days: "gym-reminder", nag: "gym-reminder", nagStart: "gym-reminder", nagEvery: "gym-reminder", ringAt: "gym-reminder" } as const satisfies Record<string, TermKey>;
/** Each group in Fitness settings and its word (tested against the Section titles in FitSettings.tsx). */
export const SETTINGS_SECTIONS: Record<string, TermKey> = {
  "Look": "look",
  "Rest between sets": "rest",
  "Sets": "sets-default",
  "Week goal": "week-goal",
  "Which day": "repeat-day",
  "Gym reminder": "gym-reminder",
  "Sleep": "sleep-settings",
  "Gym scan": "gym-scan",
  "On the Mac": "rest-sound",
  "G Squad sharing": "squad-sharing",
  "Set up your training": "setup",
};
