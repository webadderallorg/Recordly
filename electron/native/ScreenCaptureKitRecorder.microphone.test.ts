import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Compile the production matching functions and run them against a fixed
// device list, so no real microphone or permission prompt is involved.
describe.skipIf(process.platform !== "darwin")("recorder microphone selection", () => {
	let directory: string;
	let executable: string;
	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), "recordly-microphone-"));
		executable = join(directory, "matcher");
		const source = readFileSync(
			new URL("./ScreenCaptureKitRecorder.swift", import.meta.url),
			"utf8",
		);
		const matching = source.slice(
			source.indexOf("private static func matchMicrophoneDeviceID"),
			source.indexOf("private func supportsNativeMicrophoneCapture"),
		);
		writeFileSync(
			join(directory, "main.swift"),
			`
import Foundation
enum Matcher {
${matching}
}
extension Matcher {
    static func run(_ arguments: [String]) -> String? {
        switch arguments[0] {
        case "undecorated":
            return undecoratedMicrophoneName(forLabel: arguments[1])
        default:
            return matchMicrophoneDeviceID(
                label: arguments[1],
                deviceId: arguments[2],
                devices: [
                    (name: "Shure MV7", uniqueID: "usb-mv7"),
                    (name: "MacBook Pro Microphone", uniqueID: "built-in"),
                    (name: "Foo", uniqueID: "foo"),
                    (name: "Foo (Pro)", uniqueID: "foo-pro"),
                ]
            )
        }
    }
}
print(Matcher.run(Array(CommandLine.arguments.dropFirst())) ?? "<none>")
`,
		);
		const build = spawnSync(
			"swiftc",
			[
				"-module-cache-path",
				join(directory, "cache"),
				join(directory, "main.swift"),
				"-o",
				executable,
			],
			{ encoding: "utf8", timeout: 60_000 },
		);
		expect(build.status, build.stderr).toBe(0);
	}, 60_000);
	afterAll(() => {
		if (directory) rmSync(directory, { recursive: true, force: true });
	});

	const run = (...args: string[]) => {
		const result = spawnSync(executable, args, { encoding: "utf8", timeout: 5_000 });
		expect(result.status, result.stderr).toBe(0);
		return result.stdout.trim();
	};

	it.each([
		["Shure MV7 (14ed:1012)", "Shure MV7"],
		["Mic (Built-in)", "Mic"],
		["Name (A) (B)", "Name (A)"],
		["(Only)", "<none>"],
		["Plain", "<none>"],
		["Mic (unclosed", "<none>"],
		["", "<none>"],
	])("strips the Chromium suffix from %j", (label, expected) => {
		expect(run("undecorated", label)).toBe(expected);
	});

	it.each([
		// Chromium's deviceId is a per-origin hash that never matches a uniqueID.
		["Shure MV7 (14ed:1012)", "d4488ddaa3f0f10c", "usb-mv7"],
		["Foo (Pro)", "", "foo-pro"],
		["Shure MV7", "built-in", "usb-mv7"],
		["Foo (USB)", "built-in", "built-in"],
		["Foo (USB)", "", "foo"],
		["Default - MacBook Pro Microphone (Built-in)", "default", "<none>"],
		["Unknown Mic (Virtual)", "", "<none>"],
		["", "", "<none>"],
	])("resolves label %j with device ID %j to %j", (label, deviceId, expected) => {
		expect(run("match", label, deviceId)).toBe(expected);
	});
});

