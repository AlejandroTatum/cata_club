import { Users } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { Button, EmptyState } from "@/components/ui";

interface FilteredRosterEmptyStateProps {
  onlyUnreviewed: boolean;
  unreviewedCount: number;
  onShowAll: () => void;
  onClearSearch: () => void;
}

/**
 * Both filters hand back their own way out — D11's third part, written as
 * something to press rather than a sentence, on the one screen where the
 * trainer is standing up with a phone in one hand.
 */
export default function FilteredRosterEmptyState({
  onlyUnreviewed,
  unreviewedCount,
  onShowAll,
  onClearSearch,
}: FilteredRosterEmptyStateProps): React.ReactElement {
  const nothingLeftUnreviewed = onlyUnreviewed && unreviewedCount === 0;
  return (
    <EmptyState
      icon={<Users size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
      title={
        nothingLeftUnreviewed
          ? "Ya revisaste a todos los jugadores de este horario."
          : "No se encontraron jugadores con ese nombre."
      }
      description={
        nothingLeftUnreviewed
          ? "Quite el filtro para volver a ver la lista completa antes de continuar."
          : "Revisa el filtro o bórralo para volver a ver la lista completa."
      }
      action={
        onlyUnreviewed ? (
          <Button type="button" onClick={onShowAll}>
            Ver la lista completa
          </Button>
        ) : (
          <Button type="button" onClick={onClearSearch}>
            Borrar el filtro
          </Button>
        )
      }
    />
  );
}
