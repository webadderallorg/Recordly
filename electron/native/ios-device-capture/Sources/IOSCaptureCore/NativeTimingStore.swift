import Foundation
import Darwin
public struct SessionStorage {
    public let root: URL
    public let names: Set<String>
    public init(_ storage: [String: Any]) throws {
        guard let path = storage["sessionRoot"] as? String, path.hasPrefix("/"), let names = storage["allowedRelativeNames"] as? [String] else { throw CaptureFailure("INVALID_REQUEST") }
        let root = URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
        guard root.resolvingSymlinksInPath().path == root.path else { throw CaptureFailure("INVALID_REQUEST") }
        let values = try root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else { throw CaptureFailure("INVALID_REQUEST") }
        let allowed: Set<String> = ["source-video.mov", "device-audio.mov", "microphone.mov", "native-timing.json", "recording.pending.mov", "recording.mov"]
        guard Set(names).isSubset(of: allowed) else { throw CaptureFailure("INVALID_REQUEST") }
        self.root = root; self.names = Set(names)
    }
    public func file(_ name: String, creating: Bool = false) throws -> URL {
        guard names.contains(name), !name.contains("/"), root.resolvingSymlinksInPath().path == root.path else { throw CaptureFailure("INVALID_REQUEST") }
        let url = root.appendingPathComponent(name)
        guard url.resolvingSymlinksInPath().path == url.path else { throw CaptureFailure("INVALID_REQUEST") }
        var info = stat()
        if lstat(url.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFLNK { throw CaptureFailure("INVALID_REQUEST") }
        if creating && FileManager.default.fileExists(atPath: url.path) { throw CaptureFailure("INVALID_REQUEST") }
        return url
    }
    public func availableBytes() throws -> Int64 {
        var info = statfs()
        guard statfs(root.path, &info) == 0 else { throw CaptureFailure("DISK_SPACE_LOW") }
        return Int64(info.f_bavail) * Int64(info.f_bsize)
    }
}
public final class NativeTimingStore {
    private let url: URL
    public init(storage: SessionStorage) throws { url = try storage.file("native-timing.json") }
    public func checkpoint(_ object: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        guard data.count <= 1024 * 1024 else { throw CaptureFailure("WRITER_FAILED") }
        try data.write(to: url, options: .atomic)
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw CaptureFailure("WRITER_FAILED") }
        defer { close(fd) }
        guard fsync(fd) == 0 else { throw CaptureFailure("WRITER_FAILED") }
        let directoryFD = open(url.deletingLastPathComponent().path, O_RDONLY)
        if directoryFD >= 0 { _ = fsync(directoryFD); close(directoryFD) }
    }
}

public enum StorageReservePolicy {
    /// Uses actual media-file bytes, never pixel-buffer size or a resolution estimate.
    public static func requiredBytes(writtenBytes: Int64, videoBytes: Int64, elapsedSeconds: Double, mixAudio: Bool) -> Int64 {
        let elapsed = elapsedSeconds.isFinite && elapsedSeconds > 1 ? elapsedSeconds : 1
        let rateReserve = Double(max(0, writtenBytes)) / elapsed * 60
        let copyReserve = mixAudio ? max(0, videoBytes) : 0
        let total = rateReserve + Double(copyReserve) + Double(256 * 1024 * 1024)
        return Int64(min(Double(Int64.max / 2), total).rounded(.up))
    }
}
extension SessionStorage {
    public func writtenMediaBytes() throws -> (video: Int64, total: Int64) {
        var video: Int64 = 0, total: Int64 = 0
        for name in ["source-video.mov", "device-audio.mov", "microphone.mov"] where names.contains(name) {
            let url = try file(name)
            var info = stat()
            if lstat(url.path, &info) != 0 {
                if errno == ENOENT { continue }
                throw CaptureFailure("WRITER_FAILED")
            }
            guard (info.st_mode & S_IFMT) == S_IFREG, info.st_size >= 0 else { throw CaptureFailure("INVALID_REQUEST") }
            let bytes = Int64(info.st_size)
            total += bytes
            if name == "source-video.mov" { video = bytes }
        }
        return (video, total)
    }
}
