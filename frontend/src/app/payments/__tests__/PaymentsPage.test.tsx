/**
 * Component tests for PaymentsPage — the validation queue.
 *
 * Covers the four behavioural decisions of the Fase 3 redesign, each of which
 * was a measured defect before it:
 *   1. the screen opens on Pendientes, not on "Todas";
 *   2. every row is operable from the keyboard through a real button (the old
 *      `<tr onClick>` was unreachable without a mouse);
 *   3. approving or rejecting advances to the next pending request instead of
 *      dumping the admin back into an unfiltered list;
 *   4. "Aprobar" is gated on a real checklist, not on static prose.
 * Plus the pre-existing approve-confirmation and voucher-preview contracts.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import PaymentsPage from "@/app/payments/page";
import type { PaymentValidationRequest } from "@/services/api";
import { ToastProvider } from "@/contexts/ToastContext";
import ToastContainer from "@/components/ToastContainer";
import { UNDO_WINDOW_MS } from "@/lib/deferred-commit";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// AppShell (the page's sidebar layout) needs next/navigation, next/link,
// next/image, and AuthContext — none of which this page uses directly.
// Mocked minimally, matching the pattern in Header.test.tsx / AppShell.test.tsx.
vi.mock("next/navigation", () => ({
  usePathname: () => "/payments",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) => {
    const { fill, priority, sizes, ...rest } = props;
    void fill;
    void priority;
    void sizes;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="" {...rest} />;
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: { id: "u1", name: "Admin Test", email: "admin@cataclub.com", role: "admin", representanteId: null },
      roles: ["ADMINISTRADOR"],
      loggedInAt: "2026-07-01T12:00:00Z",
    },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const mockFetchPaymentValidations = vi.fn();
const mockUpdatePaymentValidation = vi.fn();

vi.mock("@/services/api", () => ({
  fetchPaymentValidations: () => mockFetchPaymentValidations(),
  updatePaymentValidation: (id: string, dto: unknown) =>
    mockUpdatePaymentValidation(id, dto),
}));

const PENDING_REQUEST: PaymentValidationRequest = {
  id: "req-1",
  studentName: "Juan Pérez",
  responsablePagoName: "María Pérez",
  membershipPeriod: "01/07/2026 – 12/08/2026",
  membershipType: "Mensual",
  expectedAmount: 50,
  paymentMethod: "Transferencia",
  uploadedAt: "2026-07-01T10:00:00.000Z",
  currentMembershipStatus: "vencida",
  proofFileName: "comprobante.pdf",
  proofFileType: "pdf",
  // The checklist keys off the attachment, so the fixture has to be honest
  // about having one: `proofFileName` and `proofPreviewUrl` both come from the
  // backend's `voucherUrl` (payments-adapter.ts) and cannot disagree.
  proofPreviewUrl: "https://files.example/comprobante.pdf",
  validationStatus: "pendiente",
  startDate: "2026-07-01",
  endDate: "2026-07-31",
};

/** Efectivo, no voucher — the payment the old fixed checklist could not ask about. */
const CASH_REQUEST: PaymentValidationRequest = {
  ...PENDING_REQUEST,
  id: "req-cash",
  studentName: "Sofía Vera",
  expectedAmount: 25,
  paymentMethod: "Efectivo",
  proofFileName: "Sin comprobante adjunto",
  proofPreviewUrl: undefined,
};

const SECOND_PENDING: PaymentValidationRequest = {
  ...PENDING_REQUEST,
  id: "req-2",
  studentName: "Sofia Vera",
  responsablePagoName: "Laura Vera",
  expectedAmount: 25,
};

const RESOLVED_REQUEST: PaymentValidationRequest = {
  ...PENDING_REQUEST,
  id: "req-3",
  studentName: "Kevin Sabando",
  validationStatus: "validado",
  validatedAt: "2026-07-05T10:00:00.000Z",
  validatedBy: "Admin Dev",
};

const REJECTED_REQUEST: PaymentValidationRequest = {
  ...PENDING_REQUEST,
  id: "req-4",
  studentName: "Ana Torres",
  validationStatus: "rechazado",
  rejectionReason: "El monto no coincide",
};

function renderPage(): void {
  render(<ToastProvider><PaymentsPage /></ToastProvider>);
}

/**
 * The queue renders twice — a table at `md` and up, cards below it — and jsdom
 * evaluates no media query, so both are in the document. Every queue assertion
 * scopes itself to one of the two on purpose.
 */
function queueTable(): HTMLElement {
  return screen.getByTestId("payments-table");
}

/** Open a request from the queue the way a keyboard user would: via its button. */
async function openRequest(studentName: string): Promise<void> {
  await screen.findByTestId("payments-table");
  const action = within(queueTable()).getByRole("button", {
    name: new RegExp(`(revisar el|ver el detalle del) pago de ${studentName}`, "i"),
  });
  fireEvent.click(action);
}

/**
 * The desktop table's batch checkbox for a given student, scoped by row
 * rather than by accessible name: several unreviewed rows can carry the same
 * shared reason text, so the row is what disambiguates them in a lookup.
 */
function batchCheckbox(studentName: string): HTMLElement {
  const row = within(queueTable()).getByText(studentName).closest("tr");
  if (!row) throw new Error(`No row found for ${studentName}`);
  return within(row as HTMLElement).getByRole("checkbox");
}

/**
 * The accessible name an `aria-labelledby` list produces: the referenced
 * elements' text content, in order, joined by a space. Computed by hand
 * rather than imported from an accessibility library so the assertion does
 * not depend on one being resolvable in this workspace.
 */
