// The Goals "How it works" video: the idea the goal levels came from.
// Nothing loads from YouTube until its pop-up opens (views/Goals.tsx). The embed uses the privacy
// friendly youtube-nocookie host, the only frame host the page policies allow (website headers in
// scripts/postbuild.mjs, the phone page in vite.config.ts and ps-gos WebHost.kt).

export const VIDEO_FRAME_HOST = "www.youtube-nocookie.com";
const ID = "4FrMN6f-4OM";
const START = 27;   // seconds

export const GOALS_VIDEO = {
  embed: `https://${VIDEO_FRAME_HOST}/embed/${ID}?start=${START}&rel=0&modestbranding=1&playsinline=1`,
  watch: `https://youtu.be/${ID}?t=${START}`,
};

/** The Mac app's pages live at ps:// and WebKit sends no referrer from there (checked with a test
 *  WKWebView on 7 Nov 2026), and YouTube needs one before it plays an embed. So on the Mac the pop-up
 *  opens the video in the browser instead of embedding it. */
export const canEmbedVideo = (protocol: string) => protocol !== "ps:";
