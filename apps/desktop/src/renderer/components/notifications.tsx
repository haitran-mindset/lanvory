import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Boxes,
  CheckCheck,
  CheckCircle2,
  Clipboard,
  FolderSync,
  Info,
  Layers,
  Monitor,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import type { Page } from '../layouts/workspace';

export type NotificationCategory = 'pairing' | 'sharing' | 'sync' | 'services' | 'network' | 'clipboard' | 'system';
export type NotificationTone = 'info' | 'success' | 'warning' | 'error';

export type AppNotification = {
  id: string;
  category: NotificationCategory;
  tone: NotificationTone;
  title: string;
  body?: string;
  targetPage?: Page;
  actionLabel?: string;
  createdAt: number;
  read: boolean;
  dedupeKey?: string;
};

export type NotifyInput = Omit<AppNotification, 'id' | 'createdAt' | 'read'> & {
  toast?: boolean;
  record?: boolean;
};

type NotificationContextValue = {
  items: AppNotification[];
  unreadCount: number;
  notify(input: NotifyInput): void;
  markRead(id: string): void;
  markAllRead(): void;
  clearAll(): void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider');
  return ctx;
}

function categoryIcon(category: NotificationCategory, tone: NotificationTone) {
  if (tone === 'error') return AlertCircle;
  if (tone === 'success') return CheckCircle2;
  switch (category) {
    case 'pairing':
      return Monitor;
    case 'sharing':
      return Layers;
    case 'sync':
      return FolderSync;
    case 'services':
      return Boxes;
    case 'network':
      return Wifi;
    case 'clipboard':
      return Clipboard;
    default:
      return Info;
  }
}

export function NotificationsProvider({
  onNavigate,
  children,
}: {
  onNavigate(page: Page): void;
  children: ReactNode;
}) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const seenKeys = useRef<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      for (const timer of activeTimers.values()) clearTimeout(timer);
      activeTimers.clear();
    };
  }, []);

  const dismissToast = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    (input: NotifyInput) => {
      if (input.dedupeKey) {
        if (seenKeys.current.has(input.dedupeKey)) return;
        seenKeys.current.add(input.dedupeKey);
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { toast = true, record = false, ...rest } = input;
      const entry: AppNotification = {
        ...rest,
        id,
        createdAt: Date.now(),
        read: false,
      };
      if (record) {
        setItems((prev) => [entry, ...prev].slice(0, 40));
      }
      if (!toast) return;

      setToasts((prev) => [entry, ...prev].slice(0, 4));

      const durationMs = input.tone === 'warning' || input.tone === 'error' ? 7500 : 5000;
      const timer = setTimeout(() => {
        timers.current.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, durationMs);
      timers.current.set(id, timer);
    },
    [],
  );

  const markRead = useCallback((id: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, read: true } : item)));
  }, []);

  const markAllRead = useCallback(() => {
    setItems((prev) => prev.map((item) => (item.read ? item : { ...item, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
    setToasts([]);
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
  }, []);

  const unreadCount = items.reduce((acc, item) => acc + (item.read ? 0 : 1), 0);

  return (
    <NotificationContext.Provider value={{ items, unreadCount, notify, markRead, markAllRead, clearAll }}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-stack" role="region" aria-label="Notifications" aria-live="polite">
          {toasts.map((toast) => {
            const Icon = categoryIcon(toast.category, toast.tone);
            return (
              <div key={toast.id} className={`toast-card is-${toast.tone}`}>
                <span className="toast-icon">
                  <Icon size={16} aria-hidden="true" />
                </span>
                <div className="toast-body">
                  <strong>{toast.title}</strong>
                  {toast.body && <p>{toast.body}</p>}
                  {toast.targetPage && (
                    <button
                      type="button"
                      className="toast-action-btn"
                      onClick={() => {
                        markRead(toast.id);
                        dismissToast(toast.id);
                        onNavigate(toast.targetPage!);
                      }}
                    >
                      {toast.actionLabel ?? `Open ${toast.targetPage}`}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="toast-close-btn"
                  aria-label="Dismiss notification"
                  onClick={() => dismissToast(toast.id)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </NotificationContext.Provider>
  );
}

export function NotificationBell({ onNavigate }: { onNavigate(page: Page): void }) {
  const { items, unreadCount, markRead, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="notification-bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`notification-bell-btn${unreadCount > 0 ? ' has-unread' : ''}`}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        title="Notifications"
      >
        <Bell size={15} aria-hidden="true" />
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notification-popover" role="dialog" aria-label="Notification center">
          <div className="notification-popover-header">
            <strong>Notifications</strong>
            <div className="notification-popover-actions">
              {unreadCount > 0 && (
                <button type="button" className="notification-text-btn" onClick={markAllRead} title="Mark all as read">
                  <CheckCheck size={13} aria-hidden="true" /> Mark read
                </button>
              )}
              {items.length > 0 && (
                <button type="button" className="notification-text-btn" onClick={clearAll} title="Clear all notifications">
                  <Trash2 size={13} aria-hidden="true" /> Clear
                </button>
              )}
            </div>
          </div>

          {items.length === 0 ? (
            <div className="notification-empty">
              <Bell size={22} aria-hidden="true" />
              <p>You’re all caught up.</p>
              <small>Pairing requests, file offers, transfers, and system alerts appear here.</small>
            </div>
          ) : (
            <ul className="notification-list">
              {items.map((item) => {
                const Icon = categoryIcon(item.category, item.tone);
                return (
                  <li key={item.id} className={`notification-item${item.read ? '' : ' is-unread'}`}>
                    <span className={`notification-item-icon is-${item.tone}`}>
                      <Icon size={15} aria-hidden="true" />
                    </span>
                    <div className="notification-item-content">
                      <div className="notification-item-top">
                        <strong>{item.title}</strong>
                        <time dateTime={new Date(item.createdAt).toISOString()}>
                          {new Date(item.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </time>
                      </div>
                      {item.body && <p>{item.body}</p>}
                      {item.targetPage && (
                        <button
                          type="button"
                          className="notification-open-btn"
                          onClick={() => {
                            markRead(item.id);
                            setOpen(false);
                            onNavigate(item.targetPage!);
                          }}
                        >
                          {item.actionLabel ?? `Open ${item.targetPage}`}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
