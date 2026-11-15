// G Squad emoji (PS 1.63, feature "gsquad-signal"): a small built in set with names, so the picker needs no package and no
// network. Plain data and two pure functions (search by name, keep the recent ones); views/GSquadPickers.tsx draws it.
// Each entry is "emoji name words, more words": the first words are the name, the rest are what people type to find it.
export interface EmojiGroup { id: string; label: string; icon: string; list: string[] }

export const EMOJI_GROUPS: EmojiGroup[] = [
  { id: "smileys", label: "Smileys", icon: "😀", list: [
    "😀 grinning face, happy", "😃 smiling face big eyes, happy", "😄 smiling eyes, happy joy", "😁 beaming face, grin", "😆 laughing squinting, haha",
    "😅 grinning sweat, phew", "🤣 rolling on the floor laughing, lol rofl", "😂 tears of joy, lol funny", "🙂 slight smile", "🙃 upside down face, silly",
    "😉 winking face, wink", "😊 smiling blushing, happy shy", "😇 smiling halo, angel", "🥰 smiling hearts, love", "😍 heart eyes, love",
    "🤩 star struck, wow", "😘 blowing a kiss, kiss", "😗 kissing face", "☺️ smiling face", "😚 kissing closed eyes",
    "😋 yum, tasty delicious", "😛 tongue out", "😜 winking tongue, crazy", "🤪 zany face, wild", "😝 squinting tongue",
    "🤑 money mouth, rich", "🤗 hugging face, hug", "🤭 hand over mouth, oops", "🤫 shushing face, quiet secret", "🤔 thinking face, hmm",
    "🤐 zipper mouth", "🤨 raised eyebrow, suspicious", "😐 neutral face", "😑 expressionless", "😶 no mouth, speechless",
    "😏 smirking, smug", "😒 unamused, meh", "🙄 rolling eyes, whatever", "😬 grimacing, awkward", "😮‍💨 exhaling, relief sigh",
    "🤥 lying face", "😌 relieved, calm", "😔 pensive, sad", "😪 sleepy", "🤤 drooling",
    "😴 sleeping, zzz tired", "😷 face mask, sick", "🤒 thermometer face, ill", "🤕 bandage head, hurt", "🤢 nauseated, sick",
    "🤮 vomiting", "🥵 hot face, heat", "🥶 cold face, freezing", "🥴 woozy, drunk", "😵 dizzy face",
    "🤯 exploding head, mind blown", "🤠 cowboy hat", "🥳 partying face, celebrate party", "😎 sunglasses, cool", "🤓 nerd face",
    "🧐 monocle, curious", "😕 confused", "😟 worried", "🙁 slightly frowning", "☹️ frowning",
    "😮 open mouth, wow surprised", "😯 hushed", "😲 astonished, shocked", "😳 flushed, embarrassed", "🥺 pleading face, please puppy",
    "😦 frowning open mouth", "😧 anguished", "😨 fearful, scared", "😰 anxious sweat", "😥 sad relieved",
    "😢 crying face, sad tear", "😭 loudly crying, sob", "😱 screaming in fear", "😖 confounded", "😣 persevering",
    "😞 disappointed", "😓 downcast sweat", "😩 weary", "😫 tired face", "🥱 yawning, bored",
    "😤 steam from nose, triumph", "😡 pouting, angry mad", "😠 angry face", "🤬 cursing, swearing", "😈 smiling devil",
    "💀 skull, dead", "💩 pile of poo", "🤡 clown", "👻 ghost", "👽 alien", "🤖 robot",
  ] },
  { id: "people", label: "People", icon: "👍", list: [
    "👍 thumbs up, yes like ok", "👎 thumbs down, no dislike", "👌 ok hand, perfect", "🤌 pinched fingers, italian", "✌️ victory hand, peace",
    "🤞 crossed fingers, luck hope", "🤟 love you gesture", "🤘 sign of the horns, rock", "🤙 call me hand", "👈 pointing left",
    "👉 pointing right", "👆 pointing up", "👇 pointing down", "☝️ index pointing up", "✋ raised hand, stop high five",
    "🖐️ hand with fingers splayed", "🖖 vulcan salute", "👋 waving hand, hello bye", "🤚 raised back of hand", "👏 clapping hands, applause bravo",
    "🙌 raising hands, celebration hooray", "👐 open hands", "🤲 palms up together", "🤝 handshake, deal", "🙏 folded hands, thanks please pray",
    "✍️ writing hand", "💪 flexed biceps, strong gym muscle", "🦵 leg", "🦶 foot", "👂 ear", "👃 nose", "👀 eyes, look",
    "👁️ eye", "🧠 brain", "🫶 heart hands, love", "🫡 saluting face, salute", "🫠 melting face", "🫣 peeking face",
    "🙋 person raising hand", "🙆 person gesturing ok", "🙅 person gesturing no", "🤷 person shrugging, idk", "🤦 person facepalming, facepalm",
    "🙇 person bowing, sorry", "💃 woman dancing, dance", "🕺 man dancing, dance", "🏃 person running, run", "🚶 person walking, walk",
    "🏋️ person lifting weights, gym", "🚴 person biking, bike cycling", "🏊 person swimming, swim", "🧘 person in lotus position, yoga",
    "👶 baby", "🧒 child", "👦 boy", "👧 girl", "🧑 person", "👨 man", "👩 woman", "🧓 older person", "👴 old man", "👵 old woman",
  ] },
  { id: "hearts", label: "Hearts", icon: "❤️", list: [
    "❤️ red heart, love", "🧡 orange heart", "💛 yellow heart", "💚 green heart", "💙 blue heart", "💜 purple heart", "🖤 black heart",
    "🤍 white heart", "🤎 brown heart", "💔 broken heart, sad", "❣️ heart exclamation", "💕 two hearts", "💞 revolving hearts",
    "💓 beating heart", "💗 growing heart", "💖 sparkling heart", "💘 heart with arrow", "💝 heart with ribbon, gift",
    "💯 hundred points, perfect", "💢 anger symbol", "💥 collision, boom", "💫 dizzy", "💦 sweat droplets", "💨 dashing away",
    "🔥 fire, hot lit", "✨ sparkles, shiny new", "⭐ star", "🌟 glowing star", "⚡ high voltage, lightning", "🎉 party popper, congratulations",
    "🎊 confetti ball", "🎈 balloon", "🏆 trophy, win winner", "🥇 first place medal, gold", "🥈 second place medal", "🥉 third place medal",
  ] },
  { id: "animals", label: "Animals", icon: "🐶", list: [
    "🐶 dog face, puppy", "🐱 cat face, kitten", "🐭 mouse face", "🐹 hamster", "🐰 rabbit face, bunny", "🦊 fox", "🐻 bear",
    "🐼 panda", "🐨 koala", "🐯 tiger face", "🦁 lion", "🐮 cow face", "🐷 pig face", "🐸 frog", "🐵 monkey face", "🙈 see no evil monkey",
    "🙉 hear no evil monkey", "🙊 speak no evil monkey", "🐔 chicken", "🐧 penguin", "🐦 bird", "🦆 duck", "🦉 owl", "🦄 unicorn",
    "🐝 honeybee, bee", "🦋 butterfly", "🐢 turtle", "🐍 snake", "🐙 octopus", "🐬 dolphin", "🐳 whale", "🦈 shark", "🐘 elephant",
    "🐎 horse", "🌳 tree", "🌴 palm tree", "🌵 cactus", "🌸 cherry blossom, flower", "🌹 rose", "🌻 sunflower", "🍀 four leaf clover, luck",
    "🌈 rainbow", "☀️ sun, sunny", "🌙 crescent moon", "☁️ cloud", "🌧️ rain cloud", "❄️ snowflake, snow", "🌊 water wave, sea",
  ] },
  { id: "food", label: "Food", icon: "🍕", list: [
    "🍎 red apple", "🍌 banana", "🍇 grapes", "🍓 strawberry", "🍉 watermelon", "🍑 peach", "🍍 pineapple", "🥑 avocado", "🥦 broccoli",
    "🥕 carrot", "🌽 corn", "🍞 bread", "🧀 cheese", "🍳 cooking egg", "🥓 bacon", "🍔 hamburger, burger", "🍟 french fries, chips",
    "🍕 pizza", "🌭 hot dog", "🌮 taco", "🌯 burrito", "🥗 green salad", "🍝 spaghetti, pasta", "🍣 sushi", "🍜 steaming bowl, noodles ramen",
    "🍦 soft ice cream", "🍩 doughnut, donut", "🍪 cookie", "🎂 birthday cake", "🍰 shortcake", "🍫 chocolate bar", "🍿 popcorn",
    "☕ hot beverage, coffee tea", "🍵 teacup", "🥤 cup with straw", "🍺 beer mug, beer", "🍻 clinking beer mugs, cheers", "🍷 wine glass",
    "🥂 clinking glasses, toast champagne", "🍸 cocktail glass", "🥛 glass of milk", "💧 droplet, water",
  ] },
  { id: "activity", label: "Activity", icon: "⚽", list: [
    "⚽ soccer ball, football", "🏀 basketball", "🏈 american football", "⚾ baseball", "🎾 tennis", "🏐 volleyball", "🏉 rugby",
    "🎱 pool 8 ball", "🏓 ping pong", "🏸 badminton", "🥊 boxing glove", "🥋 martial arts uniform", "⛳ flag in hole, golf", "⛸️ ice skate",
    "🎿 skis", "🏂 snowboarder", "🎯 direct hit, target bullseye", "🎮 video game, gaming", "🎲 game die, dice", "🧩 puzzle piece",
    "🎸 guitar", "🎹 musical keyboard, piano", "🎤 microphone, karaoke", "🎧 headphone, music", "🎬 clapper board, movie", "🎨 artist palette, art",
    "📚 books, read", "🏖️ beach", "⛺ tent, camping", "🏔️ snow capped mountain",
  ] },
  { id: "travel", label: "Travel", icon: "🚗", list: [
    "🚗 automobile, car", "🚕 taxi", "🚌 bus", "🏎️ racing car", "🚓 police car", "🚑 ambulance", "🚒 fire engine", "🚲 bicycle, bike",
    "🛵 motor scooter", "🏍️ motorcycle", "🚆 train", "🚇 metro", "✈️ airplane, flight plane", "🚀 rocket, launch", "🛸 flying saucer",
    "🚁 helicopter", "⛵ sailboat", "🚢 ship", "⚓ anchor", "🏠 house, home", "🏢 office building", "🏥 hospital", "🏫 school",
    "🏰 castle", "🗽 statue of liberty", "🗼 tokyo tower", "🌍 globe europe africa, world earth", "🌎 globe americas", "🌏 globe asia",
    "🗺️ world map", "🧭 compass", "🌅 sunrise", "🌃 night with stars", "🌆 cityscape at dusk",
  ] },
  { id: "objects", label: "Objects", icon: "💡", list: [
    "⌚ watch", "📱 mobile phone", "💻 laptop, computer", "⌨️ keyboard", "🖥️ desktop computer", "🖨️ printer", "📷 camera", "📹 video camera",
    "📞 telephone", "📺 television", "⏰ alarm clock", "⏳ hourglass", "💡 light bulb, idea", "🔋 battery", "🔌 electric plug", "💰 money bag",
    "💵 dollar banknote, cash", "💳 credit card", "💎 gem stone, diamond", "🔧 wrench", "🔨 hammer", "⚙️ gear", "🔒 locked, lock", "🔓 unlocked",
    "🔑 key", "📧 e mail, email", "📨 incoming envelope", "📩 envelope with arrow", "📦 package, box delivery", "📝 memo, note", "📋 clipboard",
    "📅 calendar", "📌 pushpin", "📎 paperclip", "✂️ scissors", "📈 chart increasing, growth", "📉 chart decreasing", "🔔 bell, notification",
    "🔕 bell with slash, mute", "📢 loudspeaker", "💬 speech balloon, chat", "💭 thought balloon", "🗑️ wastebasket, trash", "🧹 broom, clean",
    "🎁 wrapped gift, present", "🛒 shopping cart", "🔍 magnifying glass, search", "🔦 flashlight",
  ] },
  { id: "symbols", label: "Symbols", icon: "✅", list: [
    "✅ check mark button, done yes", "☑️ check box", "✔️ check mark", "❌ cross mark, no wrong", "❎ cross mark button", "❓ question mark", "❔ white question mark",
    "❗ exclamation mark", "‼️ double exclamation", "⚠️ warning", "🚫 prohibited, no", "⛔ no entry", "🛑 stop sign", "♻️ recycling symbol",
    "➕ plus", "➖ minus", "➗ divide", "✖️ multiply", "➡️ right arrow", "⬅️ left arrow", "⬆️ up arrow", "⬇️ down arrow", "🔄 counterclockwise arrows, refresh",
    "🔁 repeat", "🆗 ok button", "🆕 new button", "🆒 cool button", "🔴 red circle", "🟠 orange circle", "🟡 yellow circle", "🟢 green circle",
    "🔵 blue circle", "🟣 purple circle", "⚫ black circle", "⚪ white circle", "▶️ play button", "⏸️ pause button", "⏹️ stop button",
    "🔊 speaker high volume", "🔇 muted speaker", "🏁 chequered flag, finish", "🚩 triangular flag",
  ] },
];

