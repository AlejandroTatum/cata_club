/**
 * "La Paleta" UI primitives.
 *
 * Every dimension in here is transcribed from `docs/ux/prototipos/_sistema.css`,
 * the approved design-system spec, and surfaced through the `h-ctl` / `h-badge`
 * / `h-stat` / `rounded-card` tokens in `tailwind.config.ts`. Use these instead
 * of hand-rolling a control: the whole point is that 40px is the default, not
 * something each caller re-derives from padding.
 */

export { default as Badge } from "./Badge";
export type { BadgeProps, BadgeTone } from "./Badge";

export { default as Button, buttonClasses } from "./Button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./Button";

export { default as EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";

export { default as FilterPill } from "./FilterPill";
export type { FilterPillProps } from "./FilterPill";

export { default as LevelChip, LEVELS, isLevel } from "./LevelChip";
export type { Level, LevelChipProps } from "./LevelChip";

export { default as PageHeader } from "./PageHeader";
export type { PageHeaderProps } from "./PageHeader";

export { default as SearchInput } from "./SearchInput";
export type { SearchInputProps } from "./SearchInput";

export { default as StatCard } from "./StatCard";
export type { StatCardProps, StatCardVariant } from "./StatCard";

export { default as Stepper } from "./Stepper";
export type { StepperProps } from "./Stepper";

export {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableNameCell,
  TableRow,
} from "./Table";
export type { TableCellProps, TableHeaderCellProps, TableNameCellProps } from "./Table";

export { cn } from "./cn";
