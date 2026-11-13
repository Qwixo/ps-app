// PS_SELFTEST_ONLY=project: "Connect your own Supabase" on a test copy (ProjectSetup.swift). Fictional data,
// no network (the test copy blocks every request), windows parked off screen and invisible.
// Checks: a fresh Mac opens PS's page at once (local first, V1.44) and the setup window opens on request; the window
// answers a bad token in plain
// words without sending it anywhere; linking a (fictional) project saves it 0600 in the test folder, hands it to
// the page before its code runs, limits the page's network policy to that one project, and opens Create account;
// The developer's native features stay off on it whatever the page says.
import AppKit
import WebKit

enum ProjectSelfTest {
  static let ref = "abcdefghijklmnopqrst"
  static let key = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlLXNpZ25hdHVyZQ"
  static func run(_ a: App, _ dir: String) {
    var checks: [(String, Bool)] = []
    let s = ProjectSetup.shared
    func js(_ code: String, in v: WKWebView?, _ done: @escaping (Any?) -> Void) {
      guard let v else { done(nil); return }
      v.callAsyncJavaScript(code, arguments: [:], in: nil, in: .page) { r in done(try? r.get()) }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
      // Local first (V1.44): no holding back any more; the page's Sign in offers Start now and opens this window.
      checks.append(("fresh-mac-opens-the-page-local-first", !s.holding && a.main.url != nil))
      s.show(mode: .change)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
      checks.append(("setup-window-ready", s.window != nil && s.ready))
      checks.append(("nothing-linked-yet", ProjectStore.current == nil && ProjectStore.isRed))
      // Just updated (a fictional journal: this build was swapped in): the setup window must count as the
      // started page, or the updater would roll the new build back while it waits for a project.
      UpdateJournal(phase: "swapped", from: 1, to: PSVersion.mine, target: dir + "/Applications/PS.app", previous: "", failed: "", socket: "",
                    attempts: 1, at: Date().timeIntervalSince1970, shown: false, test: true).write()
      js("webkit.messageHandlers.sb.postMessage(JSON.stringify({ type: 'ready' })); return true", in: s.web) { _ in }
      DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
      js("document.getElementById('token').value = 'not-a-token'; document.getElementById('go').click(); await new Promise(r => setTimeout(r, 400)); return document.getElementById('tErr').textContent", in: s.web) { r in
        checks.append(("bad-token-plain-words", (r as? String)?.contains("starts with sbp_") == true))
        js("return { title: document.getElementById('sTitle').textContent, steps: document.querySelectorAll('.three li').length, skip: !document.getElementById('skip').classList.contains('hidden'), field: document.getElementById('token').value }", in: s.web) { r in
          let o = r as? [String: Any] ?? [:]
          checks.append(("three-steps", o["title"] as? String == "Connect your own Supabase" && o["steps"] as? Int == 3))
          checks.append(("token-field-cleared-after-send", (o["field"] as? String) == ""))
          // Link a fictional project, as the window does when the setup finished.
          let p = PSProject(url: "https://\(ref).supabase.co", key: key, ref: ref, name: "ps-vault", setupCode: "Abcdefghjkmnpqrs2345abcd", kit: "test")
          s.apply(p)
          DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            let attrs = try? FileManager.default.attributesOfItem(atPath: ProjectStore.file.path)
            checks.append(("saved-0600-in-test-folder", ProjectStore.file.path.hasPrefix(dir) && (attrs?[.posixPermissions] as? NSNumber)?.intValue == 0o600))
            checks.append(("page-loaded-after-link", !s.holding && a.main.url?.absoluteString == "ps://app/client/"))
            checks.append(("page-policy-only-this-project", CSP.contains("connect-src 'self' https://\(ref).supabase.co wss://\(ref).supabase.co \(ProjectStore.squadHub);") && !CSP.contains(ProjectStore.redRef)
              && !CSP.contains(ProjectStore.squadHub.replacingOccurrences(of: "https://", with: "wss://"))))   // plus the G Squad hub, https only (V1.40)
            Owner.set(true)
            checks.append(("red-features-off-on-another-project", !Owner.red))
            js("return { p: window.__psProject ? { url: window.__psProject.url, code: !!window.__psProject.setupCode, frozen: Object.isFrozen(window.__psProject) } : null, create: document.body.innerText.includes('Create your PS account'), errs: (window.__errs || []).length }", in: a.main) { r in
              let o = r as? [String: Any] ?? [:]
              let pp = o["p"] as? [String: Any] ?? [:]
              checks.append(("page-got-the-project-first", pp["url"] as? String == "https://\(ref).supabase.co" && pp["code"] as? Bool == true && pp["frozen"] as? Bool == true))
              checks.append(("create-account-shown", o["create"] as? Bool == true))
              s.accountCreated()
              checks.append(("setup-code-forgotten-after-account", ProjectStore.current?.setupCode == nil && ProjectStore.load()?.setupCode == nil))
              // Signed out, updates must still be reachable: the Tab list page said hello (so the background check
              // only feeds its gear, which a signed out list does not show), so the signed out list carries the
              // update row, and PS menu > Check for Updates... still brings the card (the route on V1.35).
              js("return !!document.querySelector('.ps-locked-upd')", in: a.overlay) { r in
                checks.append(("signed-out-list-has-the-update-row", r as? Bool == true))
                checks.append(("tab-list-said-hello-signed-out", Updater.shared.pageOn))
                a.checkUpdates()
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                  checks.append(("menu-check-for-updates-shows-the-card-signed-out", Updater.shared.ui?.window.isVisible == true))
                  Updater.shared.ui?.close()
                  print("PROJECT CHECK:", checks.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " "))
                  print(ScreenGuard.report()); print(NetGuard.report()); print("DONE"); exit(checks.allSatisfy { $0.1 } ? 0 : 1)
                }
              }
            }
          }
        }
      }
      }
    }
  }
}