export interface EmojiItem { e: string; name: string; words: string; group: string }
const ITEMS: EmojiItem[] = EMOJI_GROUPS.flatMap((g) => g.list.map((row): EmojiItem => {
  const sp = row.indexOf(" ");
  const rest = row.slice(sp + 1);
  const c = rest.indexOf(",");
  return { e: row.slice(0, sp), name: (c < 0 ? rest : rest.slice(0, c)).trim(), words: c < 0 ? "" : rest.slice(c + 1).trim().toLowerCase(), group: g.id };
}));
export const allEmoji = (): EmojiItem[] => ITEMS;

/** Search by name: every word you type must start a word of the name or of its extra words. Names that start with it
 *  come first. Nothing typed gives nothing (the picker then shows the groups). */
export function searchEmoji(q: string, max = 64): EmojiItem[] {
  const terms = q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).slice(0, 4);
  if (!terms.length) return [];
  const out: { it: EmojiItem; rank: number }[] = [];
  for (const it of ITEMS) {
    const words = `${it.name.toLowerCase()} ${it.words}`.replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
    if (!terms.every((t) => words.some((w) => w.startsWith(t)))) continue;
    const nameFirst = it.name.toLowerCase().startsWith(terms[0]);
    out.push({ it, rank: nameFirst ? 0 : it.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(terms[0])) ? 1 : 2 });
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, max).map((x) => x.it);
}

/** The recent list: newest first, no repeats, at most `max`, only emoji the set knows or a clean single emoji. */
export function pushRecent(list: string[], e: string, max = 18): string[] {
  return [e, ...list.filter((x) => x !== e)].slice(0, max);
}
