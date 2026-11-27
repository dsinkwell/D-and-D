// swift-tools-version: 5.9
// llama.cpp (prebuilt for Apple platforms, release b12340 of 12 Nov 2026) plus a small Swift
// wrapper, used for written answers on devices without Apple Intelligence.
import PackageDescription

let package = Package(
    name: "LlamaSPM",
    platforms: [.iOS("16.4")],
    products: [
        .library(name: "LlamaSPM", targets: ["LlamaSPM"])
    ],
    targets: [
        .binaryTarget(
            name: "llama",
            url: "https://github.com/ggml-org/llama.cpp/releases/download/b12340/llama-b12340-xcframework.zip",
            checksum: "ca87f6f83b5f73c7ab66db4b9407678b04a819998b4ab41a8ceb9865acea3162"
        ),
        .target(name: "LlamaSPM", dependencies: ["llama"], path: "Sources/LlamaSPM")
    ]
)
