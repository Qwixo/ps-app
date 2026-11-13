// End to end, LOCAL ONLY: PS's real setup code (Project.swift, SupabaseAPI.swift, SetupGuideCore.swift, ProjectEngine.swift) against a
// local stand in for api.supabase.com (web supabase/tests/own-project/mgmt-adapter.mjs) that drives a
// local Supabase under Colima. Creates "ps-vault", waits, applies the kit, deploys vault-auth, checks it answers
// on the LOCAL functions server, and leaves a setup code. Prints the result as JSON on the last line.
//   project-e2e <kit folder> <adapter url> <local supabase url>
import Foundation

setvbuf(stdout, nil, _IONBF, 0)
func psLog(_ s: String) { print("log: \(s)") }
let a = CommandLine.arguments
guard a.count == 4, let adapter = URL(string: a[2]), adapter.host == "127.0.0.1", a[3].hasPrefix("http://127.0.0.1:") else { print("local only"); exit(2) }
let local = a[3]
let done = DispatchSemaphore(value: 0)
var code: Int32 = 1
DispatchQueue.global().async {
  defer { done.signal() }
  do {
    let kit = try ProjectKit.load(URL(fileURLWithPath: a[1], isDirectory: true))
    let api = SupabaseAPI(token: "sbp_" + String(repeating: "e2e0", count: 10), base: adapter)
    let orgs = try api.orgs()
    print("orgs: \(orgs.map(\.slug))")
    let e = ProjectEngine(api: api, kit: kit)
    e.poll = 0.5
    e.report = { s, st, f, d in print("step: \(s.rawValue) \(st) \(f.map { String(format: "%.2f", $0) } ?? "-") \(d ?? "")") }
    // The function check goes to the LOCAL functions server instead of https://<ref>.supabase.co.
    let real = e.checkFunction
    e.checkFunction = { _, key in real(local, key) }
    let made = try e.create(org: orgs[0].slug, region: ProjectEngine.region(forTimeZone: TimeZone.current.identifier))
    let p = try e.finish(ref: made.ref, name: made.name)
    // A second run on the same project: nothing applied twice, no new setup code needed, same answer.
    let again = try e.migrate(ref: made.ref, schema: p.dbSchema)
    print("second run applied: \(again)")
    let out: [String: Any] = ["ref": p.ref, "key": p.key, "setupCode": p.setupCode ?? NSNull(), "kit": p.kit ?? "", "functions": p.functions ?? [:], "secondRun": again, "schema": p.dbSchema]
    print(String(data: try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]), encoding: .utf8)!)
    code = again == 0 && p.setupCode != nil ? 0 : 1
  } catch { print("FAILED: \(error)") }
}
done.wait()
exit(code)
