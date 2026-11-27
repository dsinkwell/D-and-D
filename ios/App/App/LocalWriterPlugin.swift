import Capacitor
import CryptoKit
import Foundation
import LlamaSPM

/// Written answers on devices without Apple Intelligence: a small open model (GGUF, run with
/// llama.cpp) downloaded once from Hugging Face and kept in the app's storage.
///
/// JavaScript:  LocalWriter.status() → { capable, memoryGB, models: [{ id, name, mb, downloaded, fits }] }
///              LocalWriter.download({ model }) → {}            events: 'localDownload' { model, received, total }
///              LocalWriter.cancelDownload() / remove({ model })
///              LocalWriter.write({ id, model, instructions, prompt, maxTokens }) → { text, promptTokens, tokens, loadMs }
///                                                               events: 'localWriter' { id, text }
@objc(LocalWriterPlugin)
public class LocalWriterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LocalWriterPlugin"
    public let jsName = "LocalWriter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
    ]

    struct Model {
        let id: String, name: String, url: String, file: String, sha256: String, bytes: Int64, minMemoryGB: Double
    }

    // Pinned to exact revisions; the download is checked against Hugging Face's SHA-256.
    static let models: [Model] = [
        Model(id: "gemma3-1b", name: "Gemma 3 1B",
              url: "https://huggingface.co/bartowski/google_gemma-3-1b-it-GGUF/resolve/116f76234503685a98f572982177b11d44ec8ff1/google_gemma-3-1b-it-Q4_K_M.gguf",
              file: "google_gemma-3-1b-it-Q4_K_M.gguf",
              sha256: "12bf0fff8815d5f73a3c9b586bd8fee8e7b248c935de70dec367679873d0f29d", bytes: 806_058_496, minMemoryGB: 3.6),
        Model(id: "qwen25-1.5b", name: "Qwen 2.5 1.5B",
              url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf",
              file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
              sha256: "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e", bytes: 1_117_320_736, minMemoryGB: 5.5),
    ]

    private let runner = LlamaRunner()
    private let queue = DispatchQueue(label: "local-writer", qos: .userInitiated)
    private var downloader: Downloader?

    private var memoryGB: Double { Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824 }

    static var folder: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var dir = base.appendingPathComponent("WritingModels", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
        return dir
    }
    static func path(_ m: Model) -> URL { folder.appendingPathComponent(m.file) }
    static func find(_ id: String?) -> Model? { models.first { $0.id == id } }

    @objc func status(_ call: CAPPluginCall) {
        let mem = memoryGB
        let list = Self.models.map { m -> [String: Any] in
            ["id": m.id, "name": m.name, "mb": Int(m.bytes / 1_000_000),
             "downloaded": FileManager.default.fileExists(atPath: Self.path(m).path),
             "fits": mem >= m.minMemoryGB]
        }
        call.resolve(["capable": mem >= Self.models[0].minMemoryGB, "memoryGB": (mem * 10).rounded() / 10,
                      "models": list, "downloading": downloader?.model.id ?? NSNull()])
    }

    @objc func download(_ call: CAPPluginCall) {
        guard let m = Self.find(call.getString("model")) else { return call.reject("Unknown model") }
        if FileManager.default.fileExists(atPath: Self.path(m).path) { return call.resolve() }
        if downloader != nil { return call.reject("A download is already running.") }
        let d = Downloader(model: m, progress: { [weak self] received, total in
            self?.notifyListeners("localDownload", data: ["model": m.id, "received": received, "total": total])
        }, done: { [weak self] error in
            self?.downloader = nil
            if let error { call.reject(error) } else { call.resolve() }
        })
        downloader = d
        d.start()
    }

    @objc func cancelDownload(_ call: CAPPluginCall) {
        downloader?.cancel()
        downloader = nil
        call.resolve()
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let m = Self.find(call.getString("model")) else { return call.reject("Unknown model") }
        queue.async {
            if self.runner.loadedPath == Self.path(m).path { self.runner.unload() }
            try? FileManager.default.removeItem(at: Self.path(m))
            call.resolve()
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let m = Self.find(call.getString("model")) else { return call.reject("Unknown model") }
        let file = Self.path(m)
        guard FileManager.default.fileExists(atPath: file.path) else { return call.reject("The writing model isn't downloaded.") }
        let id = call.getString("id") ?? ""
        let instructions = call.getString("instructions") ?? ""
        let prompt = call.getString("prompt") ?? ""
        let maxTokens = call.getInt("maxTokens") ?? 300
        queue.async {
            do {
                let t0 = Date()
                try self.runner.load(path: file.path)
                let loadMs = Int(Date().timeIntervalSince(t0) * 1000)
                let full = self.runner.chatPrompt(system: instructions, user: prompt)
                var last = Date.distantPast
                var finalText = ""
                let r = try self.runner.generate(prompt: full, maxTokens: maxTokens) { text in
                    finalText = text
                    if Date().timeIntervalSince(last) > 0.05 { // don't flood the web view
                        last = Date()
                        self.notifyListeners("localWriter", data: ["id": id, "text": text])
                    }
                    return true
                }
                self.notifyListeners("localWriter", data: ["id": id, "text": finalText])
                call.resolve(["text": finalText, "promptTokens": r.promptTokens, "tokens": r.tokens, "loadMs": loadMs])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }
}

/// Downloads one model file with progress, checks its SHA-256, and moves it into place.
final class Downloader: NSObject, URLSessionDownloadDelegate {
    let model: LocalWriterPlugin.Model
    private let progress: (Int64, Int64) -> Void
    private let done: (String?) -> Void
    private var session: URLSession?
    private var lastReport = Date.distantPast
    private var finished = false

    init(model: LocalWriterPlugin.Model, progress: @escaping (Int64, Int64) -> Void, done: @escaping (String?) -> Void) {
        self.model = model
        self.progress = progress
        self.done = done
    }

    func start() {
        let s = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        session = s
        s.downloadTask(with: URL(string: model.url)!).resume()
    }

    func cancel() {
        finished = true
        session?.invalidateAndCancel()
    }

    private func finish(_ error: String?) {
        guard !finished else { return }
        finished = true
        session?.finishTasksAndInvalidate()
        done(error)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if Date().timeIntervalSince(lastReport) > 0.25 {
            lastReport = Date()
            progress(totalBytesWritten, totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : model.bytes)
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // the temporary file disappears when this returns, so check and move it now
        do {
            let handle = try FileHandle(forReadingFrom: location)
            defer { try? handle.close() }
            var hasher = SHA256()
            while let chunk = try handle.read(upToCount: 8 * 1024 * 1024), !chunk.isEmpty { hasher.update(data: chunk) }
            let hex = hasher.finalize().map { String(format: "%02x", $0) }.joined()
            guard hex == model.sha256 else { return finish("The download was damaged (checksum mismatch). Please try again.") }
            let dest = LocalWriterPlugin.path(model)
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.moveItem(at: location, to: dest)
            progress(model.bytes, model.bytes)
            finish(nil)
        } catch {
            finish("Couldn't save the model: \(error.localizedDescription)")
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { finish("Download failed: \(error.localizedDescription)") }
    }
}
