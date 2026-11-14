# Features and how to switch each one off

Every feature in the public app, in one or two lines, with its off switch. "Settings, X" means the Settings screen,
group X (the search box at the top finds any of these by name). Panels and buttons in the Tab list can also be
removed in Edit mode (top left), but that only hides them; the switches below are what turn a feature off.

## Things that run by themselves

| Feature | What it does | Default | Off switch |
| --- | --- | --- | --- |
| Update checks | Looks at cincee.com for a new version. Never installs without your click. | Every 5 min | Settings, About and updates, "Check for updates every": Off. "Check now" still works. |
| G Squad auto join | Joins The G Squad, the shared space with other PS users, after you sign in. | On | Settings, G Squad, "Join The G Squad automatically". Leave the squad in G Squad's own settings. |
| G Squad sharing | What members see: working status, money, screen time total, fitness, sleep; tasks only if you mark them. | On (tasks off) | Settings, G Squad, "What you share", one switch per piece. |
| PS presence | Lets the website know PS is open on your Mac, so the website leaves Tab to it. | On | Settings, Privacy and sharing, "Tell the website PS app is open". |
| Screen time (Mac) | Counts time per app in front; totals saved encrypted. | On | Settings, Time and reset, "Track my screen time". |
| Screen time (phone) | Reads Android's usage totals once you grant Usage access. | On | Settings, Time and reset, "Track my screen time" (or remove Usage access). |
| AFK timer | Notices when you step away from the Mac. | On | Settings, Mac, "AFK timer". |
| Network monitor | Live connection status, per app traffic while its panel is open, and a "Last online" check. Local only. | On | Settings, Mac, "Network monitor". |
| Phone background checks | Keeps alarms and the vault fresh while the app is closed. | On | Settings, Notifications and Do Not Disturb, "Background checks" (phone). |
| Daily reminder | "Have you done your daily task yet?" between 02:00 and 06:00. | On | Settings, Annoying 15 min reminder, the reminder's own switch. |
| Restart helper reminder | Pop up asking you to set up the restart helper. | On | Settings, Privacy and sharing, Security, "Remind me to set up the restart helper". |
| First use tips | Short tip cards the first few times you use PS. | On | Settings, About and updates, "Show first use tips". |
| Are you sure (Mac) | Asks before you open sites you chose (YouTube and Netflix to start with). | On | Settings, Privacy and sharing, Security, "Are you sure". |
| Are you sure (phone) | Same on the phone. | Off | Phone settings, "Are you sure". |

## The Mac app

