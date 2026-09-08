import XCTest
@testable import IOSCaptureCore

final class DeviceDiscoveryLifecycleTests: XCTestCase {
    func testExplicitRefreshReopensTheDiscoveryBoundary() throws {
        let harness = DiscoveryHarness()
        try harness.queue.sync {
            try harness.lifecycle.start(refresh: false)
            try harness.lifecycle.start(refresh: true)
            XCTAssertEqual(harness.snapshots, [1, 2])
            XCTAssertEqual(harness.cancelled, [1])
            harness.lifecycle.stop()
        }
    }

    func testPreparedSourceRefreshReusesItsExistingObservation() throws {
        let harness = DiscoveryHarness()
        try harness.queue.sync {
            try harness.lifecycle.start(refresh: false)
            try harness.lifecycle.start(refresh: false)
            XCTAssertEqual(harness.snapshots, [1, 1])
            XCTAssertTrue(harness.cancelled.isEmpty)
            harness.lifecycle.stop()
            XCTAssertEqual(harness.cancelled, [1])
        }
    }

    func testDeviceChangeBurstPublishesOneCoalescedSnapshot() throws {
        let harness = DiscoveryHarness()
        try harness.queue.sync { try harness.lifecycle.start(refresh: false) }
        let notify = harness.queue.sync { harness.notifications[0] }
        for _ in 0..<8 { notify() }
        drain(harness)
        harness.queue.sync {
            XCTAssertEqual(harness.snapshots, [1, 1])
            harness.lifecycle.stop()
        }
    }

    func testOldObservationCannotPublishAfterRefresh() throws {
        let harness = DiscoveryHarness()
        try harness.queue.sync { try harness.lifecycle.start(refresh: false) }
        let oldNotification = harness.queue.sync { harness.notifications[0] }
        oldNotification()
        try harness.queue.sync { try harness.lifecycle.start(refresh: true) }
        oldNotification()
        drain(harness)
        harness.queue.sync { XCTAssertEqual(harness.snapshots, [1, 2]) }
        harness.queue.sync { harness.notifications.last! }()
        drain(harness)
        harness.queue.sync {
            XCTAssertEqual(harness.snapshots, [1, 2, 2])
            harness.lifecycle.stop()
        }
    }

    func testStopDiscardsAlreadyQueuedDeviceChanges() throws {
        let harness = DiscoveryHarness()
        try harness.queue.sync { try harness.lifecycle.start(refresh: false) }
        let notify = harness.queue.sync { harness.notifications[0] }
        notify()
        harness.queue.sync { harness.lifecycle.stop() }
        notify()
        drain(harness)
        harness.queue.sync {
            XCTAssertEqual(harness.snapshots, [1])
            XCTAssertEqual(harness.cancelled, [1])
        }
    }

    func testPollRepairsADeviceChangeWithoutNotification() throws {
        let harness = DiscoveryHarness(pollInterval: 0.02)
        let repaired = expectation(description: "Fallback poll publishes the current inventory")
        harness.onSnapshot = { snapshots in
            if snapshots == [1, 1] { repaired.fulfill() }
        }
        try harness.queue.sync { try harness.lifecycle.start(refresh: false) }
        wait(for: [repaired], timeout: 1)
        harness.queue.sync { harness.lifecycle.stop() }
    }

    private func drain(_ harness: DiscoveryHarness) {
        let drained = expectation(description: "Discovery coalescer drained")
        harness.queue.asyncAfter(deadline: .now() + 0.05) { drained.fulfill() }
        wait(for: [drained], timeout: 1)
    }
}

private final class DiscoveryHarness {
    let queue = DispatchQueue(label: "recordly.tests.discovery")
    let pollInterval: TimeInterval
    var notifications: [() -> Void] = []
    var cancelled: [Int] = []
    var snapshots: [Int] = []
    var onSnapshot: (([Int]) -> Void)?
    private var source = 0

    init(pollInterval: TimeInterval = 30) { self.pollInterval = pollInterval }

    lazy var lifecycle = DiscoveryLifecycle(
        queue: queue,
        pollInterval: pollInterval,
        coalescingInterval: 0.01,
        observe: { [unowned self] notification in
            self.source += 1
            let opened = self.source
            self.notifications.append(notification)
            return { [unowned self] in self.cancelled.append(opened) }
        },
        reconcile: { [unowned self] in
            self.snapshots.append(self.source)
            self.onSnapshot?(self.snapshots)
        }
    )
}
