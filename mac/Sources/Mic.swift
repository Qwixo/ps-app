import CoreAudio
import Foundation

// The Mac's default microphone (System Settings > Sound > Input): every app that uses "the
// default input" follows it. PS > Tab list > Settings lists the inputs and switches it when the developer
// picks one. Nothing changes unless he picks a microphone himself.
enum Mic {
  struct Device { let id: AudioDeviceID; let uid: String; let name: String }

  private static func addr(_ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: kAudioObjectPropertyElementMain)
  }

  private static func string(_ id: AudioObjectID, _ sel: AudioObjectPropertySelector) -> String? {
    var a = addr(sel)
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(id, &a, 0, nil, &size, &value) == noErr, let v = value else { return nil }
    return v.takeRetainedValue() as String
  }

  private static func hasInput(_ id: AudioDeviceID) -> Bool {
    var a = addr(kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyScopeInput)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(id, &a, 0, nil, &size) == noErr, size > 0 else { return false }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(id, &a, 0, nil, &size, raw) == noErr else { return false }
    let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
    return list.reduce(0) { $0 + Int($1.mNumberChannels) } > 0
  }

  /// Every microphone the Mac can see right now.
  static func inputs() -> [Device] {
    var a = addr(kAudioHardwarePropertyDevices)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size) == noErr else { return [] }
    var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size, &ids) == noErr else { return [] }
    return ids.compactMap { id in
      guard hasInput(id), let uid = string(id, kAudioDevicePropertyDeviceUID), let name = string(id, kAudioObjectPropertyName) else { return nil }
      return Device(id: id, uid: uid, name: name)
    }
  }

  static func currentID() -> AudioDeviceID {
    var a = addr(kAudioHardwarePropertyDefaultInputDevice)
    var id = AudioDeviceID(0)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size, &id)
    return id
  }

  /// Make this microphone the Mac's default input. Only called from the developer's own pick in Settings.
  @discardableResult
  static func setDefault(uid: String) -> Bool {
    guard let d = inputs().first(where: { $0.uid == uid }) else { return false }
    var a = addr(kAudioHardwarePropertyDefaultInputDevice)
    var id = d.id
    return AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, UInt32(MemoryLayout<AudioDeviceID>.size), &id) == noErr
  }

  /// {"type":"mic","current":"<uid>","devices":[{"uid":..,"name":..}]}
  static func stateJSON() -> String {
    let list = inputs()
    let cur = currentID()
    let obj: [String: Any] = [
      "type": "mic",
      "current": list.first(where: { $0.id == cur })?.uid ?? "",
      "devices": list.map { ["uid": $0.uid, "name": $0.name] },
    ]
    let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
    return String(data: data, encoding: .utf8) ?? #"{"type":"mic","current":"","devices":[]}"#
  }

  /// Tell PS whenever a microphone is plugged in or out, or the default changes elsewhere.
  static func watch(_ changed: @escaping () -> Void) {
    for sel in [kAudioHardwarePropertyDevices, kAudioHardwarePropertyDefaultInputDevice] {
      var a = addr(sel)
      AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &a, DispatchQueue.main) { _, _ in changed() }
    }
  }
}
