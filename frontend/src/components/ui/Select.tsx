import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { cn } from "./cn";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  /** Classes for the wrapper (margins, width) — the chevron is positioned against it. */
  wrapperClassName?: string;
};

/**
 * A native `<select>` dressed like the other form controls (VIS-16/17): the
 * browser's own chevron is replaced by the design system's, so the field reads
 * as a sibling of `.input-field` inputs instead of a platform widget. It stays
 * a real `<select>` — labels, `required`, keyboard and mobile pickers all keep
 * working — and the chevron is decorative.
 *
 * This is the same recipe `ManagedStudentPicker` hand-rolled
 * (`appearance-none` + a `ChevronDown` overlay), made reusable.
 */
const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, wrapperClassName, children, ...props },
  ref,
) {
  return (
    <div className={cn("relative", wrapperClassName)}>
      <select ref={ref} className={cn("input-field appearance-none pr-10", className)} {...props}>
        {children}
      </select>
      <ChevronDown
        size={ICON.sm}
        strokeWidth={1.5}
        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-3"
        aria-hidden="true"
      />
    </div>
  );
});

export default Select;
