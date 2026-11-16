// Outsource work to your other computer (PS 1.65), the rules that need no app: what a job may be, the AI tool's own
// allow and deny flags and sandbox, secrets stripped from logs, the pre-push hook, the command line's wire format and its
// script, and the pieces a bundle is sent in. Foundation and CryptoKit only, so mac/tests/outsource-test.sh compiles it alone.
// The page (web core/second.ts) already checked signatures and expiry. Everything here is a second look, never the first.
import CryptoKit
import Foundation

/// A job as the page hands it over (web core/secondbridge.ts PlainJob).
struct OutsourceJob: Equatable {
  var id: String
  var title: String
  var repo: String
  var base: String
  var prompt: String
  var bundle: Bool
  var report: Bool
  var screenshots: Bool
  var minutes: Int
  var tool: String          // "claude" or "codex"
  var createdAt: Double     // epoch ms
  var expiresAt: Double     // epoch ms

  static let maxPrompt = 60_000
  static let maxMinutes = 240   // web OJOB_MAX_MINUTES

  /// Why the job is refused, or nil when it may run. `now` is epoch ms.
  static func parse(_ o: [String: Any], now: Double) -> (OutsourceJob?, String?) {
    func s(_ k: String) -> String { (o[k] as? String) ?? "" }
    let id = s("id"), title = s("title"), repo = s("repo"), base = s("base"), prompt = s("prompt")
    guard OutSafe.idOk(id) else { return (nil, "bad id") }
    guard !title.isEmpty, title.count <= 200 else { return (nil, "bad title") }
    guard OutSafe.repoOk(repo) else { return (nil, "bad repo") }
    guard OutSafe.baseOk(base) else { return (nil, "bad base") }
    guard !prompt.isEmpty, prompt.utf8.count <= maxPrompt else { return (nil, "bad prompt") }
    if OutSecrets.looksSecret(prompt) || OutSecrets.looksSecret(title) { return (nil, "secret in job") }
    let tool = s("tool")
    guard tool == "claude" || tool == "codex" else { return (nil, "bad tool") }
    let exp = (o["expiresAt"] as? NSNumber)?.doubleValue ?? 0
    guard exp > now else { return (nil, "expired") }
    let ret = o["returns"] as? [String: Any] ?? [:]
    let mins = min(maxMinutes, max(1, (o["minutes"] as? NSNumber)?.intValue ?? 20))
    return (OutsourceJob(id: id, title: title, repo: repo, base: base, prompt: prompt,
                   bundle: (ret["bundle"] as? Bool) ?? true, report: (ret["report"] as? Bool) ?? true,
                   screenshots: (ret["screenshots"] as? Bool) ?? false, minutes: mins, tool: tool,
                   createdAt: (o["createdAt"] as? NSNumber)?.doubleValue ?? 0, expiresAt: exp), nil)
  }
}

