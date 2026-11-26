import Foundation
import CoreBluetooth
import Network

// Lanvory BLE Service UUID (shared across macOS, Windows, and Linux)
let lanvoryServiceUUID = CBUUID(string: "7E4A1000-4C41-4E56-4F52-593030303031")
let lanvoryP2PServiceType = "_lanvory-p2p._tcp"

struct NearbyPeerRecord: Codable {
    var id: String
    var name: String
    var tag: String
    var rssi: Int
    var transport: String
    var p2pReady: Bool
    var serviceName: String
    var lastSeen: String
}

struct CommandMessage: Decodable {
    let cmd: String
    let enabled: Bool?
    let name: String?
    let tag: String?
    let targetPort: Int?
    let durationMs: Int?
    let serviceName: String?
    let requestId: String?
}

func emitJSON(_ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

func isoNow() -> String {
    ISO8601DateFormatter().string(from: Date())
}

func sanitizeLabel(_ raw: String, maxLen: Int = 48) -> String {
    let filtered = raw.unicodeScalars.filter {
        CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" || $0 == " " || $0 == "."
    }
    return String(String(String.UnicodeScalarView(filtered)).trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxLen))
}

final class P2PBridgeSession {
    let id: String
    let listener: NWListener
    var activeConnections: [NWConnection] = []

    init(id: String, serviceName: String, queue: DispatchQueue, onReady: @escaping (UInt16) -> Void, onError: @escaping (String) -> Void) throws {
        self.id = id
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        self.listener = try NWListener(using: params, on: .any)
        var didReportReady = false

        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                if !didReportReady, let port = self.listener.port?.rawValue {
                    didReportReady = true
                    onReady(port)
                }
            case .failed(let err):
                if !didReportReady {
                    didReportReady = true
                    onError(err.localizedDescription)
                }
            default:
                break
            }
        }

        listener.newConnectionHandler = { localConn in
            let p2pParams = NWParameters.tcp
            p2pParams.includePeerToPeer = true
            let remoteConn = NWConnection(
                to: .service(name: serviceName, type: lanvoryP2PServiceType, domain: "local.", interface: nil),
                using: p2pParams
            )
            localConn.start(queue: queue)
            remoteConn.start(queue: queue)
            Self.pipe(a: localConn, b: remoteConn, queue: queue)
            Self.pipe(a: remoteConn, b: localConn, queue: queue)
        }
        listener.start(queue: queue)
    }

    static func pipe(a: NWConnection, b: NWConnection, queue: DispatchQueue) {
        a.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, isComplete, error in
            if let data = data, !data.isEmpty {
                b.send(content: data, completion: .contentProcessed { sendErr in
                    if sendErr != nil {
                        a.cancel()
                        b.cancel()
                        return
                    }
                    if !isComplete && error == nil {
                        Self.pipe(a: a, b: b, queue: queue)
                    } else {
                        b.send(content: nil, contentContext: .defaultMessage, isComplete: true, completion: .idempotent)
                    }
                })
            } else if isComplete || error != nil {
                b.send(content: nil, contentContext: .defaultMessage, isComplete: true, completion: .idempotent)
            }
        }
    }

    func stop() {
        listener.cancel()
    }
}

final class NearbyController: NSObject, CBCentralManagerDelegate, CBPeripheralManagerDelegate {
    private let queue = DispatchQueue(label: "lanvory.nearby.queue")
    private var central: CBCentralManager!
    private var peripheral: CBPeripheralManager!
    private var p2pListener: NWListener?
    private var p2pBrowser: NWBrowser?
    private var bridgeSessions: [String: P2PBridgeSession] = [:]

