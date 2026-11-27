import Capacitor
import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// "Write an answer": Apple's on-device language model (Foundation Models, iOS/iPadOS/macOS 26+
/// with Apple Intelligence) writes a short answer from the passages the Ask search found.
/// Runs entirely on the device; nothing is sent anywhere and there is no cost.
///
/// JavaScript:  Writer.availability() → { available, reason? }
///              Writer.write({ id, instructions, prompt, maxTokens }) → { text }
///              Writer.addListener('writer', ({ id, text }) => …)   // text so far, while writing
@objc(WriterPlugin)
public class WriterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WriterPlugin"
    public let jsName = "Writer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prewarm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
    ]

    @objc func availability(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                call.resolve(["available": true])
            case .unavailable(let reason):
                call.resolve(["available": false, "reason": Self.describe(reason)])
            @unknown default:
                call.resolve(["available": false, "reason": "unknown"])
            }
            return
        }
        #endif
        call.resolve(["available": false, "reason": "needs iOS 26 or later"])
    }

    @objc func prewarm(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            LanguageModelSession(instructions: call.getString("instructions") ?? "").prewarm()
        }
        #endif
        call.resolve()
    }

    @objc func write(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let id = call.getString("id") ?? ""
            let instructions = call.getString("instructions") ?? ""
            let prompt = call.getString("prompt") ?? ""
            let maxTokens = call.getInt("maxTokens") ?? 300
            Task {
                do {
                    let session = LanguageModelSession(instructions: instructions)
                    let options = GenerationOptions(temperature: 0.2, maximumResponseTokens: maxTokens)
                    var text = ""
                    for try await snapshot in session.streamResponse(to: prompt, options: options) {
                        text = snapshot.content
                        self.notifyListeners("writer", data: ["id": id, "text": text])
                    }
                    call.resolve(["text": text])
                } catch {
                    call.reject(Self.describe(error))
                }
            }
            return
        }
        #endif
        call.reject("Writing answers needs iOS 26 or later with Apple Intelligence.")
    }

    #if canImport(FoundationModels)
    @available(iOS 26.0, *)
    static func describe(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
        switch reason {
        case .deviceNotEligible: return "This device doesn't support Apple Intelligence."
        case .appleIntelligenceNotEnabled: return "Turn on Apple Intelligence in Settings to write answers."
        case .modelNotReady: return "Apple Intelligence is still getting ready (downloading). Try again later."
        @unknown default: return "Apple Intelligence isn't available."
        }
    }

    @available(iOS 26.0, *)
    static func describe(_ error: Error) -> String {
        if let e = error as? LanguageModelSession.GenerationError {
            switch e {
            case .guardrailViolation: return "Apple's safety filter declined to answer this one."
            case .exceededContextWindowSize: return "The sources were too long for the model."
            default: return "The model couldn't answer: \(e.localizedDescription)"
            }
        }
        return error.localizedDescription
    }
    #endif
}
