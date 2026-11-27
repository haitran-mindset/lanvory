import {
  connectionError,
  PeerConnectionFields,
} from "../../components/peer-connection-fields";
import {
  type DragEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { SelectField } from "../../components/ui/select";
import { z } from "zod";
import {
  ArrowUpRight,
  Bluetooth,
  Check,
  Clock3,
  File,
  FolderOpen,
  Inbox,
  Radio,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import { pairedDeviceName, readPairedNames } from "../../services/paired-names";
import { PanelHeading } from "../../components/panel-heading";
import { useNotifications } from "../../components/notifications";
import { InboxAccess } from "./inbox-access";
import { ClipboardCard } from "./clipboard-card";
import "./sharing.css";

const offerSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().nonnegative(),
  fingerprint: z.string(),
  sha256: z.string(),
});
const activitySchema = z.object({
  offers: z.array(offerSchema),
  transfers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      size: z.number().nonnegative(),
      bytes: z.number().nonnegative(),
      direction: z.enum(["incoming", "outgoing"]),
      fingerprint: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional()
        .catch(undefined),
      state: z.enum([
        "waiting",
        "streaming",
        "completed",
        "declined",
        "cancelled",
        "failed",
      ]),
      updatedAt: z.iso.datetime(),
      streamingElapsedMs: z
        .number()
        .int()
        .positive()
        .optional()
        .catch(undefined),
    }),
  ),
  historyUnavailable: z.boolean(),
});

type Activity = z.infer<typeof activitySchema>;

type Transfer = Activity["transfers"][number];

const historyDirectionOptions = [
  { value: "all", label: "All directions" },
  { value: "incoming", label: "Received" },
  { value: "outgoing", label: "Sent" },
] as const;

