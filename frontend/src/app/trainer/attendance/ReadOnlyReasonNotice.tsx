/**
 * The permission gate, spelled out — WHAT is blocked and WHO to ask, not just
 * THAT it is blocked (issue #310 / #3). Issue #389: closing a session is now
 * permanent for everyone, admin included — there is no one left who can fix
 * it from this wizard, so the message names the actual door (administración,
 * through the separate correction flow). `role="status"` rather than
 * `alert`: this is the state of the session the user just opened, not the
 * outcome of something they did.
 */
export default function ReadOnlyReasonNotice(): React.ReactElement {
  return (
    <div
      role="status"
      className="rounded-ctl border border-state-warn/30 bg-state-warn-bg p-4 text-sm text-state-warn"
    >
      <p className="font-semibold">Esta lista ya fue registrada.</p>
      <p>
        Quedó cerrada de forma permanente — no se puede editar desde acá. Ante un error, consulte
        con administración.
      </p>
    </div>
  );
}