function accessibleNameFromLabelledby(el: HTMLElement): string {
  return (el.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
    .join(" ")
    .trim();
}

/** Tick every checklist item, which is what unlocks "Aprobar pago". */
function completeChecklist(): void {
  const group = screen.getByRole("group", { name: /antes de aprobar/i });
  for (const box of within(group).getAllByRole("checkbox")) {
    fireEvent.click(box);
  }
}

async function openPendingWithChecklistDone(): Promise<void> {
  renderPage();
  await openRequest("Juan Pérez");
  await screen.findByRole("button", { name: /aprobar pago/i });
  completeChecklist();
}

/** The toast (or banner) whose text matches, among all the live regions up. */
async function liveRegionSaying(text: RegExp): Promise<HTMLElement> {
  return waitFor(() => {
    const match = screen
      .getAllByRole("status")
      .find((region) => text.test(region.textContent ?? ""));
    if (!match) throw new Error(`No live region matching ${text}`);
    return match;
  });
}

beforeEach(() => {
  // A decision is held for a few seconds before it is sent, so the undo window
  // is something every case has to be able to step over deliberately.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockFetchPaymentValidations.mockReset().mockResolvedValue([PENDING_REQUEST]);
  mockUpdatePaymentValidation.mockReset().mockImplementation((id: string) =>
    Promise.resolve({ ...PENDING_REQUEST, id, validationStatus: "validado" }),
  );
});

afterEach(() => {
  // Unmount first: leaving the screen FLUSHES a held decision, and that must
  // happen while the fake timers are still installed.
  cleanup();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. The queue opens on the work of the day
// ---------------------------------------------------------------------------

describe("PaymentsPage — opens on the pending queue", () => {
  it("defaults the state filter to Pendientes instead of Todas", async () => {
    mockFetchPaymentValidations.mockResolvedValue([PENDING_REQUEST, RESOLVED_REQUEST]);
    renderPage();

    const pendientes = await screen.findByRole("button", { name: /^pendientes/i });
    expect(pendientes).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^todas/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows only pending requests until the admin asks for the rest", async () => {
    mockFetchPaymentValidations.mockResolvedValue([PENDING_REQUEST, RESOLVED_REQUEST]);
    renderPage();

    await screen.findByTestId("payments-table");
    // `findByTestId` resolves the instant the table SHELL mounts, not once
    // its rows have finished rendering under the "pendiente" filter — an
    // absence assertion right after it races an unsettled DOM. The row count
    // (header + the one pending row) is a positive, deterministic signal
    // that the filtered render is done, so the absence check that follows it
    // means something.
    await waitFor(() => expect(within(queueTable()).getAllByRole("row")).toHaveLength(2));
    expect(within(queueTable()).getByText("Juan Pérez")).toBeInTheDocument();
    expect(within(queueTable()).queryByText("Kevin Sabando")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^todas/i }));
    expect(within(queueTable()).getByText("Kevin Sabando")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 1b. The status badge doesn't echo the active tab
// ---------------------------------------------------------------------------

describe("PaymentsPage — the status badge doesn't echo the active tab", () => {
  it("hides the per-row status badge while the tab already fixes a single status", async () => {
    mockFetchPaymentValidations.mockResolvedValue([PENDING_REQUEST, RESOLVED_REQUEST]);
    renderPage();

    // "Pendientes" is the default tab: every visible row is already pending,
    // so a per-row "Pendiente" badge would only restate the tab.
    await screen.findByTestId("payments-table");
    // `findByTestId` resolves the instant the table SHELL mounts, not once
    // its rows have finished rendering under the "pendiente" filter (only 1
    // of the 2 fetched requests is pending). Asserting the badge's absence
    // right after `findByTestId` races that unsettled DOM: locally the row
    // always wins the race, but under CI's worker scheduling the stale
    // (unfiltered) render can still be on screen, badge and all. Waiting for
    // the exact filtered row count first is a positive, deterministic signal
    // that the filtered render has settled, so the absence check that
    // follows it means something instead of getting lucky on timing.
    await waitFor(() => expect(within(queueTable()).getAllByRole("row")).toHaveLength(2));
    expect(within(queueTable()).queryByText("Pendiente")).not.toBeInTheDocument();

    const cards = screen.getByTestId("payments-cards");
    await waitFor(() => expect(within(cards).getAllByRole("listitem")).toHaveLength(1));
    expect(within(cards).queryByText("Pendiente")).not.toBeInTheDocument();
  });

  it("shows the per-row status badge once the tab stops fixing a single status", async () => {
    mockFetchPaymentValidations.mockResolvedValue([PENDING_REQUEST, RESOLVED_REQUEST]);
    renderPage();

    await screen.findByTestId("payments-table");
    fireEvent.click(screen.getByRole("button", { name: /^todas/i }));

    expect(within(queueTable()).getByText("Pendiente")).toBeInTheDocument();
    expect(within(queueTable()).getByText("Validado")).toBeInTheDocument();
    // The mobile cards render the same rows through their own branch
    // (`payments-cards`), which carries its own copy of this badge.
    const cards = screen.getByTestId("payments-cards");
    expect(within(cards).getByText("Pendiente")).toBeInTheDocument();
    expect(within(cards).getByText("Validado")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 1c. Every visible header names a column that actually has content
// ---------------------------------------------------------------------------

describe("PaymentsPage — every visible column header has matching content", () => {
  /**
   * General regression guard, not a one-off: a header whose text is announced
   * to a sighted admin (i.e. not an `sr-only`-only label, like the batch
   * checkbox or action columns) must correspond to a column that renders
   * *something* in at least one visible row. This is exactly the shape of the
   * "Estado" defect — the header stayed after every row's cell in that column
   * went empty for three of the four filter tabs — and it holds for whichever
   * column trips it next, not just that one.
   */
  it("never leaves a header's column empty across every row, on any filter tab", async () => {
    // One request per status, so every tab — including "Rechazados" — has at
    // least one row and renders the table instead of the empty state.
    mockFetchPaymentValidations.mockResolvedValue([
      PENDING_REQUEST,
      SECOND_PENDING,
      RESOLVED_REQUEST,
      REJECTED_REQUEST,
    ]);
    renderPage();
    await screen.findByTestId("payments-table");

    for (const tabName of ["Pendientes", "Validados", "Rechazados", "Todas"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${tabName}`, "i") }));
      const table = await screen.findByTestId("payments-table");
      await waitFor(() => {
        expect(table.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
      });

      const headerCells = Array.from(table.querySelectorAll("thead th"));
      const rows = Array.from(table.querySelectorAll("tbody tr"));

      headerCells.forEach((th, colIndex) => {
        // `sr-only` labels (the batch-selection and action columns) are real
        // accessible names but never *visible* headers, so they carry no
        // promise that the column reads as non-empty on screen.
        const isVisibleHeader = !th.querySelector(".sr-only");
        const headerText = th.textContent?.trim() ?? "";
        if (!isVisibleHeader || !headerText) return;

        const columnHasContent = rows.some((row) => {
          const cell = row.querySelectorAll("td")[colIndex];
          return Boolean(cell?.textContent?.trim());
        });
        expect(
          columnHasContent,
          `header "${headerText}" on tab "${tabName}" has no content in any row`,
        ).toBe(true);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Keyboard operability
// ---------------------------------------------------------------------------

describe("PaymentsPage — the queue is operable without a mouse", () => {
  it("opens a request from a real, named button rather than a click handler on the row", async () => {
    renderPage();

    await screen.findByTestId("payments-table");
    const action = within(queueTable()).getByRole("button", { name: /revisar el pago de Juan Pérez/i });
    // A `<button>` is focusable and Enter/Space-activatable by construction —
    // which the old `<tr onClick>` (no tabIndex, no role, no onKeyDown) was not.
    expect(action.tagName).toBe("BUTTON");

    fireEvent.click(action);
    expect(await screen.findByRole("button", { name: /aprobar pago/i })).toBeInTheDocument();
  });

  it("leaves the table rows themselves inert, so there is no invisible click target", async () => {
    renderPage();
    await screen.findByTestId("payments-table");

    for (const row of document.querySelectorAll("tbody tr")) {
      expect(row).not.toHaveAttribute("tabindex");
      expect(row).not.toHaveAttribute("role");
      expect(row.className).not.toContain("cursor-pointer");
    }
  });

  it("labels the action by outcome for already-resolved requests", async () => {
    mockFetchPaymentValidations.mockResolvedValue([RESOLVED_REQUEST]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /^todas/i }));
    await screen.findByTestId("payments-table");
    expect(
      within(queueTable()).getByRole("button", { name: /ver el detalle del pago de Kevin Sabando/i }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2b. Focus follows the view swap
// ---------------------------------------------------------------------------

describe("PaymentsPage — focus follows the queue ⇄ detail swap", () => {
  /** The detail's heading, which is where focus is supposed to land. */
  function detailHeading(): HTMLElement {
    return screen.getByRole("heading", { name: /detalle de la solicitud/i });
  }

  it("moves focus into the detail when a request opens", async () => {
    renderPage();
    await openRequest("Juan Pérez");

    // Opening replaces the queue in place, so the button that was focused is
    // unmounted; without this the browser drops focus to <body> and a keyboard
    // admin restarts from the top of the document.
    await waitFor(() => expect(document.activeElement).toBe(detailHeading()));
    expect(detailHeading()).toHaveAttribute("tabindex", "-1");
  });

  it("marks that landing with a ring that reads on the card, not a 1.41:1 ball", async () => {
    renderPage();
    await openRequest("Juan Pérez");
    await waitFor(() => expect(document.activeElement).toBe(detailHeading()));

    // `tabindex="-1"` is exactly what the globals.css rule excludes, so this
    // heading paints its own ring — and a bare `outline-ball` on the paper
    // card is 1.41:1, the failure that rule exists to correct. The coal band
    // inside the outline is what clears 3:1; the ring is inset because the
    // section clips overflow. Measurements: color-contrast.test.ts.
    expect(detailHeading().className).toContain("focus-visible:outline-ball");
    expect(detailHeading().className).toContain("focus-visible:shadow-focus-band-inset");
  });

  it("returns focus to the row action it came from", async () => {
    renderPage();
    await openRequest("Juan Pérez");
    await screen.findByRole("link", { name: /volver a membresías y pagos/i });

    fireEvent.click(screen.getByRole("link", { name: /volver a membresías y pagos/i }));

    await screen.findByTestId("payments-table");
    const action = within(queueTable()).getByRole("button", {
      name: /revisar el pago de Juan Pérez/i,
    });
    await waitFor(() => expect(document.activeElement).toBe(action));
  });

  it("does not pretend to be a modal", async () => {
    renderPage();
    await openRequest("Juan Pérez");
    await screen.findByRole("link", { name: /volver a membresías y pagos/i });

    // An in-page view swap, not a dialog: no `role="dialog"`, no `aria-modal`,
    // no focus trap. Calling it a dialog would promise a background that is
    // still there and an Escape key that closes it.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector("[aria-modal]")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2c. No standalone value sits as bare text — the DataBox rule
// ---------------------------------------------------------------------------

describe("PaymentsPage — detail values that matter are boxed, not bare text", () => {
  /** DataBox's own signature classes (`DataBox.tsx`) — not `.tagName`, since
   *  the value itself is what has to carry the box, wherever it renders. */
  function isDataBoxed(el: Element | null): boolean {
    return !!el && /\bbg-sunken\b/.test(el.className) && /\bborder-line\b/.test(el.className);
  }

  it("boxes the payment method instead of leaving it as running prose", async () => {
    renderPage();
    await openRequest("Juan Pérez");

    const value = await screen.findByText("Transferencia");
    expect(isDataBoxed(value)).toBe(true);
  });

  it("boxes the membership type the same way", async () => {
    renderPage();
    await openRequest("Juan Pérez");

    const value = screen.getByText("Mensual");
    expect(isDataBoxed(value)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Queue position and auto-advance
// ---------------------------------------------------------------------------

describe("PaymentsPage — the detail view keeps the admin's place in the queue", () => {
  beforeEach(() => {
    mockFetchPaymentValidations.mockResolvedValue([PENDING_REQUEST, SECOND_PENDING]);
  });

  it("states the position in the pending queue", async () => {
    renderPage();
    await openRequest("Juan Pérez");

    expect(await screen.findByText("Pendiente 1 de 2")).toBeInTheDocument();
  });

  it("moves to the next pending request without going back to the list", async () => {
    renderPage();
    await openRequest("Juan Pérez");
    await screen.findByText("Pendiente 1 de 2");

    fireEvent.click(screen.getByRole("button", { name: /pendiente siguiente/i }));

    expect(await screen.findByText("Pendiente 2 de 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pendiente siguiente/i })).toBeDisabled();
  });

  it("advances to the next pending request after an approval", async () => {
    mockUpdatePaymentValidation.mockResolvedValue({
      ...PENDING_REQUEST,
      validationStatus: "validado",
    });
    renderPage();
    await openRequest("Juan Pérez");
    await screen.findByRole("button", { name: /aprobar pago/i });
    completeChecklist();

    fireEvent.click(screen.getByRole("button", { name: /aprobar pago/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirmar$/i }));

    // The queue lost one item, and the admin is now on the survivor.
    expect(await screen.findByText("Pendiente 1 de 1")).toBeInTheDocument();
    expect(screen.getAllByText("Sofia Vera").length).toBeGreaterThan(0);
  });

  it("returns to the list when the queue is emptied", async () => {
    mockFetchPaymentValidations.mockResolvedValue([PENDING_REQUEST]);
    mockUpdatePaymentValidation.mockResolvedValue({
      ...PENDING_REQUEST,
      validationStatus: "validado",
    });
    await openPendingWithChecklistDone();

    fireEvent.click(screen.getByRole("button", { name: /aprobar pago/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirmar$/i }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /aprobar pago/i })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^pendientes/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4. The checklist gates the approval
// ---------------------------------------------------------------------------

describe("PaymentsPage — the checklist gates 'Aprobar'", () => {
  it("keeps 'Aprobar pago' disabled until every item is confirmed", async () => {
    renderPage();
    await openRequest("Juan Pérez");

    const approve = await screen.findByRole("button", { name: /aprobar pago/i });
    expect(approve).toBeDisabled();

    completeChecklist();
    expect(screen.getByRole("button", { name: /aprobar pago/i })).toBeEnabled();
  });

  it("names the expected amount inside the item that checks it", async () => {
    renderPage();
    await openRequest("Juan Pérez");

    expect(
      await screen.findByText("El monto del comprobante coincide con $50,00"),
    ).toBeInTheDocument();
  });

  it("re-locks the approval when the admin moves to another request", async () => {
    mockFetchPaymentValidations.mockResolvedValue([PENDING_REQUEST, SECOND_PENDING]);
    renderPage();
    await openRequest("Juan Pérez");
    await screen.findByRole("button", { name: /aprobar pago/i });
    completeChecklist();

    fireEvent.click(screen.getByRole("button", { name: /pendiente siguiente/i }));

    expect(await screen.findByRole("button", { name: /aprobar pago/i })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 4b. The checklist asks what the payment method makes answerable
// ---------------------------------------------------------------------------

describe("PaymentsPage — the checklist adapts to the payment method", () => {
  function checklistLabels(): string[] {
    const group = screen.getByRole("group", { name: /antes de aprobar/i });
    return within(group)
      .getAllByRole("checkbox")
      .map((box) => (box.closest("label")?.textContent ?? "").trim());
  }

  it("never asks a cash payment about a comprobante it does not have", async () => {
    mockFetchPaymentValidations.mockResolvedValue([CASH_REQUEST]);
    renderPage();
    await openRequest("Sofía Vera");
    await screen.findByRole("button", { name: /aprobar pago/i });

    const labels = checklistLabels();
    // The two boxes an admin could only tick by lying, which is what taught
    // them to tick blindly on the transfers where it matters.
    expect(labels.some((l) => /comprobante/i.test(l))).toBe(false);
    expect(labels).toContain("Se recibió $25,00 en efectivo");
  });

  it("still gates 'Aprobar pago' on the cash items, and still names what is missing", async () => {
    mockFetchPaymentValidations.mockResolvedValue([CASH_REQUEST]);
    renderPage();
    await openRequest("Sofía Vera");

    const approve = await screen.findByRole("button", { name: /aprobar pago/i });
    expect(approve).toBeDisabled();
    expect(screen.getByText(/faltan 2 puntos de la lista/i)).toBeInTheDocument();

    const [first, second] = within(
      screen.getByRole("group", { name: /antes de aprobar/i }),
    ).getAllByRole("checkbox");
    fireEvent.click(first);
    expect(screen.getByText(/falta confirmar 1 punto de la lista/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /aprobar pago/i })).toBeDisabled();

    fireEvent.click(second);
    expect(screen.getByRole("button", { name: /aprobar pago/i })).toBeEnabled();
  });

  it("keeps the voucher questions for a transfer that has a voucher", async () => {
    renderPage();
    await openRequest("Juan Pérez");
    await screen.findByRole("button", { name: /aprobar pago/i });

    expect(checklistLabels()).toEqual([
      "El comprobante es legible y no está cortado",
      "El monto del comprobante coincide con $50,00",
      "La fecha de la transferencia cae dentro del período",
    ]);
  });

  it("sends a proofless transfer to the club's account instead of to a missing file", async () => {
    mockFetchPaymentValidations.mockResolvedValue([{ ...PENDING_REQUEST, proofPreviewUrl: undefined }]);
    renderPage();
    await openRequest("Juan Pérez");
    await screen.findByRole("button", { name: /aprobar pago/i });

    expect(checklistLabels()).toEqual([
      "La transferencia de $50,00 está acreditada en la cuenta del club",
      "El período de vigencia que se va a activar es el correcto",
    ]);
    expect(screen.getByText(/verifíquela en la cuenta del club/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Rejection — typified reason, sent verbatim to the payer
// ---------------------------------------------------------------------------

describe("PaymentsPage — rejection", () => {
  it("blocks the rejection until a reason is chosen", async () => {
    renderPage();
    await openRequest("Juan Pérez");
    fireEvent.click(await screen.findByRole("button", { name: /rechazar pago/i }));

    expect(screen.getByRole("button", { name: /rechazar y avisar/i })).toBeDisabled();
    expect(mockUpdatePaymentValidation).not.toHaveBeenCalled();
  });

  it("sends the chosen reason, with the optional note appended", async () => {
    mockUpdatePaymentValidation.mockResolvedValue({
      ...PENDING_REQUEST,
      validationStatus: "rechazado",
      rejectionReason: "El monto no coincide",
    });
    renderPage();
    await openRequest("Juan Pérez");
    fireEvent.click(await screen.findByRole("button", { name: /rechazar pago/i }));

    fireEvent.click(screen.getByRole("radio", { name: /el monto no coincide/i }));
    fireEvent.change(screen.getByLabelText(/nota para el responsable/i), {
      target: { value: "El comprobante dice $20,00." },
    });
    fireEvent.click(screen.getByRole("button", { name: /rechazar y avisar/i }));

    // The decision is held for the undo window before it is sent, so the
    // assertion about what reaches the server has to step over that window.
    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    await waitFor(() => expect(mockUpdatePaymentValidation).toHaveBeenCalledTimes(1));
    expect(mockUpdatePaymentValidation).toHaveBeenCalledWith("req-1", {
      action: "rejected",
      rejectionReason: "El monto no coincide — El comprobante dice $20,00.",
    });
  });

  it("names the person who will receive the rejection", async () => {
    renderPage();
    await openRequest("Juan Pérez");
    fireEvent.click(await screen.findByRole("button", { name: /rechazar pago/i }));

    expect(
      screen.getByText(/María Pérez va a recibir este motivo tal cual/),
    ).toBeInTheDocument();
  });

  // Hallazgo en vivo, 2026-08-11: this field had no client-side limit, so a
  // long note only ever discovered the backend's cap by crashing a request
  // that had already committed the rejection. The field now caps input and
  // shows the count live instead of letting the admin find the wall by
  // hitting it.
  it("caps the rejection note and shows a live character count", async () => {
    renderPage();
    await openRequest("Juan Pérez");
    fireEvent.click(await screen.findByRole("button", { name: /rechazar pago/i }));

    const nota = screen.getByLabelText(/nota para el responsable/i) as HTMLTextAreaElement;
    expect(nota).toHaveAttribute("maxLength", "200");
    expect(screen.getByText("0/200")).toBeInTheDocument();

    fireEvent.change(nota, { target: { value: "x".repeat(250) } });

    // The DOM's own `maxLength` clamps a direct `.value` assignment too, so
    // this also guards against a future change that types the counter off
    // the constant instead of reading it.
    expect(nota.value).toHaveLength(200);
    expect(screen.getByText("200/200")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pre-existing contracts kept green
// ---------------------------------------------------------------------------

describe("PaymentsPage — approve confirmation gating", () => {
  it("opens a confirmation dialog on 'Aprobar Pago' click without mutating yet", async () => {
    await openPendingWithChecklistDone();

    fireEvent.click(screen.getByRole("button", { name: /aprobar pago/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockUpdatePaymentValidation).not.toHaveBeenCalled();
  });

  it("mutates the payment status only after the confirm control is activated", async () => {
    await openPendingWithChecklistDone();

    fireEvent.click(screen.getByRole("button", { name: /aprobar pago/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirmar$/i }));

    // Confirming starts the undo window rather than the request; the send is
    // what this case is about, so it steps over the window to reach it.
    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    await waitFor(() => {
      expect(mockUpdatePaymentValidation).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdatePaymentValidation).toHaveBeenCalledWith("req-1", {
      action: "approved",
      startDate: "2026-07-01",
      endDate: "2026-08-01",
    });
  });

  it("leaves the payment status unchanged when the confirmation is canceled", async () => {
    await openPendingWithChecklistDone();

    fireEvent.click(screen.getByRole("button", { name: /aprobar pago/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancelar$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockUpdatePaymentValidation).not.toHaveBeenCalled();
  });
});

describe("PaymentsPage — voucher preview recovery", () => {
  it("replaces a failed voucher preview with a labeled download fallback", async () => {
    mockFetchPaymentValidations.mockResolvedValue([{ ...PENDING_REQUEST, proofPreviewUrl: "https://files.example/voucher.png", proofFileType: "image" }]);

    renderPage();
    await openRequest("Juan Pérez");
    fireEvent.error(await screen.findByRole("img", { name: /vista previa del comprobante/i }));

    expect(screen.getByRole("status")).toHaveTextContent("Comprobante no disponible");
    expect(screen.getByRole("link", { name: /descargar comprobante/i })).toHaveAttribute("href", "https://files.example/voucher.png");
  });

  it("allows a reviewer to retry the preview without changing the payment", async () => {
    mockFetchPaymentValidations.mockResolvedValue([{ ...PENDING_REQUEST, proofPreviewUrl: "https://files.example/voucher.png", proofFileType: "image" }]);

    renderPage();
    await openRequest("Juan Pérez");
    fireEvent.error(await screen.findByRole("img", { name: /vista previa del comprobante/i }));
    fireEvent.click(screen.getByRole("button", { name: /reintentar vista previa/i }));

    expect(screen.getByRole("img", { name: /vista previa del comprobante/i })).toBeInTheDocument();
    expect(mockUpdatePaymentValidation).not.toHaveBeenCalled();
  });

  it("does not claim the preview is unavailable while the voucher image is rendering successfully", async () => {
    mockFetchPaymentValidations.mockResolvedValue([{ ...PENDING_REQUEST, proofPreviewUrl: "https://files.example/voucher.png", proofFileType: "image" }]);

    renderPage();
    await openRequest("Juan Pérez");
    await screen.findByRole("img", { name: /vista previa del comprobante/i });

    expect(screen.queryByText(/vista previa no disponible/i)).not.toBeInTheDocument();
  });

  it("shows the unavailable message only when there is no preview URL at all", async () => {
    mockFetchPaymentValidations.mockResolvedValue([{ ...PENDING_REQUEST, proofPreviewUrl: undefined }]); // no proofPreviewUrl

    renderPage();
    await openRequest("Juan Pérez");

    expect(await screen.findByText(/vista previa no disponible/i)).toBeInTheDocument();
  });
});

describe("PaymentsPage — unrelated happy path", () => {
  it("does not add contextual help to the unrelated payment-review journey", async () => {
    renderPage();
    await openRequest("Juan Pérez");
    await screen.findByRole("button", { name: /aprobar pago/i });

    expect(screen.queryByRole("button", { name: /ayuda sobre/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Batch approval — multi-select that commits reviews, never replaces them
// ---------------------------------------------------------------------------

describe("PaymentsPage — batch approval", () => {
  beforeEach(() => {
    mockFetchPaymentValidations.mockResolvedValue([PENDING_REQUEST, SECOND_PENDING]);
  });

  /** Complete the open detail's checklist and park it for the batch. */
  async function parkOpenDetail(): Promise<void> {
    await screen.findByRole("button", { name: /aprobar pago/i });
    completeChecklist();
    fireEvent.click(screen.getByRole("button", { name: /revisado, aprobar después/i }));
  }

  /** Open a request from the queue, then park it. */
  async function reviewForBatch(studentName: string): Promise<void> {
    await openRequest(studentName);
    await parkOpenDetail();
  }

  /** Park both pending requests: parking the first advances to the second. */
  async function reviewBothForBatch(): Promise<void> {
    await reviewForBatch("Juan Pérez");
    await parkOpenDetail();
  }

  it("cannot select a payment that was never reviewed, and says why on screen", async () => {
    mockFetchPaymentValidations.mockResolvedValue([PENDING_REQUEST, SECOND_PENDING]);
    renderPage();
    await screen.findByTestId("payments-table");

    const checkbox = batchCheckbox("Juan Pérez");
    expect(checkbox).toBeDisabled();
    // The reason used to be duplicated inline next to every unreviewed
    // checkbox, which is what stacked one word per line in the batch
    // column's 52px width. It now reads once, above the list, and every
    // unreviewed checkbox's accessible name is composed from that single
    // node plus the row's own student name — real text a sighted admin can
    // read, and the same text a screen reader announces, never duplicated
    // per row. Both pending rows here are unreviewed, so the shared reason
    // alone would not be a unique name; the student name is what
    // disambiguates them.
    const reason = "Un pago se puede sumar a un lote recién después de revisarlo.";
    expect(screen.getAllByText(reason)).toHaveLength(1);
    const row = checkbox.closest("tr") as HTMLElement;
    expect(within(row).queryByText(reason)).not.toBeInTheDocument();
    expect(checkbox).toHaveAccessibleName(`Juan Pérez ${reason}`);
    expect(screen.queryByRole("group", { name: /aprobación por lote/i })).not.toBeInTheDocument();

    // It renders once, above the list, on the page canvas rather than inside a
    // card — and `ink-3` only clears AA on `paper`. Measured against the QA
    // stack this line came out 3.78:1 at 12.5px, under the 4.5:1 floor, which
    // made the sentence explaining WHY every batch checkbox is disabled the
    // least legible string on the screen. `ink-3-strong` is the step the ramp
    // declares for this surface.
    expect(screen.getByText(reason)).toHaveClass("text-ink-3-strong");
  });

  it("requires the payment's own checklist before it can be parked for a batch", async () => {
    renderPage();
    await openRequest("Juan Pérez");

    // Same gate as "Aprobar pago": the batch is a commit path, not a shortcut.
    expect(await screen.findByRole("button", { name: /revisado, aprobar después/i })).toBeDisabled();
    completeChecklist();
    expect(screen.getByRole("button", { name: /revisado, aprobar después/i })).toBeEnabled();
  });

  it("parks a reviewed payment without approving it, and moves to the next unreviewed one", async () => {
    renderPage();
    await reviewForBatch("Juan Pérez");

    // Still pending: nothing was sent.
    expect(mockUpdatePaymentValidation).not.toHaveBeenCalled();
    expect(await screen.findByText("Pendiente 2 de 2")).toBeInTheDocument();
  });

  it("shows the parked payments as a batch with its count and total", async () => {
    renderPage();
    await reviewBothForBatch();

    // Both reviewed → the queue comes back on its own.
    const bar = await screen.findByRole("group", { name: /aprobación por lote/i });
    expect(bar.textContent).toContain("2 de 2 pagos revisados seleccionados");
    expect(bar.textContent).toContain("$75,00");
    expect(batchCheckbox("Juan Pérez")).toBeEnabled();
    expect(within(queueTable()).getAllByText("Revisado")).toHaveLength(2);
  });

  // The density rule from design review: a screen keeps one line of prose at
  // most, and anything that explains how the system works moves to Ayuda. The
  // "N pagos revisados esperan aprobación. Elija cuáles aprobar juntos." copy
  // repeated the "Seleccionar los N revisados" button right below it, so the
  // instructional half is gone — replaced by a link to the FAQ answer that
  // already covers batch approval, for whoever still wants the explanation.
  it("keeps the parked-batch prompt to one short line, with a link to the explanation instead of prose", async () => {
    // A single pending payment: parking it has nothing left to advance to, so
    // it returns straight to the queue with the batch bar visible. Parking
    // pre-selects it into the batch, so "nothing selected" — the copy under
    // test — only shows once that selection is explicitly cleared.
    mockFetchPaymentValidations.mockResolvedValue([PENDING_REQUEST]);
    renderPage();
    await reviewForBatch("Juan Pérez");
    const bar = await screen.findByRole("group", { name: /aprobación por lote/i });
    fireEvent.click(within(bar).getByRole("button", { name: /limpiar selección/i }));

    expect(bar.textContent).toContain("1 pagos revisados esperan aprobación.");
    expect(bar.textContent).not.toMatch(/elija cuáles aprobar juntos/i);
    const helpLink = within(bar).getByRole("link", { name: /cómo funciona/i });
    expect(helpLink).toHaveAttribute("href", "/ayuda#faq-si-es-administrador");
  });

  it("marks a parked payment's own detail with a compact badge, not a sentence explaining the batch", async () => {
    renderPage();
    // Parking Juan auto-advances to Sofia's detail — back to the queue, then
    // reopen Juan's own detail to see how a parked payment reads there.
    await reviewForBatch("Juan Pérez");
    fireEvent.click(await screen.findByRole("link", { name: /volver a membresías y pagos/i }));
    await openRequest("Juan Pérez");

    await screen.findByRole("heading", { name: /detalle de la solicitud/i });
    expect(
      screen.queryByText(/ya está marcado como revisado y espera en la cola/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/revisado.*lote/i)).toBeInTheDocument();
  });

  it("names the payments in the confirmation before approving any of them", async () => {
    renderPage();
    await reviewBothForBatch();

    fireEvent.click(await screen.findByRole("button", { name: /^aprobar 2 pagos$/i }));

    expect(
      within(screen.getByRole("dialog")).getByText(
        /Se van a aprobar 2 pagos ya revisados, por un total de \$75,00\. Se activan las membresías de Juan Pérez, Sofia Vera\./,
      ),
    ).toBeInTheDocument();
    expect(mockUpdatePaymentValidation).not.toHaveBeenCalled();
  });

  it("sends one call per payment, with the period each was reviewed with", async () => {
    renderPage();
    await reviewBothForBatch();

    fireEvent.click(await screen.findByRole("button", { name: /^aprobar 2 pagos$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^aprobar los 2$/i }));

    // No batch endpoint exists (PATCH /membresias/pagos/{id}/validar is per
    // payment), so N sequential calls is the honest implementation.
    await waitFor(() => expect(mockUpdatePaymentValidation).toHaveBeenCalledTimes(2));
    expect(mockUpdatePaymentValidation).toHaveBeenNthCalledWith(1, "req-1", {
      action: "approved",
      startDate: "2026-07-01",
      endDate: "2026-08-01",
    });
    expect(mockUpdatePaymentValidation).toHaveBeenNthCalledWith(2, "req-2", {
      action: "approved",
      startDate: "2026-07-01",
      endDate: "2026-08-01",
    });
  });

  it("reports a half-done batch by name, and keeps the failures ready to retry", async () => {
    mockUpdatePaymentValidation.mockImplementation((id: string) =>
      id === "req-2"
        ? Promise.reject(new Error("500"))
        : Promise.resolve({ ...PENDING_REQUEST, id, validationStatus: "validado" }),
    );
    renderPage();
    await reviewBothForBatch();

    fireEvent.click(await screen.findByRole("button", { name: /^aprobar 2 pagos$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^aprobar los 2$/i }));

    const report = await screen.findByRole("region", { name: /el lote quedó a medias/i });
    expect(within(report).getByText(/Se aprobaron 1: Juan Pérez\./)).toBeInTheDocument();
    expect(within(report).getByText(/No se pudo aprobar 1 pago: Sofia Vera\./)).toBeInTheDocument();
    // The survivor is still pending, still reviewed, still selected — one click
    // retries it and nothing has to be reviewed twice.
    expect(within(report).getByRole("button", { name: /reintentar el pago/i })).toBeEnabled();
    expect(await screen.findByRole("button", { name: /^aprobar 1 pago$/i })).toBeEnabled();
  });

  it("drops the batch mark for a payment approved on its own", async () => {
    // The default mock echoes back the id it was called with — approving Sofía
    // must resolve Sofía, not whichever request the fixture was cloned from.
    renderPage();
    await reviewForBatch("Juan Pérez");

    // Still on the queue-parked state for Juan; approve Sofia individually.
    await screen.findByRole("button", { name: /aprobar pago/i });
    completeChecklist();
    fireEvent.click(screen.getByRole("button", { name: /aprobar pago/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirmar$/i }));

    // The queue moves the moment the decision is made, but the request itself
    // waits out the undo window — this case cares that it eventually lands.
    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    await waitFor(() => expect(mockUpdatePaymentValidation).toHaveBeenCalledTimes(1));
    // The approval auto-advances back to Juan's detail; return to the queue.
    fireEvent.click(await screen.findByRole("link", { name: /volver a membresías y pagos/i }));

    // Juan is the only one left in the batch; the resolved payment left it.
    const bar = await screen.findByRole("group", { name: /aprobación por lote/i });
    expect(bar.textContent).toContain("1 de 1 pagos revisados seleccionados");
    expect(within(bar).getByRole("button", { name: /^aprobar 1 pago$/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// An unreviewed batch checkbox's accessible name must stay unique per row.
//
// The visible reason is one sentence shared above the whole list, pointed at
// by every unreviewed checkbox's `aria-labelledby`. With two unreviewed rows
// on screen, a screen reader that only heard the shared reason would
// announce two controls with the identical name and give the admin no way
// to tell them apart.
// ---------------------------------------------------------------------------

describe("PaymentsPage — unreviewed batch checkboxes keep distinct accessible names", () => {
  it("names each unreviewed checkbox after its own student, not just the shared reason", async () => {
    mockFetchPaymentValidations.mockResolvedValue([PENDING_REQUEST, SECOND_PENDING]);
    renderPage();
    await screen.findByTestId("payments-table");

    const juanName = accessibleNameFromLabelledby(batchCheckbox("Juan Pérez"));
    const sofiaName = accessibleNameFromLabelledby(batchCheckbox("Sofia Vera"));

    expect(juanName).toContain("Juan Pérez");
    expect(sofiaName).toContain("Sofia Vera");
    expect(juanName).not.toBe(sofiaName);
  });
});

// ---------------------------------------------------------------------------
// Mobile — the queue must not force the page sideways at 390px.
// ---------------------------------------------------------------------------

describe("PaymentsPage — 390px viewport", () => {
  it("lets the status filter chips wrap instead of forcing the page to scroll sideways", async () => {
    renderPage();

    const pendientes = await screen.findByRole("button", { name: /^pendientes/i });
    const filterRow = pendientes.parentElement as HTMLElement;

    expect(filterRow).toHaveClass("flex", "flex-wrap");
    expect(within(filterRow).getAllByRole("button").length).toBeGreaterThanOrEqual(4);
  });

  it("collapses the queue into cards below the table breakpoint", async () => {
    renderPage();
    await screen.findByTestId("payments-cards");

    const cards = screen.getByTestId("payments-cards");
    expect(cards.className).toContain("md:hidden");
    expect(within(cards).getByRole("button", { name: /revisar el pago de Juan Pérez/i })).toBeInTheDocument();
  });
});

describe("PaymentsPage — a decision stays reversible for a few seconds", () => {
  function renderWithToasts(): void {
    render(
      <ToastProvider>
        <PaymentsPage />
        <ToastContainer />
      </ToastProvider>,
    );
  }

  async function approveJuan(): Promise<void> {
    renderWithToasts();
    await openRequest("Juan Pérez");
    await screen.findByRole("button", { name: /aprobar pago/i });
    completeChecklist();
    fireEvent.click(screen.getByRole("button", { name: /aprobar pago/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirmar$/i }));
  }

  it("offers the undo on the confirmation itself", async () => {
    await approveJuan();

    const toast = await liveRegionSaying(/Pago aprobado/);
    expect(within(toast).getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
  });

  it("never sends the decision when the undo is taken", async () => {
    await approveJuan();

    const toast = await liveRegionSaying(/Pago aprobado/);
    fireEvent.click(within(toast).getByRole("button", { name: "Deshacer" }));

    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS * 2);
    });
    expect(mockUpdatePaymentValidation).not.toHaveBeenCalled();
  });

  it("puts the admin back in front of the payment they had just decided", async () => {
    await approveJuan();

    const toast = await liveRegionSaying(/Pago aprobado/);
    fireEvent.click(within(toast).getByRole("button", { name: "Deshacer" }));

    // Undo returns the whole situation, not just the row: the payment is
    // pending again AND the admin is looking at it, which is where they were
    // when they made the call they took back.
    expect(await screen.findByRole("button", { name: /aprobar pago/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /rechazar pago/i })).toBeInTheDocument();
  });

  it("sends the decision once the window closes", async () => {
    await approveJuan();

    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    expect(mockUpdatePaymentValidation).toHaveBeenCalledTimes(1);
  });

  it("returns the payment to the queue and says so when a held decision fails", async () => {
    mockUpdatePaymentValidation.mockRejectedValue(new Error("500"));
    await approveJuan();

    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    // No control is left to attach the failure to, so it has to travel to them.
    expect(await screen.findByText("No se pudo aprobar el pago.")).toBeInTheDocument();
    expect(
      screen.getByText("Juan Pérez volvió a la cola de pendientes."),
    ).toBeInTheDocument();
  });

  it("shows the backend's real reason instead of the generic toast, when it has one", async () => {
    // PAG-2: reproduced with a real rejection, where the backend refused a
    // 422 because the admin's own note passed 255 characters. `decide()`'s
    // `onError` used to hardcode `confirmation.failure` and throw the real
    // `err` away — the admin always saw "No se pudo aprobar/rechazar el
    // pago." and never learned what to fix. `err` has to go through
    // `toUserMessage()`, same as every other error site in the app.
    mockUpdatePaymentValidation.mockRejectedValue(
      Object.assign(new Error("La nota no puede superar los 255 caracteres."), { status: 422 }),
    );
    await approveJuan();

    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    expect(
      await screen.findByText("La nota no puede superar los 255 caracteres."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No se pudo aprobar el pago.")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The queue remembers where the admin works from.
//
// Whoever validates payments opens this screen on "Pendientes" every morning
// because that is the job. Making them re-pick it on every visit is a tax on
// the screen they use most, and it was the other half of the P7 backlog item
// that had not moved since the prototype.
// ---------------------------------------------------------------------------

describe("PaymentsPage — the hold is visible while it lasts", () => {
  async function approveJuanBare(): Promise<void> {
    renderPage();
    await openRequest("Juan Pérez");
    await screen.findByRole("button", { name: /aprobar pago/i });
    completeChecklist();
    fireEvent.click(screen.getByRole("button", { name: /aprobar pago/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirmar$/i }));
  }

  it("names what is being held, on the queue itself", async () => {
    await approveJuanBare();

    expect(
      await screen.findByText(/Aprobación de Juan Pérez — se envía en unos segundos/),
    ).toBeInTheDocument();
  });

  it("clears the indicator once the decision is actually sent", async () => {
    await approveJuanBare();
    await screen.findByText(/Aprobación de Juan Pérez/);

    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    await waitFor(() =>
      expect(screen.queryByText(/se envía en unos segundos/)).not.toBeInTheDocument(),
    );
  });

  it("offers a second way back that does not depend on the toast surviving", async () => {
    await approveJuanBare();
    const banner = await liveRegionSaying(/se envía en unos segundos/);

    fireEvent.click(within(banner).getByRole("button", { name: "Deshacer" }));

    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS * 2);
    });
    expect(mockUpdatePaymentValidation).not.toHaveBeenCalled();
  });

  it("says a rejection is a rejection, not an approval", async () => {
    renderPage();
    await openRequest("Juan Pérez");
    fireEvent.click(await screen.findByRole("button", { name: /rechazar pago/i }));
    fireEvent.click(screen.getByRole("radio", { name: /el monto no coincide/i }));
    fireEvent.click(screen.getByRole("button", { name: /rechazar y avisar/i }));

    expect(await screen.findByText(/Rechazo de Juan Pérez/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Approving a selection.
//
// "Trece pagos idénticos son trece decisiones con checklist" was the fifth
// thing blocking the target. The trap is that the obvious fix — a batch button
// that skips the checklist — throws away the change that moved P5 from 5 to 8.
// So the assertions are collapsed, not dropped, and the batch is gated behind
// them exactly as a single payment is.
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// La regla del rojo único
// ---------------------------------------------------------------------------

describe("PaymentsPage — el rojo es una acción, no una columna", () => {
  it("does not paint the row action red on the pending queue", async () => {
    // "Nunca hay dos botones rojos en una pantalla." The pending tab is the
    // default, so this drew one red button per pending row — ten down a single
    // column on a full page. At ten, red stops meaning "the one thing to
    // press" and becomes the colour of the column, which also leaves the real
    // decision ("Aprobar pago", in the detail) wearing the same red as every
    // link that leads to it.
    renderPage();
    await screen.findAllByText("Juan Pérez");

    for (const action of screen.getAllByRole("button", { name: /revisar el pago de/i })) {
      expect(action.className).not.toContain("bg-cata-red");
    }
  });

  it("keeps at most one red control in the queue at a time", async () => {
    renderPage();
    await screen.findAllByText("Juan Pérez");

    const red = screen
      .getAllByRole("button")
      .filter((node) => node.className.includes("bg-cata-red"));
    expect(red.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// D11c and the empty state's third part
// ---------------------------------------------------------------------------

describe("PaymentsPage — la ayuda y la salida", () => {
  it("discloses the queue's fetch ceiling in the block that filters", async () => {
    // The four pill counts read as club totals and are counts of what this
    // page fetched. `/members` already discloses the same cap in the same slot.
    renderPage();
    await screen.findAllByText("Juan Pérez");

    const toggle = screen.getByRole("button", { name: /alcance de la cola/i });
    const panel = screen.getByRole("region", { name: /filtros de pagos/i });
    expect(panel.contains(toggle)).toBe(true);
  });

  it("gives the truly-empty queue a way out instead of a dead end", async () => {
    // The `all` filter with no query was the one branch that shipped with no
    // action at all — the dead end the shared component's own doc warns about.
    mockFetchPaymentValidations.mockResolvedValue([]);
    renderPage();
    // The queue opens on "Pendientes"; the branch under test is the "Todas"
    // one, which is the only state that means "the club has no requests".
    fireEvent.click(await screen.findByRole("button", { name: /^Todas/ }));
    await screen.findByText(/aún no hay solicitudes/i);

    expect(screen.getByRole("link", { name: /ir a miembros/i })).toBeInTheDocument();
  });
});
