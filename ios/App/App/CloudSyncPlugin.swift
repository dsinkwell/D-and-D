import Capacitor
import Foundation

/// iCloud sync for the user's own data (characters, lists, homebrew, house rules, bookmarks,
/// Jump to buttons, a few settings) through iCloud key-value storage: it syncs between all the
/// devices signed in to the same Apple ID, needs no server or database setup, and holds up to
/// 1 MB / 1,024 keys — plenty for this data. The JavaScript side (src/lib/cloud.ts) decides what
/// to store and merges by "last changed wins" per record.
///
/// JavaScript:  CloudSync.status() → { signedIn, keys, bytes }
///              CloudSync.getAll() → { values: { key: string } }
///              CloudSync.set({ key, value }) / CloudSync.remove({ key })
///              CloudSync.addListener('cloudChanged', ({ values, reason }) => …)   // from other devices
///                (values[key] is null when the key was removed)
@objc(CloudSyncPlugin)
public class CloudSyncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CloudSyncPlugin"
    public let jsName = "CloudSync"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
    ]

    private let store = NSUbiquitousKeyValueStore.default

    override public func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(changedExternally(_:)),
            name: NSUbiquitousKeyValueStore.didChangeExternallyNotification, object: store)
        store.synchronize()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func changedExternally(_ note: Notification) {
        let keys = note.userInfo?[NSUbiquitousKeyValueStoreChangedKeysKey] as? [String] ?? []
        let reason = note.userInfo?[NSUbiquitousKeyValueStoreChangeReasonKey] as? Int ?? -1
        var values: [String: Any] = [:]
        for key in keys {
            values[key] = store.string(forKey: key) ?? NSNull()
        }
        // reason: 0 server change, 1 initial sync, 2 quota exceeded, 3 account changed
        notifyListeners("cloudChanged", data: ["values": values, "reason": reason])
    }

    @objc func status(_ call: CAPPluginCall) {
        let all = store.dictionaryRepresentation
        var bytes = 0
        for (k, v) in all {
            bytes += k.utf8.count
            if let s = v as? String { bytes += s.utf8.count }
        }
        call.resolve([
            "signedIn": FileManager.default.ubiquityIdentityToken != nil,
            "keys": all.count,
            "bytes": bytes,
        ])
    }

    @objc func getAll(_ call: CAPPluginCall) {
        store.synchronize()
        var out: [String: String] = [:]
        for (k, v) in store.dictionaryRepresentation {
            if let s = v as? String { out[k] = s }
        }
        call.resolve(["values": out])
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = call.getString("value") else {
            call.reject("key and value are required")
            return
        }
        store.set(value, forKey: key)
        store.synchronize()
        call.resolve()
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("key is required")
            return
        }
        store.removeObject(forKey: key)
        store.synchronize()
        call.resolve()
    }
}
