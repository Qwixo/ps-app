// Goals "How it works" video (V1.40): the links, the Mac fallback and the narrow frame rules.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GOALS_VIDEO, VIDEO_FRAME_HOST, canEmbedVideo } from "../src/core/goalsvideo.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

ok("embed is the privacy friendly host, starts at 0:27, no tracking part", () => {
  const u = new URL(GOALS_VIDEO.embed);
  assert.equal(u.protocol, "https:");
  assert.equal(u.host, "www.youtube-nocookie.com");
  assert.equal(u.pathname, "/embed/4FrMN6f-4OM");
  assert.equal(u.searchParams.get("start"), "27");
  assert.equal(u.searchParams.get("si"), null);
  assert.equal(VIDEO_FRAME_HOST, u.host);
});

ok("Open on YouTube is the normal link at 0:27, without the si part", () => {
  const u = new URL(GOALS_VIDEO.watch);
  assert.equal(u.host, "youtu.be");
  assert.equal(u.pathname, "/4FrMN6f-4OM");
  assert.equal(u.searchParams.get("t"), "27");
  assert.equal(u.searchParams.get("si"), null);
});

ok("embed everywhere except the Mac app's ps:// pages", () => {
  assert.equal(canEmbedVideo("https:"), true);
  assert.equal(canEmbedVideo("http:"), true);
  assert.equal(canEmbedVideo("ps:"), false);
});

const frameSrc = (csp: string) => (csp.match(/frame-src ([^;"`]+)/) || [])[1]?.trim().split(/\s+/);

ok("website and phone page policies allow only blob: and the video host as frames", () => {
  const post = readFileSync(new URL("../scripts/postbuild.mjs", import.meta.url), "utf8");
  assert.deepEqual(frameSrc(post), ["blob:", "https://www.youtube-nocookie.com"]);
  const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.deepEqual(frameSrc(vite), ["blob:", "https://www.youtube-nocookie.com"]);
  assert.match(post, /frame-ancestors 'none'/);
});

ok("the frame is only rendered inside the open pop-up, with a referrer YouTube can see", () => {
  const src = readFileSync(new URL("../src/views/Goals.tsx", import.meta.url), "utf8");
  assert.equal((src.match(/<iframe/g) || []).length, 1);
  assert.match(src, /\{video && <GoalsVideo /);
  assert.match(src, /referrerPolicy="strict-origin-when-cross-origin"/);
  assert.match(src, /This is how it works, explained by the idea it came from/);
  assert.doesNotMatch(src + readFileSync(new URL("../src/core/goalsvideo.ts", import.meta.url), "utf8"), /[\u2013\u2014]/);
});

console.log(`goalsvideo: ${n} passed`);