| Feature | What it does | Off switch |
| --- | --- | --- |
| Tab overlay | Hold Tab over any app to see your list. | Menu bar icon, "Tab Overlay: On". Keys: Settings, Keyboard and Tab. |
| Dynamic Island | A small island at the notch for the time, meetings and notifications. | Settings, Mac, Dynamic Island, "Show it": Off. |
| Island notifications | Cards come out of the island instead of the top right. | Settings, Mac, Dynamic Island, "Notifications come from the Dynamic Island". |
| Island moments | The island squeezes in a little and bounces out into each card, one card at a time, reminders and the update card shrink back in, the island ticks "Database loaded" and "Updated", and What's new comes out of the island. | Settings, Mac, Dynamic Island, "Island sounds" for the chime. The whole feature: Settings, From the squad, "Island moments". |
| Welcome back on the island | After you were away from the Mac for a while (15 minutes unless changed), the island grows into a panel with the tasks you were working on, so you can tick the ones you finished. Never during screen sharing, a full screen app or Do Not Disturb. | Settings, Notifications, "Welcome back on the island" and how many minutes. The whole feature: Settings, From the squad, "Welcome back on the island". |
| Workout summary on the Mac | After a workout you finished on your phone, the first time you are back at the Mac, the island says "Workout complete" and shows your exercises, best sets, time in the gym and how each compares with last time. Once per workout. | Settings, Notifications, "Workout summary on the Mac". The whole feature: Settings, From the squad, "Workout summary on the Mac". |
| Notification pop ups | PS's own pop up cards. | Settings, Notifications and Do Not Disturb, "Notification pop-ups". |
| Meetings from this Mac's Calendar | Shows your Calendar meetings, read only. | Settings, Notifications and Do Not Disturb, "Meetings from this Mac's Calendar". |
| Meeting alerts | A warning before a meeting starts. | Settings, Notifications and Do Not Disturb, "Meetings". |
| Do Not Disturb | Quiets PS for a while. | Off until you start it. |
| AI chat finished cards | A card when a Claude Code chat finishes. Writes a hook into that tool's settings only when switched on. | Off for new installs. Settings, Notifications and Do Not Disturb, "AI chat finished cards". |
| Volume mixer | Turn each app up, down or off. Only touches apps you change. | Leave the sliders alone, or remove the button in Edit mode. |
| Headphones auto switch | Moves sound to your headphones when they connect. | Off by default, inside the mixer. |
| AirPods card | Hands the AirPods play button back to Spotify or Music. | Off by default. Settings, Mac, "AirPods card". |
| Force Touch middle click | A firm click acts as a middle click. | Off by default. Settings, Keyboard and Tab. |
| Lock and Touch ID | Lock PS; unlock with your fingerprint or passphrase. | Use it or not. |
| Sleep mode | A full screen clock and alarm for the night. | Starts only when you start it. |
| Sentry mode | Covers and guards the Mac while you are away. | Starts only when you start it. "Keep awake with the lid closed" and "Restart if not unlocked" are inside it. |
| Auto reboot | Restarts the Mac on a schedule, using the restart helper. | Settings, Privacy and sharing, Security, "Auto reboot": Off. Nothing is installed until you click Set up. |
| 1Password and Signal protection | PS stays out of those two apps. | Always on, on purpose. |
| Soundboard | Play short sounds. | Opens only when you use it. |
| Rain, storm, mouse trail | Visual effects. | Off by default. Settings, Appearance. |
| NEW badges | A NEW badge on tasks added in the last few minutes. | Settings, Your list, "NEW badges". |
| AI task API | Lets an AI tool on this Mac (Claude Code, Codex) read, add and manage your tasks through a local address only this Mac can reach, with a key. | Off by default. Settings, AI task API. "What an AI may do" has one switch per action (read, add and the AI Inbox start on; all lists, rename, edit, tick, delete and reminders start off). |
| AI Inbox | Its own column in Dimension X for tasks an AI adds. | Fills only through the AI task API. |
| Copy for AI | Copies the API's instructions and its key to your clipboard, to paste into an AI tool. | Only when you click it. |
| Auto approve | Says Yes to AI coding tools' permission prompts (Claude Code, Codex) while you are away. See PERMISSIONS.md. Settings warns: a web page or file can trick an AI into harm, and nothing then stops it. | Every switch off by default. Settings, Sentry mode, Auto approve: "In AI mode", "In Sleep mode", "Always auto approve". |
| Island in full screen | The island shows over full screen apps and glides to the top left. | Settings, Mac, Dynamic Island, "Move to the top left in full screen" (on by default). |
| Tick circle side | Which side of the island the tick circle sits on. | Settings, Mac, Dynamic Island, "Tick circle side". |
| Private mode label | In a meeting, the island says it is in private mode; a click turns private mode off. | Settings, Notifications and Do Not Disturb, "Meetings". |
| Connect your own Supabase | Keep your vault on your own server. | Optional: at setup, or Settings, Sync and account, "Supabase project". |

## Everywhere (Mac, phone, website)

| Feature | What it does | Off switch |
| --- | --- | --- |
| Tasks and lists | Your to do list, with pages you swipe between, priorities, mini tasks and reminders. | The app itself. |
| Task reminders | A repeating reminder on any task. | Per task, right click or edit. |
| Dimension X, Timelines, Goals, Time zones, Series map | Planning panels in the Tab list. | Open only when you open them; remove in Edit mode. |
| Notes | Notes next to your list. | Open only when you open them. |
| Clients, portals, pipeline, proposals | Keep clients and share an encrypted portal with them. | Open only when you open them. |
| Email drafts | Write drafts. Nothing is sent from there. | Open only when you open them. |
| Fitness | Workouts, rest timer and a gym reminder. | Gym reminder off by default; the rest only while a workout is open. |
| Telegram bot | Text tasks to your own Telegram bot and they land on your list. | Nothing runs without your bot key. Settings, Add Telegram Bot, "Remove bot". |
| Link your iPhone or phone | Sign a phone in by QR code. | Only when you start it. |
| Local first | Keep everything on this Mac only, no server. | Chosen at setup. |
| Export my data | An encrypted backup file, and bringing one back in. | Settings, Sync and account. Only when you click it. |
| What's new | Shows the changes once per version. | Shown once. |

