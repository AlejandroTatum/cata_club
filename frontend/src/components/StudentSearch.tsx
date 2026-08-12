"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { searchStudents } from "@/services/api";
import type { PersonaBusqueda } from "@/types/domain";

interface StudentSearchProps {
  onSelect: (alumno: PersonaBusqueda) => void;
  /**
   * Notified whenever the box stops representing a selected student: the
   * built-in X is pressed, or the text is edited after a selection. The parent
   * must treat its selected identity as invalidated on this signal (issue
   * #200) — the text and the selected identity never diverge, and the X is the
   * only clear control. Not fired for keystrokes of a fresh search.
   */
  onClear?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function StudentSearch({
  onSelect,
  onClear,
  placeholder = "Buscar alumno por nombre…",
  disabled = false,
}: StudentSearchProps): React.ReactElement {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonaBusqueda[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  /** The identity the box currently represents, if any. */
  const [selected, setSelected] = useState<PersonaBusqueda | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [close]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchStudents(query.trim(), { limit: 10 });
        setResults(data);
        setOpen(data.length > 0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  function handleSelect(alumno: PersonaBusqueda): void {
    onSelect(alumno);
    setSelected(alumno);
    setQuery(`${alumno.nombres} ${alumno.apellidos}`);
    setOpen(false);
  }

  function handleQueryChange(value: string): void {
    setQuery(value);
    // Any edit after a selection means the box no longer represents that
    // student — invalidate the identity immediately, once. Later keystrokes
    // belong to a fresh search and must not notify again.
    if (selected !== null) {
      setSelected(null);
      onClear?.();
    }
  }

  function handleClear(): void {
    setQuery("");
    setResults([]);
    setOpen(false);
    setSelected(null);
    onClear?.();
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search
          size={ICON.sm}
          strokeWidth={1.5}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-cata-text/40"
          aria-hidden="true"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-lg border border-cata-border bg-white py-2.5 pl-9 pr-9 text-sm text-cata-text placeholder:text-cata-text/40 focus:border-cata-red focus:outline-none focus:ring-1 focus:ring-cata-red disabled:opacity-50"
          aria-label="Buscar alumno"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="student-search-listbox"
          role="combobox"
        />
        {(query.length > 0 || loading) && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-cata-text/40 hover:text-cata-text"
            aria-label="Limpiar búsqueda"
          >
            {/* `Loader2`, not a hand-rolled bordered circle: one spinner in
                the product, the same one `LoadingState` renders. */}
            {loading ? (
              <Loader2 size={ICON.sm} strokeWidth={2} className="animate-spin" aria-hidden="true" />
            ) : (
              <X size={ICON.sm} strokeWidth={2} />
            )}
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <ul
          id="student-search-listbox"
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-cata-border bg-white shadow-elevated"
        >
          {results.map((alumno) => (
            <li
              key={alumno.id}
              role="option"
              aria-selected={false}
              onClick={() => handleSelect(alumno)}
              className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-cata-surface transition-colors"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cata-red/15 text-xs font-semibold text-cata-red">
                {alumno.nombres.charAt(0)}{alumno.apellidos.charAt(0)}
              </div>
              <div>
                <p className="font-semibold text-cata-text">{alumno.nombres} {alumno.apellidos}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
