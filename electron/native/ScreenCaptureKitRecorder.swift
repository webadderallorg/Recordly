import Foundation
import AVFoundation
import CoreGraphics

private func exitWithError(_ message: String) -> Never {
	fputs("\(message)\n", stderr)
	fflush(stderr)
	exit(1)
}

private func requestScreenRecordingPermissionIfNeeded() {
	if CGPreflightScreenCaptureAccess() {
		return
	}

	let granted = CGRequestScreenCaptureAccess()
	if !granted {
		exitWithError("SCREEN_RECORDING_PERMISSION_DENIED")
	}
}

private func requestMicrophonePermissionIfNeeded(configJSON: String) {
	guard let configData = configJSON.data(using: .utf8),
		let config = try? JSONDecoder().decode(CaptureConfig.self, from: configData),
		config.capturesMicrophone == true else {
		return
	}

	switch AVCaptureDevice.authorizationStatus(for: .audio) {
	case .authorized:
		break
	case .notDetermined:
		let semaphore = DispatchSemaphore(value: 0)
		AVCaptureDevice.requestAccess(for: .audio) { _ in semaphore.signal() }
		semaphore.wait()
		if AVCaptureDevice.authorizationStatus(for: .audio) != .authorized {
			exitWithError("MICROPHONE_PERMISSION_DENIED")
		}
	default:
		exitWithError("MICROPHONE_PERMISSION_DENIED")
	}
}

@main
struct ScreenCaptureKitRecorderMain {
	static func main() {
		guard CommandLine.arguments.count >= 2 else {
			exitWithError("Missing config JSON")
		}

		let configJSON = CommandLine.arguments[1]

		// Force CoreGraphics Services initialization on the main thread.
		_ = CGMainDisplayID()

		requestScreenRecordingPermissionIfNeeded()
		requestMicrophonePermissionIfNeeded(configJSON: configJSON)

		let service = RecorderService()
		service.start(configJSON: configJSON)

		DispatchQueue.global(qos: .utility).async {
			while let input = readLine(strippingNewline: true)?.lowercased() {
				if input == "pause" {
					service.pause()
					continue
				}

				if input == "resume" {
					service.resume()
					continue
				}

				if input == "stop" {
					service.stop()
					break
				}
			}
		}

		service.waitUntilFinished()
	}
}