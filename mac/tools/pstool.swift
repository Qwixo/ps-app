// pstool: the release side of PS's updater (Sources/Updater*.swift). Runs on the developer's Mac only.
//   pstool keygen <key file>                 a new Ed25519 key (32 raw bytes, 0600); prints the public key
//   pstool pub <key file>                    prints the public key (base64) of a key file
//   pstool sign <key file> <payload> <out>   writes the signed manifest: {"signed": b64(payload), "sig": b64(sig)}
//   pstool verify <pub b64> <manifest>       checks a signed manifest (exit 0 when good)
//   pstool sha256 <file>                     hex SHA-256 of a file
//   pstool notify <name>                     posts a distributed notification (build.sh asks PS to install)
// The private key never leaves signing/ (gitignored, next to the signing keychain).
import CryptoKit
import Foundation

func die(_ s: String) -> Never { FileHandle.standardError.write(Data((s + "\n").utf8)); exit(1) }
let args = CommandLine.arguments
guard args.count >= 3 else { die("usage: pstool keygen|pub|sign|verify|sha256 ...") }

func loadKey(_ path: String) -> Curve25519.Signing.PrivateKey {
  guard let raw = FileManager.default.contents(atPath: path), let k = try? Curve25519.Signing.PrivateKey(rawRepresentation: raw) else { die("cannot read key \(path)") }
  return k
}

switch args[1] {
case "keygen":
  let path = args[2]
  if FileManager.default.fileExists(atPath: path) { die("refusing to overwrite \(path)") }
  let k = Curve25519.Signing.PrivateKey()
  guard FileManager.default.createFile(atPath: path, contents: k.rawRepresentation, attributes: [.posixPermissions: 0o600]) else { die("cannot write \(path)") }
  print(k.publicKey.rawRepresentation.base64EncodedString())
case "pub":
  print(loadKey(args[2]).publicKey.rawRepresentation.base64EncodedString())
case "sign":
  guard args.count == 5, let payload = FileManager.default.contents(atPath: args[3]) else { die("usage: pstool sign <key> <payload> <out>") }
  // The payload must be a JSON object; PS reads exactly these bytes after checking the signature.
  guard (try? JSONSerialization.jsonObject(with: payload)) is [String: Any] else { die("payload is not a JSON object") }
  let sig = try! loadKey(args[2]).signature(for: payload)
  let out = try! JSONSerialization.data(withJSONObject: ["signed": payload.base64EncodedString(), "sig": sig.base64EncodedString(), "key": "ps-update-1"], options: [.sortedKeys])
  try! out.write(to: URL(fileURLWithPath: args[4]), options: .atomic)
case "verify":
  guard args.count == 4, let pub = Data(base64Encoded: args[2]), let key = try? Curve25519.Signing.PublicKey(rawRepresentation: pub),
        let raw = FileManager.default.contents(atPath: args[3]),
        let o = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
        let signed = (o["signed"] as? String).flatMap({ Data(base64Encoded: $0) }), let sig = (o["sig"] as? String).flatMap({ Data(base64Encoded: $0) })
  else { die("bad input") }
  if key.isValidSignature(sig, for: signed) { print("good") } else { die("BAD SIGNATURE") }
case "sha256":
  guard let h = FileHandle(forReadingAtPath: args[2]) else { die("cannot read \(args[2])") }
  var sha = SHA256()
  while let d = try? h.read(upToCount: 1 << 20), !d.isEmpty { sha.update(data: d) }
  print(sha.finalize().map { String(format: "%02x", $0) }.joined())
case "notify":
  DistributedNotificationCenter.default().postNotificationName(Notification.Name(args[2]), object: nil, userInfo: nil, deliverImmediately: true)
default:
  die("unknown command \(args[1])")
}