enum OutSafe {
  /// Letters, digits, dash, underscore, 4 to 64. The id becomes a folder and a branch name.
  static func idOk(_ s: String) -> Bool {
    s.count >= 4 && s.count <= 64 && s.unicodeScalars.allSatisfy { ($0.value < 128) && (CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_") }
  }
  /// A folder name (no slash, no dots only) or a git URL without credentials. Never file:// or ext:: (git runs commands for ext::).
  static func repoOk(_ s: String) -> Bool {
    guard !s.isEmpty, s.count <= 300, !s.contains(" "), !s.contains("\n"), s.unicodeScalars.allSatisfy({ $0.value > 32 && $0.value < 127 }) else { return false }
    if folderName(s) { return true }
    if s.hasPrefix("https://") {
      guard let u = URL(string: s), let h = u.host, !h.isEmpty, u.user == nil, u.password == nil, u.query == nil else { return false }
      return !s.contains("@")
    }
    if s.hasPrefix("ssh://git@") { return !s.dropFirst(10).contains("@") }
    if s.hasPrefix("git@") { return s.dropFirst(4).contains(":") && !s.dropFirst(4).contains("@") && !s.contains("::") }
    return false
  }
  static func folderName(_ s: String) -> Bool {
    !s.isEmpty && s.count <= 100 && !s.hasPrefix(".") && !s.hasPrefix("-") && !s.contains("..") &&
      s.unicodeScalars.allSatisfy { $0.value < 128 && (CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" || $0 == ".") }
  }
  /// A commit hash (4 to 40 hex) or a branch name of safe characters. Never starts with a dash.
  static func baseOk(_ s: String) -> Bool {
    guard !s.isEmpty, s.count <= 100, !s.hasPrefix("-"), !s.hasPrefix("/"), !s.contains(".."), !s.hasSuffix("/"), !s.hasSuffix(".lock") else { return false }
    return s.unicodeScalars.allSatisfy { $0.value < 128 && (CharacterSet.alphanumerics.contains($0) || "-_./".unicodeScalars.contains($0)) }
  }
  /// The folder name a repo gets under the PS folder.
  static func cloneName(_ repo: String) -> String {
    if folderName(repo) { return repo }
    var last = repo.split(whereSeparator: { $0 == "/" || $0 == ":" }).last.map(String.init) ?? "repo"
    if last.hasSuffix(".git") { last.removeLast(4) }
    let clean = String(last.unicodeScalars.filter { $0.value < 128 && (CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" || $0 == ".") }.map(Character.init))
    var h: UInt32 = 5381
    for b in repo.utf8 { h = (h &* 33) &+ UInt32(b) }   // two repos with one last name stay apart
    return (clean.isEmpty || clean.hasPrefix(".") ? "repo" : clean) + "-" + String(h, radix: 16)
  }
}

enum OutSecrets {
  private static let patterns: [String] = [
    #"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)"#,
    #"\bsk-[A-Za-z0-9_-]{16,}"#, #"\bsb_secret_[A-Za-z0-9_-]{8,}"#, #"\bghp_[A-Za-z0-9]{20,}"#, #"\bgithub_pat_[A-Za-z0-9_]{20,}"#,
    #"\bgh[osu]_[A-Za-z0-9]{20,}"#, #"\bAKIA[0-9A-Z]{12,}"#, #"\bxox[abprs]-[A-Za-z0-9-]{10,}"#,
    #"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\.?[A-Za-z0-9_-]*"#,
    #"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{16,}"#,
    #"(?i)\b[A-Za-z0-9_]*(password|passwd|secret|token|api[_-]?key|apikey|auth)[A-Za-z0-9_]*\s*[=:]\s*["']?[^\s"',;]{6,}"#,
    #"(?i)https?://[^\s/:@]+:[^\s/@]+@"#,
  ]
  private static let regexes: [NSRegularExpression] = patterns.compactMap { try? NSRegularExpression(pattern: $0) }

  /// Only the unmistakable ones (keys, tokens, private key blocks): used on a whole diff, where a test's "password: x" is normal.
  private static let strong: [NSRegularExpression] = Array(regexes.prefix(9))
  static func looksStrongSecret(_ s: String) -> Bool {
    let r = NSRange(s.startIndex..., in: s)
    return strong.contains { $0.firstMatch(in: s, range: r) != nil }
  }
  static func looksSecret(_ s: String) -> Bool {
    let r = NSRange(s.startIndex..., in: s)
    return regexes.contains { $0.firstMatch(in: s, range: r) != nil }
  }
  /// Every secret looking piece replaced; the rest stays. Also the home folder name, so a log never carries a person's name.
  static func strip(_ s: String, home: String? = NSHomeDirectory()) -> String {
    var out = s
    for re in regexes {
      out = re.stringByReplacingMatches(in: out, range: NSRange(out.startIndex..., in: out), withTemplate: "[removed]")
    }
    if let h = home, h.count > 3 { out = out.replacingOccurrences(of: h, with: "~") }
    return out
  }
  /// The last `n` characters, cut at a line start, then stripped. Logs are never longer than this in a report.
  static func tail(_ s: String, _ n: Int = 6000, home: String? = NSHomeDirectory()) -> String {
    var t = s
    if t.count > n {
      t = String(t.suffix(n))
      if let i = t.firstIndex(of: "\n") { t = String(t[t.index(after: i)...]) }
    }
    return strip(t, home: home)
  }
}

/// What the AI tool may and may not do. Four walls, each enough on its own for the usual case:
///  1. the CLI's own rules: Claude Code runs its commands in its sandbox (writes only in the job folder, no network but the
///     package registries, no way out of the sandbox), with deny rules for push, deploy and send tools and no MCP servers,
///     plugins' hooks or the person's own settings; Codex runs `workspace-write` with the network off and no MCP servers;
///  2. git itself: no transport at all (GIT_ALLOW_PROTOCOL names none), no system or global config (so no saved passwords), ssh
///     replaced by a stand in that refuses, a push URL that goes nowhere and push.default nothing;
///  3. a pre-push hook that always refuses;
///  4. refusing stand ins for gh and deploy tools first on PATH, and tokens dropped from the environment.
enum OutPolicy {
  static let denyBash = ["git push", "git remote", "git config", "git credential", "gh", "hub", "vercel", "netlify", "wrangler", "firebase", "fly", "flyctl", "heroku",
                         "railway", "supabase", "aws", "gcloud", "az", "kubectl", "terraform", "pulumi", "scp", "rsync", "sftp",
                         "curl", "wget", "ssh", "sudo", "npm publish", "pnpm publish", "yarn publish", "twine", "docker push", "cargo publish", "gem push",
                         "security", "osascript", "open", "mail", "sendmail", "say"]
  /// Names a refusing stand in is made for (they sit first on the PATH the AI runs with).
  static let shimmed = ["gh", "hub", "vercel", "netlify", "wrangler", "firebase", "fly", "flyctl", "heroku", "railway", "supabase",
                        "aws", "gcloud", "kubectl", "terraform", "pulumi", "scp", "sftp", "ssh", "sudo", "security", "osascript", "twine", "sendmail", "mail"]
  static let envDrop = ["GH_TOKEN", "GITHUB_TOKEN", "GITHUB_PAT", "GH_ENTERPRISE_TOKEN", "NPM_TOKEN", "NODE_AUTH_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
                        "AWS_SESSION_TOKEN", "VERCEL_TOKEN", "NETLIFY_AUTH_TOKEN", "CLOUDFLARE_API_TOKEN", "FLY_API_TOKEN", "SSH_AUTH_SOCK",
                        "SUPABASE_ACCESS_TOKEN", "GOOGLE_APPLICATION_CREDENTIALS", "HEROKU_API_KEY", "DOCKER_CONFIG", "GIT_ASKPASS", "SSH_ASKPASS",
                        "TWINE_PASSWORD", "CARGO_REGISTRY_TOKEN", "PYPI_TOKEN", "SENTRY_AUTH_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]
  /// The package registries a job may still download from (builds and tests need them). Publishing needs a token, and none is passed.
  static let registries = ["registry.npmjs.org", "registry.yarnpkg.com", "pypi.org", "files.pythonhosted.org"]
  /// Files the AI may not even read (the sandbox enforces Read deny rules for its commands too).
  static let noRead = ["~/.ssh/**", "~/.aws/**", "~/.gnupg/**", "~/.netrc", "~/.npmrc", "~/.pypirc", "~/.docker/**", "~/.kube/**", "~/.config/gh/**",
                       "~/.git-credentials", "~/Library/Keychains/**", "~/Library/Application Support/PS/**", "~/Library/Group Containers/**"]

  /// Claude Code's own settings for the run (passed with --settings, so they hold whatever the person's own settings say).
  static func claudeSettings() -> String {
    var deny = noRead.map { "Read(\($0))" } + noRead.map { "Edit(\($0))" }
    deny += denyBash.map { "Bash(\($0):*)" } + ["WebSearch"]
    let o: [String: Any] = [
      "sandbox": ["enabled": true, "autoAllowBashIfSandboxed": true, "allowUnsandboxedCommands": false],
      "permissions": ["deny": deny, "allow": registries.map { "WebFetch(domain:\($0))" }, "disableBypassPermissionsMode": "disable"],
      "disableAllHooks": true, "enableAllProjectMcpServers": false,
    ]
    let d = (try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys])) ?? Data("{}".utf8)
    return String(data: d, encoding: .utf8) ?? "{}"
  }
  static func claudeArgs(prompt: String) -> [String] {
    var a = ["-p", prompt, "--permission-mode", "acceptEdits", "--output-format", "text",
             "--setting-sources", "local", "--settings", claudeSettings(),
             "--strict-mcp-config", "--mcp-config", #"{"mcpServers":{}}"#,
             "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Bash"]
    a.append("--disallowedTools")
    for d in denyBash { a.append("Bash(\(d):*)") }
    a += ["WebSearch"]
    return a
  }
  /// Codex: workspace-write keeps the writes inside the folder; the network is off for its commands; no MCP servers; never the full access mode.
  static func codexArgs(prompt: String, dir: String, lastMessage: String) -> [String] {
    ["exec", "-C", dir, "-s", "workspace-write", "-c", "sandbox_workspace_write.network_access=false", "-c", "mcp_servers={}",
     "-c", "approval_policy=\"never\"", "-o", lastMessage, prompt]
  }
  static let prePushHook = "#!/bin/sh\necho \"PS: pushing is refused on this computer (outsourced work never pushes).\" >&2\nexit 1\n"
  static func shim(_ name: String) -> String { "#!/bin/sh\necho \"PS: \(name) is refused on this computer (outsourced work only edits and tests).\" >&2\nexit 126\n" }
  static let noPushURL = "refused://this-computer-never-pushes"
  static let author = "PS outsourced job", authorEmail = "ps-outsource@localhost"

  /// The environment the AI runs with: this computer's own, minus tokens, with the stand ins first on PATH and git kept local.
  static func env(base: [String: String], shimDir: String, hooksDir: String, home: String) -> [String: String] {
    var e = base
    for k in envDrop { e.removeValue(forKey: k) }
    for k in e.keys where k.hasPrefix("GIT_") { e.removeValue(forKey: k) }
    for k in e.keys where k.hasSuffix("_TOKEN") || k.hasSuffix("_SECRET") || k.hasSuffix("_PASSWORD") || k.hasSuffix("_API_KEY") { e.removeValue(forKey: k) }
    let path = e["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
    e["PATH"] = shimDir + ":" + path
    e["HOME"] = home
    e["GIT_TERMINAL_PROMPT"] = "0"
    e["GIT_CONFIG_NOSYSTEM"] = "1"                // no system config: no saved password helper
    e["GIT_CONFIG_GLOBAL"] = "/dev/null"          // nor the person's own
    e["GIT_ALLOW_PROTOCOL"] = "ps-none"           // no transport at all, not even a folder: the AI commits, it never pushes or fetches
    e["GIT_SSH_COMMAND"] = shimDir + "/ssh"
    e["GIT_AUTHOR_NAME"] = author; e["GIT_COMMITTER_NAME"] = author
    e["GIT_AUTHOR_EMAIL"] = authorEmail; e["GIT_COMMITTER_EMAIL"] = authorEmail
    e["GIT_CONFIG_COUNT"] = "2"
    e["GIT_CONFIG_KEY_0"] = "core.hooksPath"; e["GIT_CONFIG_VALUE_0"] = hooksDir
    e["GIT_CONFIG_KEY_1"] = "push.default"; e["GIT_CONFIG_VALUE_1"] = "nothing"
    e["CI"] = "1"
    return e
  }

  /// The prompt the tool gets: the job's own, then the house rules (it cannot push) and where to put screenshots.
  static func fullPrompt(_ j: OutsourceJob) -> String {
    var p = j.prompt + "\n\n---\nRules of this computer: work only inside this folder, commit your work on the current branch with clear messages, never push, deploy or send anything, and finish with a short summary of what you changed and which tests you ran."
    if j.screenshots { p += " Save any screenshots as PNG files in .ps-outsource/shots/." }
    return p
  }
}

/// Changed files that look like they hold secrets: a bundle that carries one is not sent back.
enum OutSecretPaths {
  private static let re = try? NSRegularExpression(pattern: #"(^|/)(\.env(\..*)?|\.ssh|\.aws|\.gnupg|\.netrc|\.npmrc|\.pypirc|\.docker|\.kube|id_(rsa|ed25519|ecdsa)[^/]*|credentials(\.json)?|secrets?(\.[a-z]+)?|keychains?)(/|$)|\.(pem|p12|pfx|key|keystore|kdbx)$"#, options: [.caseInsensitive])
  static func isSecret(_ path: String) -> Bool {
    guard let re else { return true }
    return re.firstMatch(in: path, range: NSRange(path.startIndex..., in: path)) != nil
  }
}

/// SHA-256 of a file, read in pieces (never the whole bundle in memory at once).
enum OutHash {
  static func sha256(_ path: String) -> String? {
    guard let h = FileHandle(forReadingAtPath: path) else { return nil }
    defer { try? h.close() }
    var hasher = SHA256()
    while true {
      let d: Data?
      do { d = try h.read(upToCount: 1 << 20) } catch { return nil }
      guard let d, !d.isEmpty else { break }   // nil or empty: the end of the file
      hasher.update(data: d)
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }
}

/// The report the page seals and sends back.
struct OutReport {
  var id: String
  var title: String
  var state: String          // done, failed, cancelled, timeout
  var tool: String
  var branch: String
  var base: String
  var head: String
  var commits: Int
  var files: [String]        // "path | 3 +-" lines from git diff --stat, short
  var summary: String        // the AI's own words, stripped
  var log: String            // the tail of what it printed, stripped
  var exit: Int32
  var seconds: Int
  var note: String
  func json() -> String {
    let d: [String: Any] = ["id": id, "title": title, "state": state, "tool": tool, "branch": branch, "base": base, "head": head,
                            "commits": commits, "files": files, "summary": summary, "log": log, "exit": Int(exit), "seconds": seconds, "note": note]
    let data = (try? JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])) ?? Data("{}".utf8)
    return String(data: data, encoding: .utf8) ?? "{}"
  }
}

/// The command line's wire format: one JSON line in, one JSON line out, over a socket only this person can open.
enum OutCli {
  static let maxLine = 200_000
  static let cmds = ["status", "send", "list", "result", "cancel"]   // never restart: an AI never restarts a computer
  /// A request line to the cmd the page expects (web CliRequest), or nil.
  static func parse(_ line: String) -> [String: Any]? {
    guard line.utf8.count <= maxLine, let d = line.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
          let cmd = o["cmd"] as? String, cmds.contains(cmd) else { return nil }
    var out: [String: Any] = ["cmd": cmd]
    func str(_ k: String, max: Int) -> Bool { guard let v = o[k] as? String, !v.isEmpty, v.utf8.count <= max else { return false }; out[k] = v; return true }
    switch cmd {
    case "send":
      guard str("title", max: 200), str("repo", max: 300), str("base", max: 100), str("prompt", max: OutsourceJob.maxPrompt) else { return nil }
      guard OutSafe.repoOk(out["repo"] as! String), OutSafe.baseOk(out["base"] as! String) else { return nil }
      if let b = o["bundle"] as? Bool { out["bundle"] = b }
      if let b = o["screenshots"] as? Bool { out["screenshots"] = b }
      if let m = o["minutes"] as? Int { guard m >= 1 && m <= OutsourceJob.maxMinutes else { return nil }; out["minutes"] = m }
      if let t = o["tool"] as? String { guard t == "claude" || t == "codex" else { return nil }; out["tool"] = t }
    case "result", "cancel":
      guard str("id", max: 64), OutSafe.idOk(out["id"] as! String) else { return nil }
    default: break
    }
    return out
  }
  static func answer(ok: Bool, text: String, id: String?) -> String {
    var d: [String: Any] = ["ok": ok, "text": String(text.prefix(20_000))]
    if let id { d["id"] = id }
    return String(data: (try? JSONSerialization.data(withJSONObject: d)) ?? Data("{}".utf8), encoding: .utf8) ?? "{}"
  }
}

enum OutChunks {
  static let size = 192 * 1024   // web BRIDGE_CHUNK
  static func count(_ bytes: Int) -> Int { max(1, (bytes + size - 1) / size) }
}

extension OutCli {
  /// The command line the person's own AI calls on the MAIN computer. PS writes it to <PS folder>/bin/ps-outsource (0755) when this
  /// Mac is the main computer, and Copy for AI in the tab says where. It talks only to this Mac's PS over a socket only this
  /// person can open. Perl, because every Mac has it.
  static let script = #"""
#!/usr/bin/perl
# ps-outsource: the command line a person's own AI uses to send a job to their other computer through PS.
# Talks only to this Mac's PS over a socket only this person can open. Nothing merges: a result is a git bundle
# in a folder, to be fetched into a review branch.
#   ps-outsource status
#   ps-outsource send --title T --repo R --base B (--prompt TEXT | --prompt-file FILE | --prompt -) [--tool claude|codex] [--minutes N] [--no-bundle] [--screenshots]
#   ps-outsource list | result ID | cancel ID
use strict; use warnings;
use IO::Socket::UNIX; use JSON::PP; use POSIX qw(strftime);

use File::Basename qw(dirname);
my $sock = $ENV{PS_OUTSOURCE_SOCKET} // (dirname(dirname($0)) . "/cli.sock");   # this script sits in <PS folder>/bin
sub usage { print STDERR "Usage: ps-outsource status | list | result ID | cancel ID\n       ps-outsource send --title T --repo R --base B (--prompt TEXT | --prompt-file FILE | --prompt -) [--tool claude|codex] [--minutes N] [--no-bundle] [--screenshots]\n"; exit 2; }
sub die2 { print STDERR "ps-outsource: $_[0]\n"; exit 2; }

my $cmd = shift @ARGV or usage();
my %req = (cmd => $cmd);
if ($cmd eq "send") {
  my %o; my $bundle = 1;
  while (@ARGV) {
    my $a = shift @ARGV;
    if ($a =~ /^--(title|repo|base|prompt|prompt-file|tool|minutes)$/) { $o{$1} = shift @ARGV // die2("$a needs a value"); }
    elsif ($a eq "--no-bundle") { $bundle = 0 }
    elsif ($a eq "--screenshots") { $o{shots} = 1 }
    else { die2("unknown option $a") }
  }
  if (defined $o{"prompt-file"}) { open(my $f, "<", $o{"prompt-file"}) or die2("cannot read the prompt file"); local $/; $o{prompt} = <$f>; close $f; }
  elsif (defined $o{prompt} && $o{prompt} eq "-") { local $/; $o{prompt} = <STDIN>; }
  for my $k (qw(title repo base prompt)) { die2("--$k is required") unless defined $o{$k} && length $o{$k}; }
  die2("a repo must be a folder name or a git URL without a password or token")
    if $o{repo} =~ m{\@} && $o{repo} !~ m{^(git\@[^@]+|ssh://git\@[^@]+)$} || $o{repo} =~ m{^(file:|ext:)} || $o{repo} =~ /\s/;
  die2("--tool must be claude or codex") if defined $o{tool} && $o{tool} !~ /^(claude|codex)$/;
  die2("--minutes must be 1 to 240") if defined $o{minutes} && ($o{minutes} !~ /^\d+$/ || $o{minutes} < 1 || $o{minutes} > 240);
  die2("the prompt looks like it holds a secret (a key, token or password): take it out") if $o{prompt} =~ /\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|github_pat_|\bAKIA[0-9A-Z]{12,}|BEGIN [A-Z ]*PRIVATE KEY|(?i:password|api[_-]?key|secret|token)\s*[=:]\s*\S{6,}/;
  %req = (cmd => "send", title => $o{title}, repo => $o{repo}, base => $o{base}, prompt => $o{prompt}, bundle => $bundle ? JSON::PP::true : JSON::PP::false);
  $req{screenshots} = JSON::PP::true if $o{shots};
  $req{minutes} = $o{minutes} + 0 if defined $o{minutes};
  $req{tool} = $o{tool} if defined $o{tool};
} elsif ($cmd eq "result" || $cmd eq "cancel") {
  my $id = shift @ARGV // die2("$cmd needs a job id");
  die2("that is not a job id") unless $id =~ /^[A-Za-z0-9_-]{4,64}$/;
  $req{id} = $id; usage() if @ARGV;
} elsif ($cmd =~ /^(status|list)$/) { usage() if @ARGV; }
else { usage(); }

my $s = IO::Socket::UNIX->new(Peer => $sock, Type => SOCK_STREAM, Timeout => 5);
unless ($s) { print STDERR "ps-outsource: PS is not running on this Mac, or Outsource is switched off in PS Settings.\n"; exit 1; }
print $s encode_json(\%req) . "\n"; $s->flush;
my $line = eval { local $SIG{ALRM} = sub { die "timeout\n" }; alarm 45; my $l = <$s>; alarm 0; $l };
unless (defined $line && length $line) { print STDERR "ps-outsource: no answer from PS (is it locked? the vault must be open).\n"; exit 1; }
my $ans = eval { decode_json($line) };
unless (ref $ans eq "HASH") { print STDERR "ps-outsource: PS gave an answer this tool cannot read.\n"; exit 1; }
my $text = $ans->{text} // "";
print "$text\n";
print "Job id: $ans->{id}\n" if $ans->{id} && $text !~ /\Q$ans->{id}\E/;
if ($ans->{ok} && $cmd eq "result" && $text =~ /^Bundle:\s*(.+?)\s*$/m) {
  my $b = $1; my $id = $req{id};
  print -f $b ? "Review it in the repository it belongs to, nothing is merged:\n  git bundle verify '$b' && git fetch '$b' 'outsource/$id:review/$id'\n" : "The bundle is not in its folder (yet).\n";
}
exit($ans->{ok} ? 0 : 1);
"""#
}
