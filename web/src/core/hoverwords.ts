// The hover card's words (V1.43): what a button is, in bold, and one short line on what pressing it does.
// A button can say it itself (data-tip and data-tip-line, eg the moon, the cog, G Squad, the padlock). Every other
// button that still has a browser title is looked up here by that title (any case); a title not listed here is
// split at its first full stop or colon ("Close (Esc)" becomes Close / Esc). No dashes anywhere.

type Words = readonly [name: string, line: string];

const W: Record<string, Words> = {
  // ---------- the Tab list's top bar and the row under it ----------
  "settings": ["Settings", "Every setting, in plain words"],
  "end your day": ["End your day", "Unticks your daily tasks and clears finished ones"],
  "add a task (or hold tab and press 1)": ["Add a task", "Opens Add task. Or hold Tab and press 1"],
  "history (last 24 hours)": ["Notification history", "Every card from the last 24 hours"],
  "notification pop-ups": ["Notification pop-ups", "Turns the cards in the corner on or off"],
  "screen time": ["Screen time", "Today's time per app on this Mac"],
  "screen time is off": ["Screen time is off", "Turn it on in Settings to count your day"],
  "dynamic island": ["Dynamic Island", "Its look and what it shows"],
  "private mode: hide names and messages on cards and the island": ["Private mode", "Hides names and messages on every card and the island"],
  "private mode is on: cards and the island hide names and messages": ["Private mode is on", "Click to show names and messages again"],
  "clear the clipboard (copies nothing)": ["Clear the clipboard", "Wipes whatever you last copied"],
  "clipboard cleared": ["Clipboard cleared", "Nothing is left on it"],
  "could not clear the clipboard": ["Could not clear the clipboard", "Try again in a moment"],
  "bring back the last task you ticked off (cmd+z)": ["Undo", "Brings back the last task you ticked off. Cmd+Z"],
  "keep the list up while you use other apps": ["Keep overlay", "The list stays up while you use other apps"],
  "untick to put the list away": ["Keep overlay is on", "Click to let the list hide again"],
  "see your screen; parts of the list appear only where your mouse is": ["Hover mode", "See your screen; the list shows only under your mouse"],
  "show the whole list again": ["Hover mode is on", "Click to show the whole list again"],
  "reset to default": ["Reset", "Back to the usual look"],
  "afk timer": ["AFK timer", "Counts the time you are away"],
  "morning brief": ["Morning brief", "Your day at a glance"],
  "rule book": ["Rule book", "Your rules, in your order"],
  "dimension x": ["Dimension X", "Sort what matters from what does not"],
  "follow up (fup): who is waiting on you": ["Follow up", "Who is waiting on you"],
  "goals timeline: macro, meso and micro": ["Goals timeline", "Macro, meso and micro goals"],
  "open your series map: title each month, note each day": ["Series map", "Title each month and note each day"],
  "network monitor (this mac only)": ["Network monitor", "Speeds and apps using the network on this Mac"],
  "volume mixer": ["Volume mixer", "Each app's volume on its own"],
  "mixer settings": ["Mixer settings", "Which apps show and how"],
  "their clock next to yours, and the converter": ["Time zones", "Their clock next to yours, and a converter"],
  "add a person and their time zone": ["Add a person", "Their name and time zone"],
  "lock ps now": ["Lock PS app", "Closes your vault until Touch ID or your password"],
  "lock": ["Lock", "Closes your vault until you unlock it"],
  "security": ["Security", "Auto reboot, Are you sure and signing in"],
  "auto reboot on this mac": ["Auto reboot", "Restarts this Mac after a long lock"],
  "are you sure": ["Are you sure", "A countdown before YouTube or Netflix"],
  "g squad chat": ["G Squad chat", "Message your squad"],
  "move, remove or bring back panels": ["Edit mode", "Move, remove or bring back panels"],
  "every panel back where it started": ["Reset the layout", "Every panel goes back where it started"],
  "sleep mode": ["Sleep mode", "A calm clock, your alarms, and your sleep logged"],
  "sleep mode settings": ["Sleep mode settings", "Alarms, the look and what it shows"],
  "sleep mode: a calm clock, your alarms, and your sleep logged when you wake up. right click for its settings.": ["Sleep mode", "A calm clock and your alarms. Right click for its settings"],

  // ---------- the list itself ----------
  "priority 1": ["Priority 1", "The tasks that come first"],
  "priorities": ["Priorities", "Your numbered tasks"],
  "every day": ["Every day", "Tasks that come back each day"],
  "repeating": ["Repeating", "Tasks that come back on their own"],
  "click to change": ["Change it", "Click for the other choices"],
  "click to switch": ["Switch", "Click to change it"],
  "click to edit": ["Edit", "Click to change it"],
  "double click to edit": ["Edit", "Double click to change it"],
  "double click to rename": ["Rename", "Double click to type a new name"],
  "rename": ["Rename", "Type a new name"],
  "ungroup": ["Ungroup", "Its tasks go back to Priorities and Every day"],
  "edit": ["Edit", "Change its name, notes and date"],
  "edit (double click, or enter)": ["Edit", "Or double click it, or press Enter"],
  "done": ["Done", "Ticks it off"],
  "tick off": ["Tick off", "Marks it done"],
  "ticked off": ["Ticked off", "Click to put it back on your list"],
  "untick: back on your list, where it was": ["Untick", "Back on your list, where it was"],
  "new date": ["New date", "Pick another day for it"],
  "push back one day": ["Push back a day", "It moves to tomorrow"],
  "push back one week": ["Push back a week", "It moves 7 days on"],
  "take off the list": ["Take off the list", "It leaves this list, nothing is deleted"],
  "delete": ["Delete", "Removes it. Undo brings it back"],
  "delete (backspace)": ["Delete", "Removes it. Or press Backspace"],
  "remove": ["Remove", "Takes it off"],
  "move up": ["Move up", "One place higher"],
  "move down": ["Move down", "One place lower"],
  "drag to reorder": ["Drag to reorder", "Hold and move it up or down"],
  "place in the list: 1 is the top": ["Place in the list", "1 is the top"],
  "give it a place in the numbered list": ["Numbered", "Gives it a place in the numbered list"],
  "no priority: it waits below the numbered tasks": ["No priority", "It waits below the numbered tasks"],
  "notes, how often, date, priority and client for this task": ["Advanced", "Notes, repeat, date, priority and client"],
  "completed section": ["Completed", "Tasks you ticked off today"],
  "put every task in completed back on your list (undo brings them back here)": ["Resurrect", "Puts every completed task back on your list"],
  "take these off completed (undo brings them back)": ["Clear", "Takes these off Completed. Undo brings them back"],
  "new task. click to hide this badge": ["NEW", "A fresh task. Click to hide the badge"],
  "new tasks: accept or decline": ["New tasks", "Accept or decline each one"],
  "drag onto your list, or accept or decline it": ["New task", "Drag it onto your list, or accept or decline it"],
  "priority 1 colour": ["Priority 1 colour", "The colour of your first tasks"],

  // ---------- meetings, notes and cards ----------
  "click to add reminders for this call": ["Call reminders", "Notes that show when this call starts"],
  "on every call like this": ["Every call like this", "The note shows on each call of this kind"],
  "refresh meetings from calendar": ["Refresh meetings", "Reads your Calendar again now"],
  "refresh meetings from google calendar": ["Refresh meetings", "Reads Google Calendar again now"],
  "refresh calendar": ["Refresh calendar", "Reads your calendar again now"],
  "refresh instantly": ["Refresh Instantly", "Reads your Instantly replies again now"],
  "new note": ["New note", "A blank note"],
  "new email draft": ["New email draft", "A draft for you to approve. Nothing is sent"],
  "creates a draft in emails for you to approve. nothing is sent": ["Draft an email", "Saved in Emails for your yes. Nothing is sent"],

  // ---------- screens and pop-ups ----------
  "close (esc)": ["Close", "Or press Esc"],
  "back (esc)": ["Back", "Or press Esc"],
  "back to the tab list (esc)": ["Back to the Tab list", "Or press Esc"],
  "minimise (esc): everything stays as it is": ["Minimise", "Everything stays as it is. Or press Esc"],
  "minimise": ["Minimise", "Tucks it away, nothing is lost"],
  "minimize": ["Minimise", "Tucks it away, nothing is lost"],
  "hide for 5 seconds": ["Hide for 5 seconds", "Peek at what is under it"],
  "show the menu": ["Show the menu", "The island's own menu"],
  "hide the menu": ["Hide the menu", "Tucks the island's menu away"],
  "preview": ["Preview", "See how it looks"],
  "try it": ["Try it", "Shows it once, right now"],
  "install updates": ["Install updates", "Gets the newest PS app"],
  "show the afk card": ["AFK card", "Shows the away card now"],
  "close: no bubble stays on your screen. open it again from settings": ["Close", "No bubble stays on screen. Open it again from Settings"],
};

/** The words for an old title, or null when there are none here. */
export function wordsFor(title: string): { name: string; line: string } | null {
  const w = W[title.replace(/\s+/g, " ").trim().toLowerCase()];
  return w ? { name: w[0], line: w[1] } : null;
}

/** For the tests: every entry. */
export const HOVER_WORDS: Readonly<Record<string, Words>> = W;
