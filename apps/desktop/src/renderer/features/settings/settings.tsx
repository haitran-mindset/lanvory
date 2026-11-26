import { version as appVersion } from '../../../../package.json';
import {
  Bell,
  Check,
  Copy,
  ExternalLink,
  FolderDown,
  Info,
  Key,
  Keyboard,
  Monitor,
  Palette,
  Shield,
  ShieldCheck,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNotifications } from '../../components/notifications';
import { PanelHeading } from '../../components/panel-heading';
import { Checkbox } from '../../components/ui/checkbox';
import { SelectField, accessDurations } from '../../components/ui/select';
import { PermissionActivity } from './permission-activity';
import { readDefaultDuration, saveDefaultDuration, type DefaultDuration } from '../../services/permission-defaults';

import type { LoginItemState } from '../../../shared/desktop-api';
export type Theme = 'dark' | 'light' | 'system';
export type Density = 'comfortable' | 'compact';
export type TextSize = 'default' | 'large';

const categories = [
  { id: 'settings-sec-preferences', label: 'Preferences', icon: Palette },
  { id: 'settings-sec-device', label: 'Device & Storage', icon: Monitor },
  { id: 'settings-sec-security', label: 'Security & Trust', icon: ShieldCheck },
  { id: 'settings-sec-system', label: 'System & About', icon: Info },
] as const;

