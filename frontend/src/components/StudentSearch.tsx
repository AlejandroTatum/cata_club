"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { searchStudents } from "@/services/api";
import type { PersonaBusqueda } from "@/types/domain";

interface StudentSearchProps {
  readonly onSelect: (alumno: PersonaBusqueda) => void;
  /** Notified when a selected identity is cleared or edited. */
  readonly onClear?: () => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Restricts the global active-person search to a role when needed. */
  readonly role?: string;
  /** Student ids that must not be offered for the current operation. */
  readonly excludeIds?: readonly number[];
  /** Optional id for associating an external visible label with the input. */
  readonly id?: string;
  readonly ariaLabel?: string;
}

export default function StudentSearch({
  onSelect,
  onClear,
  placeholder = "Buscar alumno por nombre…",
  disabled = false,
  role,
  excludeIds = [],
  id,
  ariaLabel = "Buscar alumno",
}: StudentSearchProps): React.ReactElement {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonaBusqueda[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PersonaBusqueda | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleResults = results.filter((alumno) => !excludeIds.includes(alumno.id));
  const isOpen = open && visibleResults.length > 0;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [close]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    let cancelled = false;
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchStudents(query.trim(), { limit: 10, ...(role ? { rol: role } : {}) });
        if (cancelled) return;
        setResults(Array.isArray(data) ? data : []);
        setActiveIndex(-1);
        // Visibility is derived from the current excluded ids at render time.
        // Opening here lets a still-visible result appear after async completion.
        setOpen(true);
      } catch {
        if (!cancelled) {
          setResults([]);
          setOpen(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, role]);

  function handleSelect(alumno: PersonaBusqueda): void {
    onSelect(alumno);
    setSelected(alumno);
    setQuery(`${alumno.nombres} ${alumno.apellidos}`);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleQueryChange(value: string): void {
    setQuery(value);
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
    setActiveIndex(-1);
    onClear?.();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (visibleResults.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActiveIndex((current) => {
        if (e.key === "ArrowDown") return current < visibleResults.length - 1 ? current + 1 : 0;
        return current > 0 ? current - 1 : visibleResults.length - 1;
      });
      return;
    }
    if (e.key === "Enter" && isOpen && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(visibleResults[activeIndex]);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (isOpen) {
        setOpen(false);
        setActiveIndex(-1);
      } else if (query) {
        handleClear();
      }
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search size={ICON.sm} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
        <input
          id={id}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => visibleResults.length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-lg border border-cata-border bg-white py-2.5 pl-9 pr-9 text-sm text-cata-text placeholder:text-ink-3 focus:border-cata-red focus:outline-none focus:ring-1 focus:ring-cata-red disabled:opacity-50"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls="student-search-listbox"
          aria-activedescendant={activeIndex >= 0 ? `student-search-option-${visibleResults[activeIndex]?.id}` : undefined}
          role="combobox"
        />
        {(query.length > 0 || loading) && (
          <button type="button" onClick={handleClear} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-cata-text" aria-label="Limpiar búsqueda">
            {loading ? <Loader2 size={ICON.sm} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : <X size={ICON.sm} strokeWidth={2} />}
          </button>
        )}
      </div>
      {isOpen && (
        <div id="student-search-listbox" role="listbox" className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-cata-border bg-white shadow-elevated">
          {visibleResults.map((alumno, index) => (
            <button
              key={alumno.id}
              id={`student-search-option-${alumno.id}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={activeIndex === index}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(alumno)}
              className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-cata-surface transition-colors"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cata-red/15 text-xs font-semibold text-cata-red" aria-hidden="true">
                {alumno.nombres.charAt(0)}{alumno.apellidos.charAt(0)}
              </span>
              <span className="font-semibold text-cata-text">{alumno.nombres} {alumno.apellidos}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