    private var discoveredBLE: [String: NearbyPeerRecord] = [:]
    private var discoveredP2P: [String: String] = [:] // serviceName -> endpoint label
    private var wantAdvertise = false
    private var advName = "Lanvory-Mac"
    private var advTag = ""
    private var advTargetPort: UInt16 = 0
    private var selfServiceName = ""
    private var isScanning = false

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: queue, options: [CBCentralManagerOptionShowPowerAlertKey: false])
        peripheral = CBPeripheralManager(delegate: self, queue: queue, options: [CBPeripheralManagerOptionShowPowerAlertKey: false])
    }

    func bluetoothStateString(_ state: CBManagerState) -> String {
        switch state {
        case .poweredOn: return "poweredOn"
        case .poweredOff: return "poweredOff"
        case .unauthorized: return "unauthorized"
        case .unsupported: return "unsupported"
        case .resetting: return "resetting"
        default: return "unknown"
        }
    }

    func emitStatus() {
        emitJSON([
            "event": "status",
            "bluetoothState": bluetoothStateString(central.state),
            "advertising": wantAdvertise && peripheral.isAdvertising,
            "scanning": isScanning,
            "p2pListening": p2pListener != nil
        ])
    }

    func handleCommand(_ msg: CommandMessage) {
        queue.async {
            switch msg.cmd {
            case "status":
                self.emitStatus()

            case "set_advertise":
                self.wantAdvertise = msg.enabled ?? false
                if let n = msg.name, !n.isEmpty { self.advName = sanitizeLabel(n, maxLen: 24) }
                if let t = msg.tag { self.advTag = sanitizeLabel(t, maxLen: 12) }
                if let p = msg.targetPort, p > 0 && p <= 65535 { self.advTargetPort = UInt16(p) }
                self.applyAdvertising()
                self.emitStatus()

            case "start_scan":
                if let n = msg.name, !n.isEmpty { self.advName = sanitizeLabel(n, maxLen: 24) }
                if let t = msg.tag, !t.isEmpty { self.advTag = sanitizeLabel(t, maxLen: 12) }
                if !self.advName.isEmpty {
                    self.selfServiceName = self.advTag.isEmpty ? self.advName : "\(self.advName)-\(self.advTag)"
                }
                let durationMs = max(1500, min(msg.durationMs ?? 4500, 12000))
                self.startScan(durationMs: durationMs, requestId: msg.requestId ?? "")

            case "p2p_dial":
                let svcName = msg.serviceName ?? ""
                let reqId = msg.requestId ?? UUID().uuidString
                if svcName.isEmpty {
                    emitJSON(["event": "p2p_error", "requestId": reqId, "error": "serviceName is required"])
                    return
                }
                do {
                    let sess = try P2PBridgeSession(
                        id: reqId,
                        serviceName: svcName,
                        queue: self.queue,
                        onReady: { port in
                            emitJSON([
                                "event": "p2p_ready",
                                "requestId": reqId,
                                "id": reqId,
                                "endpoint": "127.0.0.1:\(port)",
                                "serviceName": svcName
                            ])
                        },
                        onError: { errMsg in
                            emitJSON(["event": "p2p_error", "requestId": reqId, "error": errMsg])
                        }
                    )
                    self.bridgeSessions[reqId] = sess
                } catch {
                    emitJSON(["event": "p2p_error", "requestId": reqId, "error": error.localizedDescription])
                }

            case "stop":
                self.wantAdvertise = false
                self.applyAdvertising()
                self.stopScan()
                for (_, s) in self.bridgeSessions { s.stop() }
                self.bridgeSessions.removeAll()
                exit(0)

            default:
                break
            }
        }
    }

    private func applyAdvertising() {
        peripheral.stopAdvertising()
        p2pListener?.service = nil
        p2pListener?.cancel()
        p2pListener = nil

        guard wantAdvertise else { return }

        let currentServiceName = advTag.isEmpty ? advName : "\(advName)-\(advTag)"
        selfServiceName = currentServiceName

        if peripheral.state == .poweredOn {
            let localLabel = advTag.isEmpty ? advName : "\(advName)#\(advTag)"
            peripheral.startAdvertising([
                CBAdvertisementDataServiceUUIDsKey: [lanvoryServiceUUID],
                CBAdvertisementDataLocalNameKey: String(localLabel.prefix(26))
            ])
        }

        if advTargetPort > 0 {
            let params = NWParameters.tcp
            params.includePeerToPeer = true
            if let listener = try? NWListener(using: params) {
                listener.service = NWListener.Service(name: currentServiceName, type: lanvoryP2PServiceType)
                let targetPort = advTargetPort
                listener.newConnectionHandler = { incoming in
                    let localConn = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: targetPort)!, using: .tcp)
                    incoming.start(queue: self.queue)
                    localConn.start(queue: self.queue)
                    P2PBridgeSession.pipe(a: incoming, b: localConn, queue: self.queue)
                    P2PBridgeSession.pipe(a: localConn, b: incoming, queue: self.queue)
                }
                listener.start(queue: queue)
                p2pListener = listener
            }
        }
    }

    private func startScan(durationMs: Int, requestId: String) {
        discoveredBLE.removeAll()
        discoveredP2P.removeAll()
        isScanning = true

        if central.state == .poweredOn {
            central.scanForPeripherals(withServices: [lanvoryServiceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        }

        let browseParams = NWParameters.tcp
        browseParams.includePeerToPeer = true
        let browser = NWBrowser(for: .bonjour(type: lanvoryP2PServiceType, domain: "local."), using: browseParams)
        browser.browseResultsChangedHandler = { results, _ in
            var current: [String: String] = [:]
            for r in results {
                if case .service(let name, _, _, _) = r.endpoint {
                    if !self.selfServiceName.isEmpty && name == self.selfServiceName {
                        continue
                    }
                    current[name] = name
                }
            }
            self.discoveredP2P = current
        }
        browser.start(queue: queue)
        p2pBrowser = browser

        queue.asyncAfter(deadline: .now() + .milliseconds(durationMs)) {
            self.stopScan()
            var peers: [NearbyPeerRecord] = Array(self.discoveredBLE.values)
            if !self.discoveredP2P.isEmpty {
                // Drop anonymous BLE-only records when AWDL already resolved named peers,
                // since CoreBluetooth omits LocalName when the 128-bit UUID fills the 31-byte packet.
                peers.removeAll { !$0.p2pReady && $0.name == "Lanvory Device" }
            }
            for (svcName, _) in self.discoveredP2P {
                if let idx = peers.firstIndex(where: { $0.serviceName == svcName || svcName.hasPrefix($0.name) }) {
                    peers[idx].p2pReady = true
                    peers[idx].serviceName = svcName
                    peers[idx].transport = "ble+awdl"
                } else {
                    peers.append(NearbyPeerRecord(
                        id: "p2p-\(svcName)",
                        name: sanitizeLabel(svcName),
                        tag: "",
                        rssi: -50,
                        transport: "awdl",
                        p2pReady: true,
                        serviceName: svcName,
                        lastSeen: isoNow()
                    ))
                }
            }
            let encoded = (try? JSONEncoder().encode(peers)).flatMap { try? JSONSerialization.jsonObject(with: $0) } ?? []
            emitJSON([
                "event": "scan_result",
                "requestId": requestId,
                "bluetoothState": self.bluetoothStateString(self.central.state),
                "peers": encoded
            ])
        }
    }

    private func stopScan() {
        isScanning = false
        if central.state == .poweredOn {
            central.stopScan()
        }
        p2pBrowser?.cancel()
        p2pBrowser = nil
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        emitStatus()
    }

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        if wantAdvertise && peripheral.state == .poweredOn {
            applyAdvertising()
        }
        emitStatus()
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let rawName = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name ?? ""
        let parts = rawName.split(separator: "#", maxSplits: 1).map(String.init)
        let cleanName = parts.isEmpty ? "" : sanitizeLabel(parts[0])
        let cleanTag = parts.count > 1 ? sanitizeLabel(parts[1], maxLen: 12) : ""
        if cleanName.isEmpty, let existing = discoveredBLE[peripheral.identifier.uuidString], existing.name != "Lanvory Device" {
            return
        }
        let displayName = cleanName.isEmpty ? "Lanvory Device" : cleanName
        let svcName = cleanTag.isEmpty ? displayName : "\(displayName)-\(cleanTag)"
        if !selfServiceName.isEmpty && svcName == selfServiceName {
            return
        }
        discoveredBLE[peripheral.identifier.uuidString] = NearbyPeerRecord(
            id: peripheral.identifier.uuidString,
            name: displayName,
            tag: cleanTag,
            rssi: RSSI.intValue,
            transport: "ble",
            p2pReady: discoveredP2P[svcName] != nil,
            serviceName: svcName,
            lastSeen: isoNow()
        )
    }
}

let controller = NearbyController()
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8),
              let msg = try? JSONDecoder().decode(CommandMessage.self, from: data) else { continue }
        controller.handleCommand(msg)
    }
    exit(0)
}
RunLoop.main.run()
