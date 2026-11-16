// The real connection for Proton Mail through Bridge (PS 1.65): a socket to 127.0.0.1 (or ::1) only, with STARTTLS that accepts
// Bridge's self signed certificate and hands its fingerprint to the caller, who pins it (ProtonBridgeCore.swift). No AppKit, no
// Keychain, so tests/proton-transport-test.sh runs it against a fake server of its own on loopback.
import Foundation
import Security

/// A connection to a loopback address. The address is checked again here, so no other code path can reach a remote host.
/// Plain at first; startTLS() upgrades it and accepts Bridge's self signed certificate (the caller pins its fingerprint).
final class LoopbackTransport: ProtonTransport {
  private var input: InputStream
  private var output: OutputStream
  private var rs: CFReadStream
  private var buf = Data()
  private var tlsOn = false
  private var fd: Int32 = -1
  private let timeout: TimeInterval
  private let lock = NSLock()
  private var timedOut = false
  private var closed = false
  private let wd = DispatchQueue(label: "ps.proton.watchdog", qos: .utility)
  private let opEnd: Date             // the whole connection may not take longer than this, however slowly the other end trickles

  init(host: String, port: Int, timeout: TimeInterval = 15) throws {
    guard let h = ProtonGuard.loopback(host), ProtonGuard.validPort(port) else { throw ProtonError.notLoopback }
    self.timeout = timeout
    opEnd = Date().addingTimeInterval(max(timeout * 4, 20))
    var r: Unmanaged<CFReadStream>?, w: Unmanaged<CFWriteStream>?
    CFStreamCreatePairWithSocketToHost(nil, h as CFString, UInt32(port), &r, &w)
    guard let read = r?.takeRetainedValue(), let write = w?.takeRetainedValue() else { throw ProtonError.bridgeDown }
    rs = read; input = read as InputStream; output = write as OutputStream
    CFReadStreamSetProperty(read, CFStreamPropertyKey(rawValue: kCFStreamPropertyShouldCloseNativeSocket), kCFBooleanTrue)
    input.open(); output.open()
    let end = Date().addingTimeInterval(timeout)
    while input.streamStatus == .opening || output.streamStatus == .opening {
      if Date() > end { close(); throw ProtonError.timeout }
      Thread.sleep(forTimeInterval: 0.02)
    }
    guard input.streamStatus == .open, output.streamStatus == .open else { close(); throw ProtonError.bridgeDown }
    if let d = CFReadStreamCopyProperty(read, CFStreamPropertyKey.socketNativeHandle) as? Data, d.count >= 4 {
      fd = d.withUnsafeBytes { $0.load(as: Int32.self) }
      var tv = timeval(tv_sec: Int(timeout), tv_usec: 0)
      setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
      setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    }
  }

