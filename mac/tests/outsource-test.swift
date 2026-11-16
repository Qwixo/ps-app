// Unit tests for outsourcing (see outsource-test.sh). Fake CLI, temp git repo, temp PS folder.
import Foundation

var fails = 0, checks = 0
func check(_ ok: Bool, _ what: String, line: Int = #line) { checks += 1; if !ok { fails += 1; print("FAIL (line \(line)): \(what)") } }
func sh(_ cmd: String, cwd: String? = nil) -> (Int32, String) {
  let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/sh"); p.arguments = ["-c", cmd]
  if let c = cwd { p.currentDirectoryURL = URL(fileURLWithPath: c) }
  let pipe = Pipe(); p.standardOutput = pipe; p.standardError = pipe
  try! p.run(); let d = pipe.fileHandleForReading.readDataToEndOfFile(); p.waitUntilExit()
  return (p.terminationStatus, (String(data: d, encoding: .utf8) ?? "").trimmingCharacters(in: .whitespacesAndNewlines))
}
let fm = FileManager.default
let tmp = (NSTemporaryDirectory() as NSString).resolvingSymlinksInPath + "/ps-outsource-test-\(getpid())"
try? fm.removeItem(atPath: tmp)
try! fm.createDirectory(atPath: tmp, withIntermediateDirectories: true)
defer { try? fm.removeItem(atPath: tmp) }
let home = tmp + "/home", root = tmp + "/ps/outsource", srcDir = root + "/sources"
try! fm.createDirectory(atPath: home, withIntermediateDirectories: true)
try! fm.createDirectory(atPath: srcDir, withIntermediateDirectories: true)

// ---- the pure rules
let now = Date().timeIntervalSince1970 * 1000
func jobDict(_ over: [String: Any] = [:]) -> [String: Any] {
  var d: [String: Any] = ["id": "job-0001", "title": "Fix the thing", "repo": "demo", "base": "main", "prompt": "Do the work", "tool": "claude",
                          "returns": ["bundle": true, "report": true, "screenshots": false], "minutes": 5, "createdAt": now, "expiresAt": now + 600_000]
  for (k, v) in over { d[k] = v }
  return d
}
check(OutsourceJob.parse(jobDict(), now: now).0 != nil, "a good job parses")
check(OutsourceJob.parse(jobDict(["expiresAt": now - 1]), now: now).1 == "expired", "an expired job is refused")
check(OutsourceJob.parse(jobDict(["id": "../x"]), now: now).1 == "bad id", "a path as id refused")
check(OutsourceJob.parse(jobDict(["tool": "bash"]), now: now).1 == "bad tool", "an unknown tool refused")
check(OutsourceJob.parse(jobDict(["minutes": 9999]), now: now).0?.minutes == 120, "minutes capped at 120")
check(OutsourceJob.parse(jobDict(["minutes": 0]), now: now).0?.minutes == 1, "minutes at least 1")
check(OutsourceJob.parse(jobDict(["prompt": "use sk-abcdefghijklmnopqrstuvwx to call"]), now: now).1 == "secret in job", "a key in the prompt refused")
check(OutsourceJob.parse(jobDict(["prompt": ""]), now: now).1 == "bad prompt", "an empty prompt refused")
for bad in ["https://user:pw@example.com/a.git", "https://x@example.com/a.git", "file:///tmp/x", "ext::sh -c id", "/etc", "../x", "a b", "-oProxy=x", "git@host:a@b", "http://example.com/a.git", "..", ".hidden"] {
  check(!OutSafe.repoOk(bad), "repo refused: \(bad)")
}
for good in ["demo", "my-app.v2", "https://example.com/team/app.git", "git@example.com:team/app.git", "ssh://git@example.com/team/app.git"] {
  check(OutSafe.repoOk(good), "repo ok: \(good)")
}
check(!OutSafe.baseOk("--upload-pack=x") && !OutSafe.baseOk("a..b") && OutSafe.baseOk("main") && OutSafe.baseOk("feature/x-1") && OutSafe.baseOk("abc1234"), "base rules")
check(OutSafe.cloneName("https://example.com/a/app.git") != OutSafe.cloneName("https://example.org/b/app.git"), "two repos with one last name stay apart")

// Secrets
let secrets = ["sk-abcdefghijklmnopqrstuvwx", "ghp_abcdefghijklmnopqrstuvwxyz0123", "github_pat_abcdefghijklmnopqrstu", "AKIAABCDEFGHIJKLMNOP",
               "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdef123456", "Authorization: Bearer abcdefghijklmnop1234", "API_KEY=supersecretvalue1",
               "password: hunter2hunter2", "https://bob:pw1234@example.com/x", "-----BEGIN PRIVATE KEY-----\nabcdef\n-----END PRIVATE KEY-----", "sb_secret_abcdefgh12345"]
for s in secrets {
  check(OutSecrets.looksSecret(s), "detected: \(s.prefix(14))")
  let out = OutSecrets.strip("before " + s + " after", home: home)
  check(out.contains("[removed]") && !out.contains(String(s.dropFirst(min(8, s.count - 4)).prefix(6))) || out.contains("[removed]"), "stripped: \(s.prefix(14))")
}
check(!OutSecrets.looksSecret("Please fix the login page and run npm test"), "plain text is not a secret")
check(OutSecrets.strip("ls \(home)/work", home: home) == "ls ~/work", "home folder name hidden: \(OutSecrets.strip("ls \(home)/work", home: home))")
check(OutSecrets.tail(String(repeating: "line\n", count: 5000), 100).count <= 100, "tail is short")

// Policy
let ca = OutPolicy.claudeArgs(prompt: "P")
check(ca.contains("--disallowedTools") && ca.contains("Bash(git push:*)") && ca.contains("Bash(gh:*)") && ca.contains("WebFetch"), "claude deny flags")
check(ca.first == "-p" && ca[1] == "P", "claude headless prompt")
let xa = OutPolicy.codexArgs(prompt: "P", dir: "/d", lastMessage: "/m")
check(xa.contains("workspace-write") && !xa.contains("danger-full-access") && !xa.contains("--dangerously-bypass-approvals-and-sandbox"), "codex stays in the workspace sandbox")
let env = OutPolicy.env(base: ["PATH": "/usr/bin", "GH_TOKEN": "x", "GITHUB_TOKEN": "y", "SSH_AUTH_SOCK": "z", "GIT_DIR": "/q", "FOO": "bar"], shimDir: "/s", hooksDir: "/h", home: "/home/x")
check(env["GH_TOKEN"] == nil && env["GITHUB_TOKEN"] == nil && env["SSH_AUTH_SOCK"] == nil && env["GIT_DIR"] == nil && env["FOO"] == "bar", "tokens dropped from the env")
check(env["PATH"]!.hasPrefix("/s:"), "stand ins first on PATH")

// CLI wire format
check(OutCli.parse(#"{"cmd":"status"}"#) != nil, "cli status")
check(OutCli.parse(#"{"cmd":"rm"}"#) == nil, "cli unknown command refused")
check(OutCli.parse("garbage") == nil, "cli garbage refused")
check(OutCli.parse(#"{"cmd":"send","title":"t","repo":"demo","base":"main","prompt":"p","minutes":10,"tool":"codex"}"#)?["tool"] as? String == "codex", "cli send")
check(OutCli.parse(#"{"cmd":"send","title":"t","repo":"https://u:p@example.com/a","base":"main","prompt":"p"}"#) == nil, "cli send with credentials refused")
check(OutCli.parse(#"{"cmd":"send","title":"t","repo":"demo","base":"main","prompt":"p","minutes":999}"#) == nil, "cli send minutes range")
check(OutCli.parse(#"{"cmd":"result","id":"../a"}"#) == nil && OutCli.parse(#"{"cmd":"result","id":"job-0001"}"#) != nil, "cli result id")

// ---- fake CLI and temp repo
let fake = tmp + "/bin/claude"
try! fm.createDirectory(atPath: tmp + "/bin", withIntermediateDirectories: true)
let fakeScript = #"""
#!/bin/sh
# Stands in for claude and codex. Mode comes from words in the prompt.
prompt=""
for a in "$@"; do prompt="$a"; done
case "$1" in -p) prompt="$2";; esac
echo "$@" > .ps-outsource/args.txt
case "$prompt" in
  *SLEEP*) sleep 120; exit 0;;
  *PUSH*)
    git push origin HEAD:refs/heads/pushed > push-result.txt 2>&1; echo "push exit $?" >> push-result.txt
    gh pr create > gh-result.txt 2>&1; echo "gh exit $?" >> gh-result.txt
    echo "tok=$GH_TOKEN$GITHUB_TOKEN" > env-result.txt
    git push --no-verify origin HEAD:refs/heads/pushed2 > push2-result.txt 2>&1; echo "push2 exit $?" >> push2-result.txt
    ;;
  *FAIL*) echo "boom"; exit 3;;
  *SHOT*) printf 'PNGDATA' > .ps-outsource/shots/a.png;;
esac
echo "changed" > work.txt
git add work.txt && git commit -q -m "Add work"
echo "Done. Used key sk-abcdefghijklmnopqrstuvwx and tests passed. Home is $HOME"
"""#
try! fakeScript.write(toFile: fake, atomically: true, encoding: .utf8); chmod(fake, 0o755)
let fakeCodex = tmp + "/bin/codex"
try! fm.copyItem(atPath: fake, toPath: fakeCodex)

let src = srcDir + "/demo"
try! fm.createDirectory(atPath: src, withIntermediateDirectories: true)
_ = sh("git init -q -b main . && git config user.email t@localhost && git config user.name t && echo one > a.txt && git add a.txt && git commit -q -m first && echo two >> a.txt && git commit -qam second", cwd: src)
let baseSha = sh("git rev-parse HEAD", cwd: src).1
let branchesBefore = sh("git branch -a", cwd: src).1

var benv = ProcessInfo.processInfo.environment
benv["HOME"] = home; benv["GH_TOKEN"] = "tok-should-not-leak"; benv["GITHUB_TOKEN"] = "tok2"
let tools = OutTools(claude: fake, codex: fakeCodex, git: "/usr/bin/git")
check(tools.names == ["claude", "codex", "git"], "tools found by name")
check(OutTools.find(home: home, path: "/nonexistent", override: ["claude": "/nope", "codex": "/nope"]).names == ["git"], "missing tools not offered")
let runner = OutRunner(root: root, home: home, tools: tools, searchDirs: [srcDir], baseEnv: benv)

func runJob(_ over: [String: Any], wait: TimeInterval = 60) -> (OutDone?, [String]) {
  let job = OutsourceJob.parse(jobDict(over), now: now).0!
  let sem = DispatchSemaphore(value: 0)
  var res: OutDone?; var steps: [String] = []
  let lock = NSLock()
  let ok = runner.submit(job, progress: { s, t in lock.lock(); steps.append(s + ":" + t); lock.unlock() }, done: { res = $0; sem.signal() })
  if !ok { return (nil, ["refused"]) }
  _ = sem.wait(timeout: .now() + wait)
  return (res, steps)
}

// 1. A normal run
let (r1, steps1) = runJob(["id": "job-run1", "base": baseSha, "prompt": "Add work"])
check(r1?.state == "done", "run finishes done: \(r1?.state ?? "nil") \(r1?.report.note ?? "")")
check(r1?.report.commits == 1, "one commit counted")
check(r1?.report.branch == "outsource/job-run1" && r1?.report.base == baseSha, "branch and base")
check(r1?.report.files.contains(where: { $0.contains("work.txt") }) == true, "changed files listed")
check(steps1.first == "queued:" && steps1.contains(where: { $0.hasPrefix("running:") }), "progress steps")
check(r1?.report.summary.contains("tests passed") == true, "the AI's own summary kept")
check(r1?.report.summary.contains("sk-abc") == false && r1?.report.log.contains("sk-abc") == false, "secret stripped from summary and log")
check(r1?.report.summary.contains(home) == false, "home path hidden")
// the bundle
if let b = r1?.bundlePath {
  check(sh("git bundle verify \(b)", cwd: tmp).0 == 0 || sh("git -C \(src) bundle verify \(b)").0 == 0, "bundle verifies")
  let (c, o) = sh("git -C \(src) bundle list-heads \(b)")
  check(c == 0 && o.contains("refs/heads/outsource/job-run1"), "bundle holds the branch")
  check(r1?.bundleSize == ((try? fm.attributesOfItem(atPath: b))?[.size] as? Int) && r1?.bundleSha?.count == 64, "bundle size and sha")
  check(OutRunner.chunk(path: b, index: 0) != nil && OutRunner.chunk(path: b, index: 999) == nil, "chunks read")
  // Fetch it into a throwaway clone: the new commit arrives, the source repo stays untouched.
  _ = sh("git clone -q \(src) \(tmp)/review")
  let (fc, _) = sh("git fetch -q \(b) outsource/job-run1:review/x", cwd: tmp + "/review")
  check(fc == 0 && sh("git log -1 --format=%s review/x", cwd: tmp + "/review").1 == "Add work", "bundle fetches into a review branch")
} else { check(false, "bundle made") }
check(sh("git branch -a", cwd: src).1 == branchesBefore, "the person's own repo is untouched")
check(!fm.fileExists(atPath: root + "/jobs/job-run1/work"), "working folder cleaned up")
check(sh("git config core.hooksPath", cwd: root + "/repos/demo").1 == root + "/hooks", "hooks path points at the refusing hook")

// 2. Push refusal (hook, no-verify, push URL, gh stand in, token drop)
let (r2, _) = runJob(["id": "job-push", "base": baseSha, "prompt": "PUSH please"])
check(r2?.state == "done", "push job still ends")
let pdir = root + "/repos/demo"
let pushed = sh("git ls-remote --heads \(src)").1
check(!pushed.contains("pushed"), "nothing was pushed to the source")
check(sh("git for-each-ref refs/heads/pushed refs/heads/pushed2", cwd: pdir).1.isEmpty, "no pushed ref in the clone")
let jobDirPush = root + "/jobs/job-push"
check(r2?.report.log.contains("sk-") == false, "no secret in push log")
// The fake wrote its own files into .ps-outsource (excluded); read them from the report log via a rerun with a visible file.
let hookOut = sh("cd \(pdir) && git -c core.hooksPath=\(root)/hooks push --dry-run origin HEAD:refs/heads/zzz 2>&1; echo exit $?").1
check(hookOut.contains("refused") || hookOut.contains("exit 1") || hookOut.contains("exit 128"), "a direct push in the clone fails: \(hookOut.prefix(80))")
check(sh("\(root)/shims/gh pr create 2>&1; echo $?").1.contains("refused") , "gh stand in refuses")
check(sh("cat \(root)/hooks/pre-push").1.contains("exit 1"), "pre-push hook always fails")
check((try? fm.attributesOfItem(atPath: root + "/hooks/pre-push"))?[.posixPermissions] as? Int == 0o755, "hook is executable")
_ = jobDirPush
if let b = r2?.bundlePath {
  _ = sh("git clone -q \(src) \(tmp)/review3"); _ = sh("git fetch -q \(b) outsource/job-push:review/p", cwd: tmp + "/review3")
  func show(_ f: String) -> String { sh("git show review/p:\(f)", cwd: tmp + "/review3").1 }
  check(show("push-result.txt").contains("refused") && !show("push-result.txt").contains("push exit 0"), "the AI's git push was refused: \(show("push-result.txt").prefix(90))")
  check(!show("push2-result.txt").contains("push2 exit 0"), "git push --no-verify still goes nowhere: \(show("push2-result.txt").prefix(90))")
  check(show("gh-result.txt").contains("gh exit 126") && show("gh-result.txt").contains("refused"), "gh refused for the AI")
  check(show("env-result.txt") == "tok=", "tokens not in the AI's env")
} else { check(false, "push job bundle") }

// 3. The tool gets the deny flags and the env without tokens: use a job whose fake writes args to a committed file.
let argScript = tmp + "/bin/claude2"
try! (fakeScript + "\n").write(toFile: argScript, atomically: true, encoding: .utf8)
let spy = #"""
#!/bin/sh
cp .ps-outsource/args.txt /dev/null 2>/dev/null
echo "$@" > spy-args.txt
echo "GH=${GH_TOKEN:-none} GITHUB=${GITHUB_TOKEN:-none} PATHFIRST=$(echo $PATH | cut -d: -f1)" > spy-env.txt
git add -A && git commit -q -m spy
echo ok
"""#
let spyPath = tmp + "/bin/claude-spy"
try! spy.write(toFile: spyPath, atomically: true, encoding: .utf8); chmod(spyPath, 0o755)
runner.tools = OutTools(claude: spyPath, codex: fakeCodex, git: "/usr/bin/git")
let (r3, _) = runJob(["id": "job-spy1", "base": baseSha, "prompt": "inspect"])
check(r3?.state == "done", "spy run done")
if let b = r3?.bundlePath {
  _ = sh("git clone -q \(src) \(tmp)/review2"); _ = sh("git fetch -q \(b) outsource/job-spy1:review/y", cwd: tmp + "/review2")
  let args = sh("git show review/y:spy-args.txt", cwd: tmp + "/review2").1
  let e = sh("git show review/y:spy-env.txt", cwd: tmp + "/review2").1
  check(args.contains("--disallowedTools") && args.contains("Bash(git push:*)") && args.contains("--permission-mode acceptEdits"), "tool ran with the deny flags")
  check(e.contains("GH=none") && e.contains("GITHUB=none"), "tokens not in the AI's env: \(e)")
  check(e.contains(root + "/shims") || e.contains("PATHFIRST=\(root)/shims"), "stand in directory first on PATH: \(e)")
} else { check(false, "spy bundle") }
runner.tools = tools

// 4. Codex
let (r4, _) = runJob(["id": "job-cdx1", "base": baseSha, "tool": "codex", "prompt": "Add work"])
check(r4?.state == "done" && r4?.report.tool == "codex", "codex run")

// 5. Failure, no changes
let (r5, _) = runJob(["id": "job-fail", "base": baseSha, "prompt": "FAIL"])
check(r5?.state == "failed" && r5?.bundlePath == nil && r5?.report.commits == 0, "a failing tool: failed, no bundle")
check(r5?.report.log.contains("boom") == true, "log kept")

// 6. Refusals before running
let (r6, _) = runJob(["id": "job-nobase", "base": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", "prompt": "x"])
check(r6?.state == "failed" && r6?.report.note.contains("base commit") == true, "unknown base refused")
let (r7, _) = runJob(["id": "job-norepo", "repo": "no-such-folder", "base": baseSha, "prompt": "x"])
check(r7?.state == "failed" && r7?.report.note.contains("no folder") == true, "unknown folder refused")

// 7. Screenshots
let (r8, _) = runJob(["id": "job-shot", "base": baseSha, "prompt": "SHOT", "returns": ["bundle": true, "report": true, "screenshots": true]])
check(r8?.shotPaths.count == 1 && r8?.shotPaths.first.map { fm.fileExists(atPath: $0) } == true, "screenshot handed back")

// 8. Timeout kills the whole tree, quickly (a "minute" is 2 seconds here)
runner.secondsPerMinute = 2
let t0 = Date()
let (r9, _) = runJob(["id": "job-slow", "base": baseSha, "prompt": "SLEEP", "minutes": 1], wait: 40)
check(r9?.state == "timeout", "timeout state: \(r9?.state ?? "nil")")
check(Date().timeIntervalSince(t0) < 15, "timeout ends fast")
usleep(500_000)
check(sh("pgrep -f 'sleep 120'").1.isEmpty, "the child tree is gone after a timeout")
check(r9?.report.note.contains("Stopped after") == true, "timeout note")

// 9. Cancel from the main computer, and the queue
runner.secondsPerMinute = 60
let cancelJob = OutsourceJob.parse(jobDict(["id": "job-cancel", "base": baseSha, "prompt": "SLEEP", "minutes": 5]), now: now).0!
let semC = DispatchSemaphore(value: 0)
var rc: OutDone?; var order: [String] = []; let ol = NSLock()
_ = runner.submit(cancelJob, progress: { s, t in ol.lock(); order.append("c:" + s); ol.unlock() }, done: { rc = $0; semC.signal() })
let nextJob = OutsourceJob.parse(jobDict(["id": "job-next1", "base": baseSha, "prompt": "Add work"]), now: now).0!
let semN = DispatchSemaphore(value: 0)
var rn: OutDone?
_ = runner.submit(nextJob, progress: { s, t in ol.lock(); order.append("n:" + s); ol.unlock() }, done: { rn = $0; semN.signal() })
check(runner.queueLength >= 1 || runner.busy, "second job waits behind the first")
usleep(2_500_000)
let tc = Date()
runner.cancel("job-cancel")
_ = semC.wait(timeout: .now() + 20)
check(rc?.state == "cancelled", "cancel: \(rc?.state ?? "nil")")
check(Date().timeIntervalSince(tc) < 10, "cancel ends fast")
usleep(500_000)
check(sh("pgrep -f 'sleep 120'").1.isEmpty, "the child tree is gone after a cancel")
_ = semN.wait(timeout: .now() + 60)
check(rn?.state == "done", "the next job runs after the cancel")
ol.lock()
let firstNRun = order.firstIndex(of: "n:running"), cDoneIdx = order.lastIndex(where: { $0.hasPrefix("c:") })
ol.unlock()
check(firstNRun != nil && cDoneIdx != nil && firstNRun! > cDoneIdx!, "one job at a time")
// A queued job cancelled before it starts
let q1 = OutsourceJob.parse(jobDict(["id": "job-q001", "base": baseSha, "prompt": "SLEEP", "minutes": 5]), now: now).0!
let q2 = OutsourceJob.parse(jobDict(["id": "job-q002", "base": baseSha, "prompt": "Add work"]), now: now).0!
let sq1 = DispatchSemaphore(value: 0), sq2 = DispatchSemaphore(value: 0)
var rq2: OutDone?
_ = runner.submit(q1, progress: { _, _ in }, done: { _ in sq1.signal() })
_ = runner.submit(q2, progress: { _, _ in }, done: { rq2 = $0; sq2.signal() })
runner.cancel("job-q002"); usleep(1_500_000); runner.cancel("job-q001")
_ = sq1.wait(timeout: .now() + 20); _ = sq2.wait(timeout: .now() + 20)
check(rq2?.state == "cancelled", "a queued job cancelled before it starts")
// Queue limit
var accepted = 0
var sems: [DispatchSemaphore] = []
for i in 0..<8 {
  let j = OutsourceJob.parse(jobDict(["id": "job-lim\(i)x", "base": baseSha, "prompt": "SLEEP", "minutes": 5]), now: now).0!
  let s = DispatchSemaphore(value: 0)
  if runner.submit(j, progress: { _, _ in }, done: { _ in s.signal() }) { accepted += 1; sems.append(s) }
}
check(accepted == OutRunner.maxQueue, "queue holds \(OutRunner.maxQueue): \(accepted)")
for i in 0..<8 { runner.cancel("job-lim\(i)x"); usleep(300_000) }
for s in sems { _ = s.wait(timeout: .now() + 30) }

// 10. Old results are pruned
let oldDir = root + "/jobs/job-old1"
try! fm.createDirectory(atPath: oldDir, withIntermediateDirectories: true)
try! fm.setAttributes([.modificationDate: Date().addingTimeInterval(-72 * 3600)], ofItemAtPath: oldDir)
runner.prune()
check(!fm.fileExists(atPath: oldDir), "a three day old result is pruned")

// 11. The command line tool refuses without a socket, never hangs
let cli = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
if fm.fileExists(atPath: cli) {
  let (c, o) = sh("PS_OUTSOURCE_SOCKET=\(tmp)/none.sock perl \(cli) status 2>&1; echo exit $?")
  check(o.contains("PS is not running") && o.contains("exit 1"), "cli says PS is not running: \(o.prefix(80))")
  let (c2, o2) = sh("PS_OUTSOURCE_SOCKET=\(tmp)/none.sock perl \(cli) send --title t --repo 'https://u:p@example.com/a' --base main --prompt x 2>&1; echo exit $?")
  _ = (c, c2)
  check(o2.contains("exit 2") || o2.contains("credentials"), "cli refuses a repo with credentials: \(o2.prefix(80))")
  let (_, o3) = sh("perl \(cli) 2>&1; echo exit $?")
  check(o3.contains("exit 2") && o3.lowercased().contains("usage"), "cli usage")
}

print("outsource: \(checks) checks, \(fails) failed")
exit(fails == 0 ? 0 : 1)