// Compile the production converter and feed it microphone buffers shaped like real
// devices: mono, right-only stereo and multi-channel 24-bit integer interfaces.
describe.skipIf(process.platform !== "darwin")("recorder microphone channel layout", () => {
	let directory: string;
	let executable: string;
	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), "recordly-upmix-"));
		executable = join(directory, "upmix");
		const source = readFileSync(
			new URL("./ScreenCaptureKitRecorder.swift", import.meta.url),
			"utf8",
		);
		const converter = source.slice(
			source.indexOf("private func microphoneSampleWithStereoChannels"),
			source.indexOf("private static func audioOutputSettings"),
		);
		writeFileSync(
			join(directory, "main.swift"),
			`
import AVFoundation
import CoreMedia

final class Upmix {
${converter}

    static func floatBuffer(channels: AVAudioChannelCount, left: Float, right: Float, frames: Int = 64) -> CMSampleBuffer? {
        guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000,
                channels: channels, interleaved: false),
            let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)),
            let data = pcm.floatChannelData else { return nil }
        pcm.frameLength = AVAudioFrameCount(frames)
        for frame in 0..<frames {
            data[0][frame] = left
            if channels > 1 { data[1][frame] = right }
        }
        return Upmix().makeMicrophoneSample(pcm, format: format.formatDescription, at: .zero)
    }

    static func int24Buffer(channels: Int, values: [Float], frames: Int = 64) -> CMSampleBuffer? {
        var asbd = AudioStreamBasicDescription(mSampleRate: 48_000, mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked,
            mBytesPerPacket: UInt32(3 * channels), mFramesPerPacket: 1, mBytesPerFrame: UInt32(3 * channels),
            mChannelsPerFrame: UInt32(channels), mBitsPerChannel: 24, mReserved: 0)
        var layout = AudioChannelLayout()
        layout.mChannelLayoutTag = kAudioChannelLayoutTag_DiscreteInOrder | UInt32(channels)
        layout.mChannelBitmap = []
        layout.mNumberChannelDescriptions = 0
        var format: CMAudioFormatDescription?
        guard CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &asbd,
                layoutSize: MemoryLayout<AudioChannelLayout>.size, layout: &layout,
                magicCookieSize: 0, magicCookie: nil, extensions: nil,
                formatDescriptionOut: &format) == noErr, let format else { return nil }
        let frameBytes = 3 * channels
        let length = frameBytes * frames
        var block: CMBlockBuffer?
        guard CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil,
                blockLength: length, blockAllocator: nil, customBlockSource: nil, offsetToData: 0,
                dataLength: length, flags: 0, blockBufferOut: &block) == noErr, let block else { return nil }
        guard CMBlockBufferAssureBlockMemory(block) == noErr else { return nil }
        var pointer: UnsafeMutablePointer<Int8>?
        guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: nil,
                dataPointerOut: &pointer) == noErr, let pointer else { return nil }
        let bytes = UnsafeMutableRawPointer(pointer)
        for frame in 0..<frames {
            for channel in 0..<channels {
                let value = Int32((values[channel] * 8_388_607).rounded())
                let offset = frame * frameBytes + channel * 3
                bytes.storeBytes(of: UInt8(truncatingIfNeeded: value), toByteOffset: offset, as: UInt8.self)
                bytes.storeBytes(of: UInt8(truncatingIfNeeded: value >> 8), toByteOffset: offset + 1, as: UInt8.self)
                bytes.storeBytes(of: UInt8(truncatingIfNeeded: value >> 16), toByteOffset: offset + 2, as: UInt8.self)
            }
        }
        var sample: CMSampleBuffer?
        guard CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: kCFAllocatorDefault,
                dataBuffer: block, formatDescription: format, sampleCount: frames,
                presentationTimeStamp: .zero, packetDescriptions: nil, sampleBufferOut: &sample) == noErr else { return nil }
        return sample
    }

    static func peaks(_ sample: CMSampleBuffer) -> (Float, Float) {
        guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000,
                channels: 2, interleaved: false),
            let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(sample.numSamples)) else { return (-1, -1) }
        pcm.frameLength = AVAudioFrameCount(sample.numSamples)
        guard CMSampleBufferCopyPCMDataIntoAudioBufferList(sample, at: 0, frameCount: Int32(sample.numSamples),
                into: pcm.mutableAudioBufferList) == noErr, let data = pcm.floatChannelData else { return (-1, -1) }
        var left: Float = 0
        var right: Float = 0
        for frame in 0..<Int(sample.numSamples) {
            left = max(left, abs(data[0][frame]))
            right = max(right, abs(data[1][frame]))
        }
        return (left, right)
    }

    static func render(_ sample: CMSampleBuffer?) -> String {
        guard let sample,
            let converted = Upmix().microphoneSampleWithStereoChannels(sample, at: .zero) else { return "nil" }
        let (left, right) = peaks(converted)
        return String(format: "%.3f %.3f", left, right)
    }
}

print(Upmix.render(Upmix.floatBuffer(channels: 1, left: 0.25, right: 0)))
print(Upmix.render(Upmix.floatBuffer(channels: 2, left: 0, right: 0.5)))
print(Upmix.render(Upmix.floatBuffer(channels: 2, left: 0.5, right: 0.25)))
print(Upmix.render(Upmix.int24Buffer(channels: 4, values: [0.5, 0.0005, 0, 0])))
print(Upmix.render(Upmix.int24Buffer(channels: 4, values: [0, 0, 0.25, 0])))
print(Upmix.render(Upmix.int24Buffer(channels: 4, values: [0.5, 0.25, 0, 0])))
`,
		);
		const build = spawnSync(
			"swiftc",
			[
				"-module-cache-path",
				join(directory, "cache"),
				join(directory, "main.swift"),
				"-o",
				executable,
			],
			{ encoding: "utf8", timeout: 120_000 },
		);
		expect(build.status, build.stderr).toBe(0);
	}, 120_000);
	afterAll(() => {
		if (directory) rmSync(directory, { recursive: true, force: true });
	});

	it("duplicates the only active channel for every device layout", () => {
		const result = spawnSync(executable, [], { encoding: "utf8", timeout: 5_000 });
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout.trim().split("\n")).toEqual([
			"0.250 0.250",
			"0.500 0.500",
			"0.500 0.250",
			"0.500 0.500",
			"0.250 0.250",
			"0.500 0.250",
		]);
	});
});
