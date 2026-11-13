# Layers

PS is built from **core** (this repo: `web/`, `mac/`, `phone/`) and, for a person's own build, **one layer** on top.

* No layer: the **G Squad build**, everyone's shared work (profile `profiles/gsquad.json`).
* Core + your layer: **your build**. Your layer holds what only you run. It lives in your own private repo or
  folder, never in this repo.

## What a layer is

A folder with a `layer.json`, a `profile.json` and your files at the same paths as in core:

```
my-layer/
  layer.json
  profile.json
  features.json      (optional: your private features)
  web/ mac/ phone/
```

`layer.json`:

```json
{
  "schema": 1,
  "name": "sam",
  "owner": "your-github-login",
  "replace": { "web": ["src/core/privatenotes.ts"] },
  "add":     { "web": ["src/mine/thing.ts"] },
  "remove":  { "mac": [] },
  "pinned":  { "web/src/core/tz.ts": "<git blob id of core's file when you changed it>" },
  "local":   { "web": [".env"] },
  "audit":   null
}
```

* `replace`: a **plug point** of core (listed in `layers/plugpoints.json`): a core file that does nothing in the
  G Squad build and that your layer swaps for a real one at the same path, with the same export names.
* `add`: a file core does not have.
* `remove`: a core file your layer takes out (for example `mac/Sources/DeveloperOnly.swift` when you give the real
  Swift files it stands in for).
* `pinned`: a core file you changed for yourself. When core's file moves on, the build merges both changes; if they
  clash it stops and names the file. `--repin` keeps a clean merge.
* `local`: files copied when they exist but never committed anywhere (your `.env`).
* `roots` (optional): where your `web`, `mac` and `phone` files are, if not in those folders next to `layer.json`.
* `audit` (optional): a command that checks outgoing files before you push to core (see the guard below).
* Lists may use `*` and `**`.

## Building

```bash
node tools/build.mjs gsquad all --check --tests      # the G Squad build: tsc, web tests, Swift typecheck, phone compile
node tools/build.mjs ../my-layer/layer.json web      # your build's web part (dist-ps)
node tools/build.mjs ../my-layer/layer.json mac      # your Mac app (build/PS.app, not installed)
```

The tree is assembled in `.build/<name>/` (never committed). Each build carries `ps-build.json` (which build, the
commits it came from, the full profile): the web page reads it as `__PS_BUILD__`, the Mac app and the phone app as
`ps-build.json` and `profile.json` in their resources.

If you need a new export from a plug point, add it to the plug point in core (doing nothing). A layer that does
not give it yet stops at `tsc` or the Swift typecheck: that is how a layer owner learns core moved.

## The guard

```bash
node tools/guard.mjs --install --layer ../my-layer/layer.json
```

Every push from your core clone is then checked: no file your layer adds, no file with the same content as one of
yours, nothing from `.build/`, and your layer's own `audit` command must pass. GitHub checks every pull request
again (term audit, `release/audit.py --source`, gitleaks).

## The example

`layers/example/` is a tiny layer the checks build on every pull request, so the way layers plug in always works.
