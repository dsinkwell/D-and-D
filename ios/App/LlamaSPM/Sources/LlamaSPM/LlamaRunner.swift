import Foundation
import llama

public struct LlamaError: LocalizedError {
    public let message: String
    public var errorDescription: String? { message }
    init(_ m: String) { message = m }
}

/// Runs a GGUF model with llama.cpp on the device (Metal GPU when available).
/// Not thread-safe: call from one serial queue.
public final class LlamaRunner {
    private var model: OpaquePointer?
    private var ctx: OpaquePointer?
    private var vocab: OpaquePointer?
    public private(set) var loadedPath: String?
    private static var backendReady = false

    public init() {}
    deinit { unload() }

    public func unload() {
        if let ctx { llama_free(ctx) }
        if let model { llama_model_free(model) }
        ctx = nil; model = nil; vocab = nil; loadedPath = nil
    }

    /// Load a model file (no-op if it's already loaded).
    public func load(path: String, contextTokens: UInt32 = 3072) throws {
        if loadedPath == path, ctx != nil { return }
        unload()
        if !Self.backendReady {
            llama_backend_init()
            Self.backendReady = true
        }
        var mp = llama_model_default_params()
        mp.n_gpu_layers = 99 // everything on the GPU
        guard let m = llama_model_load_from_file(path, mp) else { throw LlamaError("Couldn't load the writing model.") }
        var cp = llama_context_default_params()
        cp.n_ctx = contextTokens
        cp.n_batch = 512
        cp.n_ubatch = 512
        let threads = Int32(max(1, min(4, ProcessInfo.processInfo.activeProcessorCount - 2)))
        cp.n_threads = threads
        cp.n_threads_batch = threads
        guard let c = llama_init_from_model(m, cp) else {
            llama_model_free(m)
            throw LlamaError("Not enough memory to start the writing model.")
        }
        model = m
        ctx = c
        vocab = llama_model_get_vocab(m)
        loadedPath = path
    }

    /// Format a system + user message with the model's own chat template.
    public func chatPrompt(system: String, user: String) -> String {
        let fallback = "\(system)\n\n\(user)\n\nAnswer:"
        guard let model else { return fallback }
        let tmpl = llama_model_chat_template(model, nil)
        let parts = [strdup("system"), strdup(system), strdup("user"), strdup(user)]
        defer { parts.forEach { free($0) } }
        var msgs = [
            llama_chat_message(role: UnsafePointer(parts[0]), content: UnsafePointer(parts[1])),
            llama_chat_message(role: UnsafePointer(parts[2]), content: UnsafePointer(parts[3])),
        ]
        var buf = [CChar](repeating: 0, count: (system.utf8.count + user.utf8.count) * 2 + 1024)
        var n = llama_chat_apply_template(tmpl, &msgs, msgs.count, true, &buf, Int32(buf.count))
        if n > Int32(buf.count) {
            buf = [CChar](repeating: 0, count: Int(n) + 1)
            n = llama_chat_apply_template(tmpl, &msgs, msgs.count, true, &buf, Int32(buf.count))
        }
        guard n > 0 else { return fallback }
        return String(decoding: buf[0..<Int(n)].map { UInt8(bitPattern: $0) }, as: UTF8.self)
    }

    /// Generate up to `maxTokens` tokens; `onText` gets the full text so far and returns false to stop.
    @discardableResult
    public func generate(prompt: String, maxTokens: Int, onText: (String) -> Bool) throws -> (promptTokens: Int, tokens: Int) {
        guard let ctx, let vocab else { throw LlamaError("The writing model isn't loaded.") }
        llama_memory_clear(llama_get_memory(ctx), true)

        // tokenize (the chat template already contains any special tokens)
        let byteCount = prompt.utf8.count
        var tokens = [llama_token](repeating: 0, count: byteCount + 16)
        let n = llama_tokenize(vocab, prompt, Int32(byteCount), &tokens, Int32(tokens.count), false, true)
        guard n > 0 else { throw LlamaError("Couldn't read the question.") }
        tokens = Array(tokens[0..<Int(n)])
        let room = Int(llama_n_ctx(ctx)) - maxTokens - 8
        guard tokens.count <= room else { throw LlamaError("The sources were too long for the writing model.") }

        // read the prompt in batches
        var i = 0
        while i < tokens.count {
            let end = min(i + 512, tokens.count)
            var chunk = Array(tokens[i..<end])
            let rc = chunk.withUnsafeMutableBufferPointer { llama_decode(ctx, llama_batch_get_one($0.baseAddress, Int32($0.count))) }
            if rc != 0 { throw LlamaError("The writing model stopped (\(rc)).") }
            i = end
        }

        // greedy, with a light repetition penalty (applied to the top 40 candidates)
        let smpl = llama_sampler_chain_init(llama_sampler_chain_default_params())
        defer { llama_sampler_free(smpl) }
        llama_sampler_chain_add(smpl, llama_sampler_init_top_k(40))
        llama_sampler_chain_add(smpl, llama_sampler_init_penalties(llama_vocab_n_tokens(vocab), 64, 1.1, 0, 0))
        llama_sampler_chain_add(smpl, llama_sampler_init_greedy())

        var produced = 0
        var pending: [UInt8] = []
        var text = ""
        while produced < maxTokens {
            var tok = llama_sampler_sample(smpl, ctx, -1)
            if llama_vocab_is_eog(vocab, tok) { break }
            var piece = [CChar](repeating: 0, count: 64)
            var len = llama_token_to_piece(vocab, tok, &piece, Int32(piece.count), 0, false)
            if len < 0 {
                piece = [CChar](repeating: 0, count: Int(-len))
                len = llama_token_to_piece(vocab, tok, &piece, Int32(piece.count), 0, false)
            }
            if len > 0 { pending.append(contentsOf: piece[0..<Int(len)].map { UInt8(bitPattern: $0) }) }
            if let s = String(bytes: pending, encoding: .utf8) { // wait for whole UTF-8 characters
                text += s
                pending.removeAll()
                if !onText(text) { break }
            }
            produced += 1
            let rc = withUnsafeMutablePointer(to: &tok) { llama_decode(ctx, llama_batch_get_one($0, 1)) }
            if rc != 0 { break }
        }
        return (tokens.count, produced)
    }
}