export function SettingsPanel({ name, onRename, textSize, onTextSizeChange, theme, onThemeChange, density, onDensityChange, reducedMotion, onReducedMotionChange, protocolVersion, daemonVersion, ownerId, fingerprint }: {
  name?: string;
  ownerId?: string;
  fingerprint?: string;
  protocolVersion?: number;
  daemonVersion?: string;
  reducedMotion: boolean;
  onReducedMotionChange(enabled: boolean): boolean;
  density: Density;
  onDensityChange(density: Density): boolean;
  theme: Theme;
  onThemeChange(theme: Theme): boolean;
  textSize: TextSize;
  onTextSizeChange(size: TextSize): boolean;
  onRename(name: string): Promise<boolean>;
}) {
  const [motionSaved, setMotionSaved] = useState(true);
  const [densitySaved, setDensitySaved] = useState(true);
  const [themeSaved, setThemeSaved] = useState(true);
  const [textSizeSaved, setTextSizeSaved] = useState(true);
  const { notify } = useNotifications();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [openingNotices, setOpeningNotices] = useState(false);
  const [noticesMessage, setNoticesMessage] = useState('');
  const [openingInbox, setOpeningInbox] = useState(false);
  const [inboxMessage, setInboxMessage] = useState('');
  const [copyingFp, setCopyingFp] = useState(false);
  const [copyingReport, setCopyingReport] = useState(false);
  const [reportMessage, setReportMessage] = useState('');

  const [activeCategory, setActiveCategory] = useState<string>('settings-sec-preferences');

  const [loginItem, setLoginItem] = useState<LoginItemState | null>(null);
  const [savingLoginItem, setSavingLoginItem] = useState(false);
  const [loginItemError, setLoginItemError] = useState(false);
  const loginItemRevision = useRef(0);
  const loginItemSaving = useRef(false);
  const [pairingAlerts, setPairingAlerts] = useState<boolean | null>(null);
  const [savingAlerts, setSavingAlerts] = useState(false);
  const [alertsError, setAlertsError] = useState(false);
  const [minimized, setMinimized] = useState<boolean | null>(null);
  const [savingStartup, setSavingStartup] = useState(false);
  const [startupError, setStartupError] = useState(false);
  const [defaultDuration, setDefaultDuration] = useState<DefaultDuration>(readDefaultDuration);
  const [durationSaved, setDurationSaved] = useState(true);

  useEffect(() => {
    let active = true;
    void window.lanvory.startMinimized().then((enabled) => {
      if (active) setMinimized(enabled);
    }).catch(() => {
      if (active) setStartupError(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    async function refresh() {
      if (loginItemSaving.current) return;
      const revision = ++loginItemRevision.current;
      try {
        const state = await window.lanvory.loginItem();
        if (active && revision === loginItemRevision.current) {
          setLoginItem(state);
          setLoginItemError(false);
        }
      } catch {
        if (active && revision === loginItemRevision.current) setLoginItemError(true);
      }
    }
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, []);

  async function saveLoginItem(enabled: boolean) {
    if (loginItemSaving.current) return;
    loginItemSaving.current = true;
    loginItemRevision.current += 1;
    setSavingLoginItem(true);
    const state = await window.lanvory.setLoginItem(enabled).catch(() => null);
    if (state) setLoginItem(state);
    setLoginItemError(state !== 'requires-approval'
      && state !== 'not-found' && state !== (enabled ? 'enabled' : 'disabled'));
    loginItemSaving.current = false;
    setSavingLoginItem(false);
  }

  useEffect(() => {
    let active = true;
    void window.lanvory.pairingAlerts().then((enabled) => {
      if (active) setPairingAlerts(enabled);
    }).catch(() => {
      if (active) setAlertsError(true);
    });
    return () => { active = false; };
  }, []);

  async function saveAlerts(enabled: boolean) {
    setSavingAlerts(true);
    const saved = await window.lanvory.setPairingAlerts(enabled).catch(() => false);
    if (saved) setPairingAlerts(enabled);
    setAlertsError(!saved);
    setSavingAlerts(false);
  }

  async function saveStartup(enabled: boolean) {
    setSavingStartup(true);
    const saved = await window.lanvory.setStartMinimized(enabled).catch(() => false);
    if (saved) setMinimized(enabled);
    setStartupError(!saved);
    setSavingStartup(false);
  }

  async function openNotices() {
    setOpeningNotices(true);
    const result = await window.lanvory.openNotices().catch(() => 'failed');
    setNoticesMessage(result === 'opened' ? '' : result === 'unavailable'
      ? 'Open-source notices are included in packaged builds.'
      : 'Unable to open the open-source notices.');
    setOpeningNotices(false);
  }

  async function openInboxFolder() {
    setOpeningInbox(true);
    const result = await window.lanvory.openInbox().catch(() => 'failed');
    setInboxMessage(result === 'opened' ? '' : result === 'missing'
      ? 'Your inbox folder does not exist yet. It will be created when you receive your first file.'
      : 'Unable to open the local inbox.');
    setOpeningInbox(false);
  }

  async function copyFingerprint(fp: string) {
    setCopyingFp(true);
    await window.lanvory.copyFingerprint(fp).catch(() => false);
    setTimeout(() => { setCopyingFp(false); }, 1500);
  }

  async function copyReport() {
    setCopyingReport(true);
    setReportMessage('');
    const copied = await window.lanvory.copyNetworkReport().catch(() => false);
    if (copied) {
      notify({ category: 'system', tone: 'success', title: 'Diagnostic report copied.' });
    } else {
      setReportMessage('Unable to copy the diagnostic report.');
    }
    setCopyingReport(false);
  }

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get('name') ?? '');
    const next = value.trim();
    if (!next || new TextEncoder().encode(next).length > 63 || /[\p{Cc}\p{Cf}]/u.test(value)) {
      setMessage('Enter a device name of 1 to 63 UTF-8 bytes without control characters.');
      return;
    }

    setSaving(true);
    const saved = await onRename(next);
    if (saved) {
      setMessage('');
      notify({
        category: 'system',
        tone: 'success',
        title: 'Device name saved.',
        body: next,
      });
    } else {
      setMessage('Unable to save the device name.');
    }
    setSaving(false);
  }

  function scrollToSection(id: string) {
    setActiveCategory(id);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }

  return (
    <section className="nearby settings-container" aria-labelledby="settings-title">
      <div className="section-title"><h2 id="settings-title">Settings</h2></div>

      {/* Category Quick Jump Bar */}
      <nav className="settings-category-nav" aria-label="Settings navigation">
        {categories.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`settings-category-pill ${activeCategory === id ? 'is-active' : ''}`}
            onClick={() => scrollToSection(id)}
          >
            <Icon size={14} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {/* SECTION 1: Preferences */}
      <div className="settings-section" id="settings-sec-preferences">
        <div className="settings-section-header">
          <span className="settings-section-tag">// PREFERENCES</span>
          <h3 className="settings-section-title">Interface & Notifications</h3>
        </div>
        <div className="operation-grid settings-grid settings-section-grid">
          {/* Appearance Card */}
          <section className="operation-card" aria-labelledby="settings-appearance">
            <PanelHeading icon={Palette} id="settings-appearance" title="Appearance"
              description="Customize visual themes, typography scaling, interface density, and animations." />
            <div className="settings-options">
              <SelectField label="Theme" name="theme" value={theme}
                options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]}
                onValueChange={(value) => { if (value === 'dark' || value === 'light' || value === 'system') setThemeSaved(onThemeChange(value)); }} />
              {!themeSaved && <p className="settings-status is-error" role="status">Theme changed for this session. Unable to save the preference.</p>}
              <SelectField label="Text size" name="textSize" value={textSize}
                options={[{ value: 'default', label: 'Default' }, { value: 'large', label: 'Large' }]}
                onValueChange={(value) => { setTextSizeSaved(onTextSizeChange(value === 'large' ? 'large' : 'default')); }} />
              {!textSizeSaved && <p className="settings-status is-error" role="status">Text size changed for this session. Unable to save the preference.</p>}
              <SelectField label="Interface density" name="density" value={density}
                options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]}
                onValueChange={(value) => { setDensitySaved(onDensityChange(value === 'compact' ? 'compact' : 'comfortable')); }} />
              {!densitySaved && <p className="settings-status is-error" role="status">Interface density changed for this session. Unable to save the preference.</p>}
              <label className="settings-toggle">
                <span>Reduce motion<small>Skip interface transitions. Your system preference also applies.</small></span>
                <Checkbox id="settings-reducedMotion" aria-label="Reduce motion"
                  checked={reducedMotion} onCheckedChange={(checked) => setMotionSaved(onReducedMotionChange(checked === true))} />
              </label>
              {!motionSaved && <p className="settings-status is-error" role="status">Motion changed for this session. Unable to save the preference.</p>}
            </div>
          </section>

          {/* Startup & notifications Card */}
          <section className="operation-card" aria-labelledby="settings-behavior">
            <PanelHeading icon={Bell} id="settings-behavior" title="Startup & notifications"
              description="Configure system background execution, launch on sign-in, and pairing prompts." />
            <div className="settings-options">
              {loginItem !== null && (
                <label className="settings-toggle">
                  <span>Launch at login<small>Open Lanvory automatically when you sign in.</small></span>
                  <Checkbox id="settings-loginItem" aria-label="Launch at login"
                    checked={loginItem === 'enabled' || loginItem === 'requires-approval'}
                    disabled={savingLoginItem}
                    onCheckedChange={(checked) => void saveLoginItem(checked === true)} />
                </label>
              )}
              {loginItem === 'requires-approval' && <p className="settings-status is-warning" role="status">Allow Lanvory under Login Items in System Settings.</p>}
              {loginItem === 'not-found' && <p className="settings-status is-warning" role="status">macOS could not find Lanvory as a login item.</p>}
              {loginItemError && <p className="settings-status is-error" role="status">Unable to access or update the login item.</p>}
              {pairingAlerts !== null && (
                <label className="settings-toggle">
                  <span>Pairing notifications<small>Get an alert when a device asks to pair.</small></span>
                  <Checkbox id="settings-pairingAlerts" aria-label="Pairing notifications" checked={pairingAlerts} disabled={savingAlerts}
                    onCheckedChange={(checked) => void saveAlerts(checked === true)} />
                </label>
              )}
              {alertsError && <p className="settings-status is-error" role="status">Unable to access or save the notification preference.</p>}
              {minimized !== null && (
                <label className="settings-toggle">
                  <span>Start minimized<small>Keep the window out of the way when Lanvory opens.</small></span>
                  <Checkbox id="settings-startup" aria-label="Start minimized" checked={minimized} disabled={savingStartup}
                    onCheckedChange={(checked) => void saveStartup(checked === true)} />
                </label>
              )}
              {startupError && <p className="settings-status is-error" role="status">Unable to access the startup preference.</p>}
            </div>
          </section>
        </div>
      </div>

      {/* SECTION 2: Device & Storage */}
      <div className="settings-section" id="settings-sec-device">
        <div className="settings-section-header">
          <span className="settings-section-tag">// IDENTITY & STORAGE</span>
          <h3 className="settings-section-title">My Device & Local Inbox</h3>
        </div>
        <div className="operation-grid settings-grid settings-section-grid">
          {/* My device Card */}
          <section className="operation-card" aria-labelledby="settings-device">
            <PanelHeading icon={Monitor} id="settings-device" title="My device"
              description="Choose the name other devices see on your local network." />
            {name === undefined ? (
              <p className="settings-empty-hint">Open Lanvory’s local connection to edit this device name.</p>
            ) : (
              <form className="trust-form settings-name-form" onSubmit={(event) => void rename(event)}>
                <label className="settings-input-label">
                  <span className="settings-input-label-text">
                    Device name
                    <small className="settings-input-caption">Max 63 bytes</small>
                  </span>
                  <div className="settings-input-group">
                    <input
                      key={name}
                      name="name"
                      defaultValue={name}
                      maxLength={63}
                      required
                      disabled={saving}
                      placeholder="Local device name"
                    />
                    <button type="submit" className="refresh settings-save-btn" disabled={saving}>
                      {saving ? 'Saving…' : 'Save name'}
                    </button>
                  </div>
                </label>
              </form>
            )}
            {message && (
              <p role="status" className={`settings-status ${message.includes('saved') ? 'is-success' : 'is-error'}`}>
                {message}
              </p>
            )}
            {fingerprint && (
              <div className="settings-fingerprint-box">
                <div className="settings-fingerprint-info">
                  <span className="settings-fingerprint-label">
                    <Key size={12} aria-hidden="true" />
                    Device fingerprint
                  </span>
                  <code className="settings-fingerprint-val" title={fingerprint}>
                    {fingerprint.slice(0, 8)}…{fingerprint.slice(-6)}
                  </code>
                </div>
                <button
                  type="button"
                  className="refresh settings-fingerprint-btn"
                  title="Copy fingerprint"
                  aria-label="Copy fingerprint"
                  disabled={copyingFp}
                  onClick={() => void copyFingerprint(fingerprint)}
                >
                  {copyingFp ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                  <span>{copyingFp ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            )}
          </section>

          {/* Storage & inbox Card */}
          <section className="operation-card" aria-labelledby="settings-storage">
            <PanelHeading icon={FolderDown} id="settings-storage" title="Storage & inbox"
              description="Incoming files from paired devices are placed in your personal inbox." />
            <div className="settings-info-box">
              <dl className="settings-info-list">
                <div><dt>Inbox directory</dt><dd><code>~/.lanvory/inbox</code></dd></div>
                <div><dt>Integrity check</dt><dd className="settings-accent-value">SHA-256 verified</dd></div>
              </dl>
            </div>
            <button type="button" className="refresh settings-action-card-btn" disabled={openingInbox} onClick={() => void openInboxFolder()}>
              <FolderDown size={15} aria-hidden="true" />
              <span>Open inbox folder</span>
            </button>
            {inboxMessage && <p role="status" className="settings-status">{inboxMessage}</p>}
          </section>
        </div>
      </div>

      {/* SECTION 3: Security & Privacy */}
      <div className="settings-section" id="settings-sec-security">
        <div className="settings-section-header">
          <span className="settings-section-tag">// SECURITY & AUDIT</span>
          <h3 className="settings-section-title">Permissions & Privacy Controls</h3>
        </div>
        <div className="operation-grid settings-grid settings-section-grid">
          {/* Permission defaults Card */}
          <section className="operation-card" aria-labelledby="settings-perm-defaults">
            <PanelHeading icon={ShieldCheck} id="settings-perm-defaults" title="Permission defaults"
              description="Choose default access duration when granting access to paired devices." />
            <div className="settings-options">
              <SelectField label="Default access duration" name="defaultDuration" value={defaultDuration}
                options={accessDurations}
                onValueChange={(val) => {
                  if (val === 'until-revoked' || val === 'hour' || val === 'day') {
                    setDefaultDuration(val);
                    setDurationSaved(saveDefaultDuration(val));
                  }
                }} />
              {!durationSaved && <p className="settings-status is-error" role="status">Unable to save default permission duration.</p>}
            </div>
            <div className="settings-card-footnote">
              <small>Applies to incoming file transfer and shared tunnel requests.</small>
            </div>
          </section>

          {/* Privacy & diagnostics Card */}
          <section className="operation-card" aria-labelledby="settings-privacy">
            <PanelHeading icon={Shield} id="settings-privacy" title="Privacy & diagnostics"
              description="Lanvory operates entirely offline and peer-to-peer. Zero telemetry or external analytics." />
            <div className="settings-info-box">
              <dl className="settings-info-list">
                <div><dt>Network telemetry</dt><dd className="settings-accent-value">None (strictly offline P2P)</dd></div>
                <div><dt>Storage engine</dt><dd>Local SQLite in <code>~/.lanvory</code></dd></div>
              </dl>
            </div>
            <button type="button" className="refresh settings-action-card-btn" disabled={copyingReport} onClick={() => void copyReport()}>
              <Copy size={15} aria-hidden="true" />
              <span>{copyingReport ? 'Copying…' : 'Copy diagnostic report'}</span>
            </button>
            {reportMessage && <p role="status" className="settings-status is-success">{reportMessage}</p>}
          </section>

          {/* Permission activity Card (Full width) */}
          <div className="settings-fullwidth-cell">
            <PermissionActivity ownerId={ownerId} />
          </div>
        </div>
      </div>

      {/* SECTION 4: System & Shortcuts */}
      <div className="settings-section" id="settings-sec-system">
        <div className="settings-section-header">
          <span className="settings-section-tag">// SYSTEM & REFERENCE</span>
          <h3 className="settings-section-title">Navigation & Build Details</h3>
        </div>
        <div className="operation-grid settings-grid settings-section-grid">
          {/* Keyboard shortcuts Card */}
          <section className="operation-card" aria-labelledby="settings-shortcuts">
            <PanelHeading icon={Keyboard} id="settings-shortcuts" title="Keyboard shortcuts"
              description="Navigate Lanvory quickly with global shortcuts." />
            <div className="settings-info-box">
              <dl className="settings-info-list settings-shortcuts-list">
                <div><dt>Devices</dt><dd><kbd>⌘ 1</kbd> / <kbd>Ctrl+1</kbd></dd></div>
                <div><dt>Sharing</dt><dd><kbd>⌘ 2</kbd> / <kbd>Ctrl+2</kbd></dd></div>
                <div><dt>Services</dt><dd><kbd>⌘ 3</kbd> / <kbd>Ctrl+3</kbd></dd></div>
                <div><dt>Network</dt><dd><kbd>⌘ 4</kbd> / <kbd>Ctrl+4</kbd></dd></div>
                <div><dt>Settings</dt><dd><kbd>⌘ 5</kbd> / <kbd>Ctrl+5</kbd></dd></div>
                <div><dt>Cancel / Close</dt><dd><kbd>Esc</kbd></dd></div>
              </dl>
            </div>
          </section>

          {/* About Lanvory Card */}
          <section className="operation-card" aria-labelledby="settings-about">
            <PanelHeading icon={Info} id="settings-about" title="About Lanvory"
              description="Decentralized, privacy-first local network platform." />
            <div className="settings-info-box">
              <dl className="settings-versions">
                <div><dt>Application version</dt><dd>{appVersion}</dd></div>
                <div><dt>Daemon build</dt><dd>{daemonVersion ?? 'Unavailable'}</dd></div>
                <div><dt>Protocol version</dt><dd>{protocolVersion ?? 'Unavailable'}</dd></div>
              </dl>
            </div>
            <button type="button" className="refresh settings-action-card-btn" disabled={openingNotices} onClick={() => void openNotices()}>
              <ExternalLink size={15} aria-hidden="true" />
              <span>Open-source notices</span>
            </button>
            {noticesMessage && <p role="status" className="settings-status">{noticesMessage}</p>}
          </section>
        </div>
      </div>
    </section>
  );
}
