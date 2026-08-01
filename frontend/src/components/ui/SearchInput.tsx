/**
 * SearchInput — the 40px search control.
 *
 * `_sistema.css` `.srch` (:143-145): `--h-ctl` 40px, `--r-ctl` 10px radius,
 * `--line-2` border on `--paper`, 12px horizontal padding, 8px gap, 12.5px
 * text, a 15px leading icon, and an optional `kbd` shortcut hint.
 *
 * The prototype renders this as a static span; here the frame is a label so
 * the whole 40px box is a click target for the real `<input>` inside it.
 */

import type { ChangeEvent, ReactElement } from "react";
import { Search } from "lucide-react";
import { cn } from "./cn";

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name for the field. Rendered visually hidden. */
  label: string;
  /** Optional keyboard hint, e.g. "Ctrl K". */
  shortcut?: string;
  className?: string;
  id?: string;
}

export default function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  shortcut,
  className,
  id,
}: SearchInputProps): ReactElement {
  return (
    <label
      className={cn(
        "h-ctl flex items-center gap-2 rounded-ctl border border-line-2 bg-paper px-3",
        "focus-within:border-ink-3",
        className,
      )}
    >
      <span className="sr-only">{label}</span>
      <Search
        size={15}
        strokeWidth={2}
        aria-hidden="true"
        className="flex-none text-ink-3"
      />
      <input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-3"
      />
      {shortcut ? (
        <kbd className="flex-none rounded-[5px] border border-line-2 px-[5px] py-[2px] text-[10px] font-bold text-ink-3">
          {shortcut}
        </kbd>
      ) : null}
    </label>
  );
}