  /// SO_RCVTIMEO is not honoured by every CFStream read, so a watchdog does the real timing: when a read or write has waited
  /// too long it shuts the socket and closes the streams, which wakes the blocked call. Returns the cancel handle.
  private func arm() -> DispatchWorkItem {
    let left = max(0.05, min(timeout, opEnd.timeIntervalSinceNow))
    let w = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.lock.lock(); self.timedOut = true; self.lock.unlock()
      // Shutting the socket wakes a blocked read or write at once (closing a stream another thread is blocked in can deadlock).
      if self.fd >= 0 { shutdown(self.fd, SHUT_RDWR) } else { self.input.close(); self.output.close() }
    }
    wd.asyncAfter(deadline: .now() + left, execute: w)
    return w
  }
  private var didTimeOut: Bool { lock.lock(); defer { lock.unlock() }; return timedOut }

  func send(_ data: Data) throws {
    if didTimeOut { throw ProtonError.timeout }
    let w = arm(); defer { w.cancel() }
    var sent = 0
    let all = [UInt8](data)
    while sent < all.count {
      let n = all[sent...].withUnsafeBufferPointer { output.write($0.baseAddress!, maxLength: $0.count) }
      if n <= 0 { throw didTimeOut || output.streamError != nil || n < 0 ? ProtonError.timeout : ProtonError.bridgeDown }
      sent += n
    }
  }
  private func fill() throws {
    if didTimeOut { throw ProtonError.timeout }
    var chunk = [UInt8](repeating: 0, count: 16384)
    let w = arm(); defer { w.cancel() }
    let n = input.read(&chunk, maxLength: chunk.count)
    if didTimeOut { throw ProtonError.timeout }       // the watchdog woke us: Bridge accepted and then said nothing
    if n == 0 { throw ProtonError.bridgeDown }       // the other end closed
    if n < 0 { throw ProtonError.timeout }
    buf.append(contentsOf: chunk[0..<n])
  }
  func readLine() throws -> String {
    while true {
      if let r = buf.range(of: Data("\r\n".utf8)) {
        let s = String(decoding: buf[buf.startIndex..<r.lowerBound], as: UTF8.self)
        buf.removeSubrange(buf.startIndex..<r.upperBound)
        return s
      }
      if buf.count > 1_000_000 { throw ProtonError.protocolError("line too long") }
      try fill()
    }
  }
  func readBytes(_ n: Int) throws -> Data {
    while buf.count < n { try fill() }
    let d = Data(buf.prefix(n)); buf.removeFirst(n); return d
  }
  func startTLS() throws {
    guard !tlsOn else { return }
    let settings: [String: Any] = [kCFStreamSSLValidatesCertificateChain as String: false]   // Bridge's own certificate: pinned by the caller instead
    CFReadStreamSetProperty(rs, CFStreamPropertyKey(rawValue: kCFStreamPropertySSLSettings), settings as CFDictionary)
    CFWriteStreamSetProperty(output as CFWriteStream, CFStreamPropertyKey(rawValue: kCFStreamPropertySSLSettings), settings as CFDictionary)
    guard input.setProperty(StreamSocketSecurityLevel.negotiatedSSL, forKey: .socketSecurityLevelKey),
          output.setProperty(StreamSocketSecurityLevel.negotiatedSSL, forKey: .socketSecurityLevelKey) else { throw ProtonError.protocolError("tls") }
    // The settings must be set after the level (the stream resets them): once more.
    CFReadStreamSetProperty(rs, CFStreamPropertyKey(rawValue: kCFStreamPropertySSLSettings), settings as CFDictionary)
    CFWriteStreamSetProperty(output as CFWriteStream, CFStreamPropertyKey(rawValue: kCFStreamPropertySSLSettings), settings as CFDictionary)
    tlsOn = true
    buf.removeAll()
  }
  /// TLS 1.2 or newer: a lower version is treated like an unknown certificate (the check stops before any password is sent).
  private func tlsAtLeast12() -> Bool {
    guard let any = CFReadStreamCopyProperty(rs, CFStreamPropertyKey(rawValue: kCFStreamPropertySSLContext)), CFGetTypeID(any) == SSLContextGetTypeID() else { return true }   // cannot read it: the pin still decides
    var v = SSLProtocol.sslProtocolUnknown
    guard SSLGetNegotiatedProtocolVersion(any as! SSLContext, &v) == errSecSuccess else { return true }
    return v == .tlsProtocol12 || v == .tlsProtocol13
  }
  func peerFingerprint() -> String? {
    guard tlsOn, tlsAtLeast12(), let any = CFReadStreamCopyProperty(rs, CFStreamPropertyKey(rawValue: kCFStreamPropertySSLPeerTrust)), CFGetTypeID(any) == SecTrustGetTypeID() else { return nil }
    let trust = any as! SecTrust
    let cert: SecCertificate?
    if #available(macOS 12.0, *) { cert = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first } else { cert = SecTrustGetCertificateAtIndex(trust, 0) }
    guard let c = cert else { return nil }
    return ProtonPin.fingerprint(SecCertificateCopyData(c) as Data)
  }
  func close() {
    lock.lock(); let was = closed; closed = true; lock.unlock()
    if !was { input.close(); output.close() }
  }
}