## New in V1.59

- Phone island: on your phone, a small live island around the camera shows over every app: your next meeting, Pomodoro breaks, stand-ups, reminders and AI messages. Tap it to open PS.
- Faster phone notifications: client emails, AI messages and finished chats now arrive within seconds instead of up to 15 minutes.
- Scan a machine: in a workout, point your phone at a machine's label, even in German, and PS finds the exercise, adds it to your workout and shows how it is done. The picture stays on your phone.
- Comments on sets: after a set, add a short note like 'seat at 4' and see it later in your workout history.
- New exercise: Abs cable crunch, with its own little figure.
- Reply in the email panel: write a reply right in the email card on your phone, the website or your Mac, with a few seconds to undo.
- Stand-up reminders are now on for everyone and show big in the middle of the island. The first time, PS asks if you want them off.
- The next meeting bubble on the island now always shows its full time.
- Completed tasks open on the last 24 hours, with More at the bottom for the rest.

## New in V1.58

- Pomodoro timer: a new button in the Tab overlay. Set your own work and break times, and during a break the island turns into a countdown, then shows a green tick and "Now back to work".
- Stand-up reminders: PS reminds you to stand up. In the last 15 seconds a small tab on the island counts you down, then the island shows a little man standing for as long as you choose.
- Next meeting on the island: a small bubble counts down to your next meeting, turns into a Join button in the last 2 minutes, and shows the time left while it runs.
- Island: drag it into the black bar at the top of the screen and right into the corners, or let it sit in the top bar whenever an app is full screen.
- Right click the island's grey bar for Settings, or to hide the island until your meeting ends or for a time you pick.
- Island settings now open in a wider, neater window, and live in their own Dynamic island tab in Settings.
- Smoother page swipes: the page follows your fingers and settles gently, and buttons no longer jump along and vanish.
- Tab and the island now work over 1Password and Signal, and a bug that sometimes stopped Tab opening over them is fixed.
- PS is now built by more than one person: friends can add features with their own AI, every release says who made it, and in Settings, From the squad, you choose which shared features you get.
- AI messages: Claude Code, Codex and other AIs on your Mac can now send you a short message on the island when they finish, instead of just saying the chat is done. Switch it on and copy the instructions in Settings, AI task API.
- Setting up PS: the island now pops out of the setup screen and walks you through every step, with a green tick and a chime each time you get one right.

## New in V1.57

- New: alarms at any time. Your phone rings like an alarm at the times you pick, and you choose what the alarm screen says, just like the 15 minute reminders.
- Gym nag mode: from 10:00 PS reminds you every 15 minutes until you press Yes, I'm going. Set your own ring time, gym times can go past midnight, and your AI can change your gym times through the API (it can never say Yes for you).
- Completed tasks: scroll to the bottom to see every task you have finished, and Cmd + click tasks to bring back only the ones you pick.
- Fixed: a finished AI chat no longer keeps popping up again and again.
- Phone: link it faster by scanning one QR code, a smoother edit view with a Delete page button, drag with your mouse, and a bigger phone icon. Clicking a page in Edit on the Mac now keeps your list open.
- Privacy: PS now asks GitHub for updates instead of cincee.com, it no longer stores your IP address when you sign in, and The G Squad is invite only.
- Private mode: pop-ups now play no sound and shrink to a small note that hides what they say, until you click it.
- Typing P1 to P4 while editing a task now sets its priority, just like when you add one.
- Buttons in the task editor now change only when you click them, not when your mouse passes over them.
- Invert swipe: flip which way you swipe between pages in Settings, Controls, or just ask your AI to do it for you.
- Time zones: click to keep them open, so a page can show all your time zones at once.
- Time converter: it now checks your calendar and tasks and tells you if you're free for a one hour meeting at that time, and what's in the way if not.

## Not in this repo

Features that only run on the developer's own account are left out (see README.md, "What is left out"): Second Computer,
AirPods and microphone auto routing, email cards, replies and sending, the follow up radar, the Instantly inbox,
Campaigns, the Morning brief, Numerology, the PS rules, private release notes and inviting other owners. Campaigns
and the Notebook looks are also switched off for everyone (`web/src/core/features.ts`).
