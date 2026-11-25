import { useEffect, useMemo, useRef, useState } from 'react';
import { Command, CornerDownLeft, Search } from 'lucide-react';

export type PaletteCommand = {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  disabled?: boolean;
  run(): void;
};

export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: PaletteCommand[];
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return commands.filter(
      (cmd) =>
        !cmd.disabled &&
        (!q ||
          cmd.label.toLocaleLowerCase().includes(q) ||
          cmd.category.toLocaleLowerCase().includes(q)),
    );
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  function execute(cmd: PaletteCommand | undefined) {
    if (!cmd) return;
    onClose();
    cmd.run();
  }

  return (
    <div
      className="command-palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((prev) => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            execute(filtered[activeIndex]);
          }
        }}
      >
        <div className="command-palette-input-row">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Type a command or jump to a view…"
            aria-label="Search commands"
            aria-activedescendant={filtered[activeIndex] ? `cmd-${filtered[activeIndex].id}` : undefined}
          />
          <kbd className="command-palette-kbd">Esc</kbd>
        </div>
        <ul className="command-palette-list" role="listbox" aria-label="Available commands">
          {filtered.length === 0 ? (
            <li className="command-palette-empty">No matching commands.</li>
          ) : (
            filtered.map((cmd, index) => (
              <li
                key={cmd.id}
                id={`cmd-${cmd.id}`}
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? 'command-palette-item is-active' : 'command-palette-item'}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => execute(cmd)}
              >
                <span className="command-palette-cat">{cmd.category}</span>
                <span className="command-palette-label">{cmd.label}</span>
                {cmd.shortcut ? (
                  <kbd className="command-palette-kbd">{cmd.shortcut}</kbd>
                ) : (
                  index === activeIndex && <CornerDownLeft size={13} aria-hidden="true" className="command-palette-enter" />
                )}
              </li>
            ))
          )}
        </ul>
        <div className="command-palette-footer">
          <span><Command size={12} aria-hidden="true" /> + K to toggle</span>
          <span>↑↓ navigate · ↵ select</span>
        </div>
      </div>
    </div>
  );
}
