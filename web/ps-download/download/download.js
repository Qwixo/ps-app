// The PS download page: version and size from release.json, the Copy button, and the optional
// PS Middle Clicker download once it has an address (MIDDLE below; hidden while it is null).
(function () {
  // Hidden until the developer approves both pages (31 Oct 2026). Then set (a link, never a copy: it gets rebuilt):
  // { url: "https://ps-middleclicker.netlify.app/PSMiddleClicker.zip", info: "PSMiddleClicker.zip, 400 KB, macOS 14 or later" }
  // (or the cincee.com/middle-click address once that is live).
  var MIDDLE = null;
  var $ = function (id) { return document.getElementById(id); };
  var mb = function (n) { return (n / 1000000).toFixed(1) + " MB"; };

  fetch("../release.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (r) {
    if (!r || !r.mac) return;
    var v = (r.name || "") + (r.keyword ? " · " + r.keyword : "");
    $("ver").textContent = (v ? v + ", " : "") + "macOS " + (r.mac.minMacOS || "13.0").replace(/\.0$/, "") + " or newer, Apple silicon";
    $("dmgInfo").textContent = "PS.dmg, " + mb(r.mac.size);
  }).catch(function () {});

  var b = $("copy");
  b.addEventListener("click", function () {
    var done = function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText($("cmd").textContent).then(done, function () {});
  });

  if (MIDDLE && /^https:\/\//.test(MIDDLE.url)) {
    $("mcLink").href = MIDDLE.url;
    $("mcInfo").textContent = MIDDLE.info || "";
    $("mc").classList.remove("hidden");
  }
})();