const historyStatusOptions = [
  { value: "all", label: "All statuses" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
] as const;

function isActiveTransfer(transfer: Transfer) {
  return transfer.state === "waiting" || transfer.state === "streaming";
}

const states = {
  waiting: "Awaiting approval",
  streaming: "Transferring",
  completed: "Completed",
  declined: "Declined",
  cancelled: "Cancelled",
  failed: "Failed",
};

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

function transferEstimate(item: Transfer) {
  if (
    item.state !== "streaming" ||
    !item.streamingElapsedMs ||
    item.streamingElapsedMs < 1000 ||
    item.bytes <= 0 ||
    item.bytes >= item.size
  )
    return undefined;
  const rate = (item.bytes * 1000) / item.streamingElapsedMs;
  const seconds = Math.ceil((item.size - item.bytes) / rate);
  const remaining =
    seconds < 60
      ? `${seconds} s`
      : seconds < 3600
        ? `${Math.ceil(seconds / 60)} min`
        : `${Math.ceil(seconds / 3600)} h`;
  const speed = rate < 1 ? "<1 B/s" : `${bytes(Math.round(rate))}/s`;
  return `${speed} average · About ${remaining} left`;
}

function TransferRow({
  item,
  peerName,
  onReveal,
  onRemove,
  onRetry,
  onConfirm,
  onCancel,
  busy,
}: {
  item: Transfer;
  peerName?: string;
  onReveal?(): void;
  onRemove?(): void;
  onRetry?(): void;
  onConfirm?(): void;
  onCancel?(): void;
  busy?: boolean;
}) {
  const estimate = transferEstimate(item);
  return (
    <li className="sharing-item transfer-item">
      <div className="sharing-transfer-row">
        <div className="transfer-main-layout">
          <div className="transfer-icon-box">
            <File size={17} aria-hidden="true" />
          </div>
          <div className="transfer-details">
            <div className="transfer-title-row">
              <strong className="transfer-filename">{item.name}</strong>
              <span className={`transfer-status-tag status-${item.state}`}>
                {item.direction === "incoming" ? "Incoming" : "Outgoing"} ·{" "}
                {states[item.state]} · {bytes(item.bytes)} / {bytes(item.size)}
              </span>
            </div>
            <div className="transfer-sub-row">
              {peerName && (
                <span className="transfer-peer">
                  {item.direction === "incoming" ? "From" : "To"} {peerName}
                </span>
              )}
              {peerName && onRemove && (
                <span className="transfer-divider">•</span>
              )}
              {onRemove && (
                <time dateTime={item.updatedAt}>
                  {new Date(item.updatedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              )}
              {estimate && (
                <span className="transfer-estimate">· {estimate}</span>
              )}
            </div>
          </div>
        </div>
        <div className="sharing-history-row-actions">
          {onReveal &&
            item.state === "completed" &&
            item.direction === "incoming" && (
              <button
                type="button"
                className="refresh sharing-history-retry"
                title="Show in Finder"
                aria-label={`Show ${item.name} in Finder`}
                disabled={busy}
                onClick={onReveal}
              >
                <FolderOpen size={15} aria-hidden="true" />
              </button>
            )}
          {onRetry &&
            (item.state === "failed" || item.state === "cancelled") &&
            item.direction === "outgoing" && (
              <button
                type="button"
                className="refresh sharing-history-retry"
                title="Retry transfer"
                aria-label={`Retry ${item.name}`}
                disabled={busy}
                onClick={onRetry}
              >
                <RotateCcw size={15} aria-hidden="true" />
              </button>
            )}
          {onRemove && (
            <button
              type="button"
              className="refresh sharing-history-remove"
              title="Remove from history"
              aria-label={`Remove ${item.name} from history`}
              disabled={busy}
              onClick={onRemove}
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {onConfirm && (
        <div className="sharing-actions transfer-confirm-box">
          <p>
            Remove this entry from history? The file will stay on your device.
          </p>
          <button
            type="button"
            className="refresh"
            disabled={busy}
            onClick={onConfirm}
          >
            Remove entry
          </button>
          <button
            type="button"
            className="refresh"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      )}
      {item.state === "streaming" && (
        <progress
          aria-label={`Progress for ${item.name}`}
          max={Math.max(1, item.size)}
          value={item.bytes}
        />
      )}
    </li>
  );
}

function formatSendFailure(result: string, isP2P: boolean): string {
  const raw = result.startsWith("failed:") ? result.slice(7).trim() : "";
  const lower = raw.toLocaleLowerCase();
  if (lower.includes("scope")) {
    return isP2P
      ? "The Bluetooth + Wi-Fi P2P session expired. Reconnect over Bluetooth + P2P or switch to LAN."
      : "The selected network interface or address is no longer reachable.";
  }
  if (lower.includes("not trusted") || lower.includes("trust") || lower.includes("forbidden")) {
    return "The recipient has not allowed file requests from this device yet.";
  }
  if (lower.includes("not accepted") || lower.includes("declined")) {
    return "The recipient declined or did not approve the file in time.";
  }
  if (raw) {
    return `Could not send the file (${raw}).`;
  }
  return isP2P
    ? "Could not send the file. Check the recipient’s file permissions, or reconnect over Bluetooth + P2P and try again."
    : "Could not send the file. Check that the other device is online, allows requests from you, and approves this file.";
}

const recipientSchema = z.array(
  z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }),
);

export type PeerRoute = {
  fingerprint: string;
  adapter: string;
  endpoint: string;
  label?: string;
};

const sharingTabs = [
  { id: "send", label: "Send", icon: ArrowUpRight },
  { id: "incoming", label: "Incoming", icon: Inbox },
  { id: "permissions", label: "Permissions", icon: ShieldCheck },
  { id: "clipboard", label: "Clipboard", icon: File },
  { id: "history", label: "History", icon: Clock3 },
] as const;

type SharingTab = (typeof sharingTabs)[number]["id"];

export function Sharing({
  ownerId,
  visible,
  routes,
  onPair,
  onPendingFilesChange,
  onRoute,
  onClearP2PRoute,
}: {
  ownerId?: string;
  visible: boolean;
  routes: Record<string, PeerRoute>;
  onPair(): void;
  onPendingFilesChange(count: number): void;
  onRoute?(route: PeerRoute): void;
  onClearP2PRoute?(fingerprint: string): void;
}) {
  const { notify } = useNotifications();
  const [activeTab, setActiveTab] = useState<SharingTab>("send");
  const tabButtons = useRef<Partial<Record<SharingTab, HTMLButtonElement | null>>>({});

  function openTab(tab: SharingTab) {
    setActiveTab(tab);
    tabButtons.current[tab]?.focus({ preventScroll: true });
    tabButtons.current[tab]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  const [recipients, setRecipients] = useState<z.infer<
    typeof recipientSchema
  > | null>();
  const [recipient, setRecipient] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const recipientAvailable =
    recipients?.some((peer) => peer.fingerprint === recipient) === true;
  const route = routes[recipient];
  const p2pRoute = route?.adapter === "p2p" && /^127\.0\.0\.1:\d{1,5}$/.test(route.endpoint) ? route : undefined;

  useEffect(() => {
    if (!visible) return;
    setNames(ownerId ? readPairedNames(ownerId) : {});
    let active = true;
    void window.lanvory
      .trustedPeers()
      .catch(() => null)
      .then((value) => {
        if (!active) return;
        const parsed = recipientSchema.safeParse(value);
        setRecipients(parsed.success ? parsed.data : null);
        if (parsed.success) {
          setRecipient((previous) =>
            parsed.data.some((peer) => peer.fingerprint === previous)
              ? previous
              : parsed.data.length === 1
                ? parsed.data[0].fingerprint
                : "",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [ownerId, visible]);

  const [activity, setActivity] = useState<Activity | null>();
  const activityRevision = useRef(0);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const selected =
    selectedFiles.length === 1
      ? selectedFiles[0]
      : selectedFiles.length > 1
        ? `${selectedFiles.length} files selected`
        : undefined;
  const [selecting, setSelecting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [connectionReady, setConnectionReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [replying, setReplying] = useState<string>();
  const [openingInbox, setOpeningInbox] = useState(false);
  const [inboxMessage, setInboxMessage] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [offerMessage, setOfferMessage] = useState("");
  const [pendingHistoryRemoval, setPendingHistoryRemoval] = useState<string>();
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);
  const [removingHistory, setRemovingHistory] = useState(false);
  const [historyMessage, setHistoryMessage] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [directionFilter, setDirectionFilter] = useState<
    "all" | "incoming" | "outgoing"
  >("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "completed" | "failed"
  >("all");

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const revision = activityRevision.current;
      const result = activitySchema.safeParse(
        await window.lanvory.fileSnapshot().catch(() => null),
      );
      if (!alive) return;
      if (revision === activityRevision.current)
        setActivity(result.success ? result.data : null);
      timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [visible]);

  const pendingOffers = activity
    ? activity.offers.length
    : activity === null
      ? 0
      : undefined;
  useEffect(() => {
    if (visible && pendingOffers !== undefined)
      onPendingFilesChange(pendingOffers);
  }, [visible, pendingOffers, onPendingFilesChange]);

  async function openInbox() {
    setOpeningInbox(true);
    const result = await window.lanvory.openInbox().catch(() => "failed");
    setInboxMessage(
      result === "opened"
        ? ""
        : result === "missing"
          ? "No inbox folder yet. Lanvory creates it when receiving a file."
          : "Unable to open the inbox folder.",
    );
    setOpeningInbox(false);
  }

  async function revealInboxFile(fileName: string) {
    const result = await window.lanvory.revealInboxFile(fileName).catch(() => "failed");
    if (result !== "opened") {
      setInboxMessage(
        result === "missing"
          ? `“${fileName}” is no longer in the inbox folder.`
          : `Unable to show “${fileName}” in Finder.`,
      );
    } else {
      setInboxMessage("");
    }
  }

  const canSelectFile = Boolean(
    recipientAvailable && activity && !sending && !selecting && !clearing,
  );

  function dragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = canSelectFile ? "copy" : "none";
    if (canSelectFile) setDragging(true);
  }

  async function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!canSelectFile || !event.dataTransfer.types.includes("Files")) return;
    const files = event.dataTransfer.files;
    if (!files.length) return;
    setSelecting(true);
    if (files.length === 1) {
      const name = await window.lanvory
        .selectDroppedFile(files[0])
        .catch(() => null);
      if (name) setSelectedFiles([name]);
      setSendMessage(
        name ? "" : "Unable to select this file. Try Choose file.",
      );
    } else {
      const namesList = await window.lanvory
        .selectDroppedFiles(files)
        .catch(() => null);
      if (namesList?.length) setSelectedFiles(namesList);
      setSendMessage(
        namesList?.length
          ? ""
          : "Unable to select these files. Only regular files (up to 50) can be dropped.",
      );
    }
    setSelecting(false);
  }

  async function selectFile() {
    setSelecting(true);
    setSendMessage("");
    try {
      const result = await window.lanvory.selectFile();
      if (typeof result === "string" && result) {
        setSelectedFiles([result]);
      } else if (Array.isArray(result) && result.length) {
        setSelectedFiles(result);
      }
    } catch {
      setSendMessage("Unable to open the file picker.");
    } finally {
      setSelecting(false);
    }
  }

  async function selectFolder() {
    setSelecting(true);
    setSendMessage("");
    try {
      const result = await window.lanvory.selectFolder();
      if (Array.isArray(result) && result.length) {
        setSelectedFiles(result);
      } else if (result !== null) {
        setSendMessage("No regular files found in the selected folder.");
      }
    } catch {
      setSendMessage("Unable to open the folder picker.");
    } finally {
      setSelecting(false);
    }
  }

  function retryTransfer(item: Transfer) {
    if (
      item.fingerprint &&
      recipients?.some((peer) => peer.fingerprint === item.fingerprint)
    ) {
      setRecipient(item.fingerprint);
    }
    setSendMessage(
      `Select “${item.name}” to resend${item.fingerprint ? ` to ${pairedDeviceName(item.fingerprint, names)}` : ""}.`,
    );
    openTab("send");
  }

  async function removeFile() {
    setClearing(true);
    const cleared = await window.lanvory.clearSelectedFile().catch(() => false);
    if (cleared) setSelectedFiles([]);
    setSendMessage(
      cleared ? "" : "Unable to remove the selected file. Try again.",
    );
    setClearing(false);
  }

  async function removeFileAt(index: number) {
    setClearing(true);
    const remaining = await window.lanvory
      .removeSelectedFile(index)
      .catch(() => null);
    if (remaining) setSelectedFiles(remaining);
    setClearing(false);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !canSelectFile || (!p2pRoute && !connectionReady)) return;
    setSending(true);
    setSendMessage("");
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    const adapter = p2pRoute?.adapter ?? value("adapter");
    const endpoint = p2pRoute?.endpoint ?? value("endpoint");
    const fingerprint = value("fingerprint");
    try {
      const error = p2pRoute ? null : await connectionError(adapter, endpoint);
      if (error) {
        setSendMessage(error);
        return;
      }
      const result = await window.lanvory.sendFile(adapter, endpoint, fingerprint);
      if (result === "completed") {
        const count = selectedFiles.length;
        setSelectedFiles([]);
        onRoute?.(p2pRoute ?? { fingerprint, adapter, endpoint });
        setSendMessage(
          count > 1
            ? `The peer confirmed all ${count} files were received and verified.`
            : "The peer confirmed the file was received and verified.",
        );
        notify({
          category: "sharing",
          tone: "success",
          title: count > 1 ? `Sent ${count} files` : "File sent",
          body: "Peer verified integrity and receipt.",
        });
      } else {
        const remaining = await window.lanvory
          .getSelectedFiles?.()
          .catch(() => null);
        if (Array.isArray(remaining)) setSelectedFiles(remaining);
        if (p2pRoute && result.toLocaleLowerCase().includes("scope")) {
          onClearP2PRoute?.(fingerprint);
        }
        setSendMessage(
          result === "cancelled"
            ? "Send cancelled."
            : formatSendFailure(result, Boolean(p2pRoute)),
        );
      }
    } catch {
      setSendMessage("Unable to send the file.");
    } finally {
      setSending(false);
    }
  }

  async function decide(id: string, allow: boolean) {
    setReplying(id);
    setOfferMessage("");
    const accepted = await window.lanvory
      .decideFile(id, allow)
      .catch(() => false);
    if (accepted) {
      activityRevision.current += 1;
      setActivity(
        (previous) =>
          previous && {
            ...previous,
            offers: previous.offers.filter((offer) => offer.id !== id),
          },
      );
      notify({
        category: "sharing",
        tone: allow ? "success" : "info",
        title: allow ? "File offer approved" : "File offer declined",
      });
    }
    setOfferMessage(
      accepted
        ? ""
        : "Unable to update the file offer. It may no longer be available.",
    );
    setReplying(undefined);
  }

  async function removeHistory(item: Transfer) {
    setRemovingHistory(true);
    setHistoryMessage("");
    const removed = await window.lanvory
      .deleteTransferHistory(item.id)
      .catch(() => false);
    if (removed) {
      setPendingHistoryRemoval(undefined);
      activityRevision.current += 1;
      setActivity(
        (previous) =>
          previous && {
            ...previous,
            transfers: previous.transfers.filter(({ id }) => id !== item.id),
          },
      );
    }
    if (removed) {
      setHistoryMessage("");
      notify({ category: "sharing", tone: "info", title: "Entry removed from history." });
    } else {
      setHistoryMessage("Unable to remove the history entry. Try again.");
    }
    setRemovingHistory(false);
  }

  async function clearAllHistory() {
    setRemovingHistory(true);
    setHistoryMessage("");
    const cleared = await window.lanvory
      .clearTransferHistory()
      .catch(() => false);
    if (cleared) {
      setConfirmingClearAll(false);
      setPendingHistoryRemoval(undefined);
      activityRevision.current += 1;
      setActivity(
        (previous) =>
          previous && {
            ...previous,
            transfers: previous.transfers.filter(isActiveTransfer),
          },
      );
    }
    if (cleared) {
      setHistoryMessage("");
      notify({ category: "sharing", tone: "info", title: "Transfer history cleared." });
    } else {
      setHistoryMessage("Unable to clear transfer history. Try again.");
    }
    setRemovingHistory(false);
  }

  const activeTransfers = activity?.transfers.filter(isActiveTransfer) ?? [];
  const history =
    activity?.transfers.filter((item) => !isActiveTransfer(item)) ?? [];
  const completedIncomingCount = history.filter(
    (item) => item.direction === "incoming" && item.state === "completed",
  ).length;
  const query = historySearch.trim().toLocaleLowerCase();
  const matchingHistory = history.filter((item) => {
    const matchesQuery = item.name.toLocaleLowerCase().includes(query);
    const matchesDirection =
      directionFilter === "all" || item.direction === directionFilter;
    const matchesStatus = statusFilter === "all" || item.state === statusFilter;
    return matchesQuery && matchesDirection && matchesStatus;
  });
  const transferPeerName = (item: Transfer) =>
    item.fingerprint ? pairedDeviceName(item.fingerprint, names) : undefined;

  return (
    <section
      className="network-panel sharing-panel"
      aria-labelledby="sharing-heading"
    >
      <h2 id="sharing-heading" className="sr-only">
        Sharing
      </h2>
      <div className="sharing-tabs" role="tablist" aria-label="Sharing sections">
        {sharingTabs.map(({ id, label, icon: Icon }, index) => {
          const count = id === "incoming" ? activity?.offers.length
            : id === "history" ? activeTransfers.length : 0;
          return (
            <button
              key={id}
              ref={(element) => { tabButtons.current[id] = element; }}
              id={`sharing-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              aria-controls={`sharing-panel-${id}`}
              tabIndex={activeTab === id ? 0 : -1}
              onClick={() => openTab(id)}
              onKeyDown={(event) => {
                const last = sharingTabs.length - 1;
                const next = event.key === "ArrowRight" ? (index + 1) % sharingTabs.length
                  : event.key === "ArrowLeft" ? (index + last) % sharingTabs.length
                  : event.key === "Home" ? 0 : event.key === "End" ? last : undefined;
                if (next === undefined) return;
                event.preventDefault();
                openTab(sharingTabs[next].id);
              }}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
              {!!count && <span className="sharing-tab-count" aria-label={`${count} ${id === "incoming" ? "pending requests" : "active transfers"}`}>{count}</span>}
            </button>
          );
        })}
      </div>
      {activity === undefined && <p>Reading transfer activity…</p>}
      {activity === null && (
        <p role="status">Unable to load file activity. Reconnecting…</p>
      )}
      <div className="sharing-tab-panel" id="sharing-panel-send" role="tabpanel" aria-labelledby="sharing-tab-send" hidden={activeTab !== "send"} tabIndex={0}>
        <section id="sharing-send" className="operation-card sharing-compose" tabIndex={-1} aria-labelledby="sharing-send-heading">
          <PanelHeading
            icon={ArrowUpRight}
            id="sharing-send-heading"
            title="Send a file"
          />
          <form className="trust-form" onSubmit={(event) => void send(event)}>
            {recipients?.length === 0 ? (
              <div className="pair-required">
                <p>Pair a device to start sending files.</p>
                <button type="button" className="primary" onClick={onPair}>
                  Pair a device
                </button>
              </div>
            ) : (
              <SelectField
                label="Recipient"
                name="fingerprint"
                required
                placeholder="Select a paired device"
                value={recipientAvailable ? recipient : ""}
                disabled={!recipients?.length || sending}
                onValueChange={setRecipient}
                options={(recipients ?? []).map(({ fingerprint }) => ({
                  value: fingerprint,
                  label: pairedDeviceName(fingerprint, names),
                }))}
              />
            )}
            {recipientAvailable && (
              <p className="file-request-hint">
                <ShieldCheck size={17} aria-hidden="true" />
                <span>
                  On <strong>{pairedDeviceName(recipient, names)}</strong>, open{" "}
                  <strong>Sharing → Permissions</strong> and allow file requests
                  from this device. The recipient can then approve your request
                  in the <strong>Incoming</strong> tab.
                </span>
              </p>
            )}
            {recipients === null && (
              <p role="status">Unable to load paired devices.</p>
            )}
            {recipientAvailable && (p2pRoute || route?.adapter) && (
              <div className="paired-device-meta-row">
                <span className={`paired-method-badge ${p2pRoute ? "is-p2p" : "is-lan"}`}>
                  {p2pRoute ? <Bluetooth size={12} aria-hidden="true" /> : <Wifi size={12} aria-hidden="true" />}
                  <span>{p2pRoute ? "Bluetooth + Wi-Fi P2P" : `Local Network (${route!.adapter})`}</span>
                </span>
                {!p2pRoute && route?.endpoint && (
                  <span className="paired-meta-chip">
                    <code>{route.endpoint}</code>
                  </span>
                )}
              </div>
            )}
            {recipientAvailable && !p2pRoute && (
              <details
                className="trust-details"
                key={recipient}
                open={!route || !connectionReady}
              >
                <summary>Connection address</summary>
                <PeerConnectionFields
                  suggestedEndpoint={route?.endpoint}
                  disabled={sending}
                  onReady={setConnectionReady}
                />
              </details>
            )}
            {(!!recipients?.length || selected) && (
              <div
                className="file-selection"
                data-selected={!!selected}
                data-dragging={dragging}
                onDragOver={dragOver}
                onDragLeave={(event) => {
                  if (
                    !(event.relatedTarget instanceof Node) ||
                    !event.currentTarget.contains(event.relatedTarget)
                  ) {
                    setDragging(false);
                  }
                }}
                onDrop={(event) => void dropFile(event)}
              >
                <File size={19} aria-hidden="true" />
                <span title={selectedFiles.join(", ") || undefined}>
                  {dragging
                    ? "Drop files to select"
                    : (selected ??
                      (canSelectFile
                        ? "Drop a file here"
                        : "No file selected"))}
                </span>
                <div className="sharing-file-actions">
                  <button
                    type="button"
                    className="refresh"
                    disabled={!canSelectFile}
                    onClick={() => void selectFile()}
                  >
                    {selectedFiles.length > 1
                      ? "Change files"
                      : selectedFiles.length === 1
                        ? "Change file"
                        : "Choose file"}
                  </button>
                  {!selected && (
                    <button
                      type="button"
                      className="refresh"
                      disabled={!canSelectFile}
                      onClick={() => void selectFolder()}
                    >
                      Choose folder
                    </button>
                  )}
                  {selected && (
                    <button
                      type="button"
                      className="sharing-remove-file"
                      aria-label={
                        selectedFiles.length > 1
                          ? "Remove selected files"
                          : "Remove selected file"
                      }
                      title={
                        selectedFiles.length > 1
                          ? "Remove selected files"
                          : "Remove selected file"
                      }
                      disabled={sending || selecting || clearing}
                      onClick={() => void removeFile()}
                    >
                      <X size={17} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            )}
            {selectedFiles.length > 1 && (
              <ul className="selected-files-list" aria-label="Selected files">
                {selectedFiles.map((fileName, index) => (
                  <li
                    className="selected-files-item"
                    key={`${fileName}-${index}`}
                  >
                    <File size={14} aria-hidden="true" />
                    <span title={fileName}>{fileName}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${fileName}`}
                      title={`Remove ${fileName}`}
                      disabled={sending || selecting || clearing}
                      onClick={() => void removeFileAt(index)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {sending ? (
              <button
                type="button"
                className="refresh"
                onClick={() =>
                  void window.lanvory
                    .cancelFileSend()
                    .catch(() => setSendMessage("Unable to cancel the send."))
                }
              >
                Cancel send
              </button>
            ) : (
              !!recipients?.length && (
                <button
                  type="submit"
                  className="primary"
                  disabled={!selected || !canSelectFile || (!p2pRoute && !connectionReady)}
                >
                  {selectedFiles.length > 1
                    ? `Send ${selectedFiles.length} files`
                    : "Send file"}
                </button>
              )
            )}
          </form>
          <p className="sharing-feedback" role="status">
            {sendMessage}
          </p>
        </section>
      </div>
      <div className="sharing-tab-panel" id="sharing-panel-incoming" role="tabpanel" aria-labelledby="sharing-tab-incoming" hidden={activeTab !== "incoming"} tabIndex={0}>
        <section
          id="sharing-incoming"
          className="operation-card sharing-incoming"
          tabIndex={-1}
          aria-labelledby="sharing-incoming-heading"
        >
          <div className="incoming-desk-heading">
            <div>
              <h3 id="sharing-incoming-heading">Incoming requests</h3>
              <p>Review and approve files sent by your paired devices.</p>
            </div>
            <div className="incoming-desk-actions">
              <button type="button" className="incoming-permissions-link" onClick={() => openTab("permissions")}>
                <ShieldCheck size={15} aria-hidden="true" /> Permissions
              </button>
              <button type="button" className="refresh sharing-open-inbox" disabled={openingInbox}
                onClick={() => void openInbox()}>
                <FolderOpen size={15} aria-hidden="true" /> Open inbox
              </button>
            </div>
          </div>
          {activity && (
            <div className="incoming-queue-line">
              <span className="incoming-queue-status" data-pending={activity.offers.length > 0}>
                <strong>{activity.offers.length}</strong> pending
              </span>
              {completedIncomingCount > 0 && (
                <span><strong>{completedIncomingCount}</strong> received</span>
              )}
            </div>
          )}
          {inboxMessage && <p role="status">{inboxMessage}</p>}
          <p className="sharing-feedback" role="status">{offerMessage}</p>
          {activity?.offers.length === 0 && (
            <div className="incoming-queue-empty">
              <div className="incoming-tray-mark" aria-hidden="true"><Inbox size={30} strokeWidth={1.5} /></div>
              <div>
                <h4>No pending requests</h4>
                <p>When an allowed device requests to send a file, it will appear here.</p>
              </div>
            </div>
          )}
          {!!activity?.offers.length && (
            <div className="incoming-offers-list">
              {activity.offers.map((offer) => (
                <div
                  className="sharing-item incoming-offer-card"
                  key={offer.id}
                >
                  <div className="incoming-offer-main">
                    <div className="incoming-offer-icon">
                      <File size={20} aria-hidden="true" />
                    </div>
                    <div className="incoming-offer-info">
                      <div className="incoming-offer-header">
                        <strong className="incoming-offer-name">
                          {offer.name}
                        </strong>
                        <span className="incoming-offer-size">
                          {bytes(offer.size)}
                        </span>
                      </div>
                      <div className="incoming-offer-meta">
                        <span>
                          From{" "}
                          <strong>
                            {pairedDeviceName(offer.fingerprint, names)}
                          </strong>
                        </span>
                        <code
                          className="device-fingerprint-badge"
                          title={offer.fingerprint}
                        >
                          {offer.fingerprint.slice(0, 8)}…
                          {offer.fingerprint.slice(-6)}
                        </code>
                      </div>
                    </div>
                  </div>
                  <details className="incoming-offer-details">
                    <summary>Verify offer details</summary>
                    <div className="incoming-offer-hash-box">
                      <div>
                        <span className="incoming-hash-label">
                          Sender Fingerprint:
                        </span>
                        <code>{offer.fingerprint}</code>
                      </div>
                      <div>
                        <span className="incoming-hash-label">
                          SHA-256 Digest:
                        </span>
                        <code>{offer.sha256}</code>
                      </div>
                    </div>
                  </details>
                  <div className="incoming-offer-actions">
                    <button
                      type="button"
                      className="primary incoming-approve-btn"
                      disabled={replying !== undefined}
                      onClick={() => void decide(offer.id, true)}
                    >
                      <Check size={15} aria-hidden="true" /> Accept file
                    </button>
                    <button
                      type="button"
                      className="refresh incoming-decline-btn"
                      disabled={replying !== undefined}
                      onClick={() => void decide(offer.id, false)}
                    >
                      <X size={15} aria-hidden="true" /> Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <div className="sharing-tab-panel" id="sharing-panel-permissions" role="tabpanel" aria-labelledby="sharing-tab-permissions" hidden={activeTab !== "permissions"} tabIndex={0}>
        {visible && <InboxAccess ownerId={ownerId} />}
      </div>
      <div className="sharing-tab-panel" id="sharing-panel-clipboard" role="tabpanel" aria-labelledby="sharing-tab-clipboard" hidden={activeTab !== "clipboard"} tabIndex={0}>
        {visible && (
          <ClipboardCard ownerId={ownerId} visible={visible && activeTab === "clipboard"} recipients={recipients} routes={routes} />
        )}
      </div>
      <div className="sharing-tab-panel" id="sharing-panel-history" role="tabpanel" aria-labelledby="sharing-tab-history" hidden={activeTab !== "history"} tabIndex={0}>
        {activeTransfers.length > 0 && (
          <section
            className="operation-card sharing-ledger sharing-active"
            aria-labelledby="active-transfers-heading"
          >
            <PanelHeading
              icon={Radio}
              id="active-transfers-heading"
              title="Active transfers"
              badge={
                <span className="badge-count badge-active">
                  {activeTransfers.length} active
                </span>
              }
            />
            <ul className="sharing-transfer-list">
              {activeTransfers.map((item) => (
                <TransferRow
                  item={item}
                  key={item.id}
                  peerName={transferPeerName(item)}
                />
              ))}
            </ul>
          </section>
        )}
        <section
          id="sharing-history"
          className="operation-card sharing-ledger"
          tabIndex={-1}
          aria-labelledby="transfer-history-heading"
        >
          <PanelHeading
            icon={Clock3}
            id="transfer-history-heading"
            title="Transfer history"
            badge={
              history.length > 0 ? (
                <span className="tag">{history.length}</span>
              ) : null
            }
            action={
              history.length > 0 ? (
                confirmingClearAll ? (
                  <div className="sharing-history-actions">
                    <button
                      type="button"
                      className="primary sharing-open-inbox"
                      disabled={removingHistory}
                      onClick={() => void clearAllHistory()}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      <span>Confirm clear all</span>
                    </button>
                    <button
                      type="button"
                      className="refresh sharing-open-inbox"
                      disabled={removingHistory}
                      onClick={() => setConfirmingClearAll(false)}
                    >
                      <span>Cancel</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="refresh sharing-open-inbox"
                    disabled={removingHistory}
                    onClick={() => {
                      setPendingHistoryRemoval(undefined);
                      setConfirmingClearAll(true);
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    <span>Clear all</span>
                  </button>
                )
              ) : null
            }
          />
          <p className="sharing-feedback" role="status">
            {historyMessage}
          </p>
          {activity?.historyUnavailable && (
            <p role="status">Persistent history could not be read or saved.</p>
          )}
          {activity && history.length === 0 && (
            <p className="panel-empty">No past transfers yet.</p>
          )}
          {history.length > 0 && (
            <div className="sharing-history-controls">
              <div className="trust-form sharing-history-search">
                <label>
                  Search by filename
                  <input
                    type="search"
                    value={historySearch}
                    onChange={(event) => {
                      setHistorySearch(event.currentTarget.value);
                      if (!removingHistory) setPendingHistoryRemoval(undefined);
                    }}
                  />
                </label>
              </div>
              <div className="sharing-history-filter">
                <SelectField
                  label="Direction"
                  name="directionFilter"
                  value={directionFilter}
                  options={historyDirectionOptions}
                  onValueChange={(val) => {
                    if (val === "all" || val === "incoming" || val === "outgoing")
                      setDirectionFilter(val);
                  }}
                />
              </div>
              <div className="sharing-history-filter">
                <SelectField
                  label="Status"
                  name="statusFilter"
                  value={statusFilter}
                  options={historyStatusOptions}
                  onValueChange={(val) => {
                    if (val === "all" || val === "completed" || val === "failed")
                      setStatusFilter(val);
                  }}
                />
              </div>
            </div>
          )}
          {history.length > 0 && matchingHistory.length === 0 && (
            <p className="panel-empty" role="status">
              No files match your search.
            </p>
          )}
          {matchingHistory.length > 0 && (
            <ul className="sharing-transfer-list">
              {matchingHistory.map((item) => (
                <TransferRow
                  item={item}
                  key={item.id}
                  peerName={transferPeerName(item)}
                  busy={removingHistory}
                  onReveal={
                    item.direction === "incoming" && item.state === "completed"
                      ? () => void revealInboxFile(item.name)
                      : undefined
                  }
                  onRetry={() => retryTransfer(item)}
                  onRemove={() => setPendingHistoryRemoval(item.id)}
                  onConfirm={
                    pendingHistoryRemoval === item.id
                      ? () => void removeHistory(item)
                      : undefined
                  }
                  onCancel={() => setPendingHistoryRemoval(undefined)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
