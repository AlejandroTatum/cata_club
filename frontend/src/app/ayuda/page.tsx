/**
 * `/ayuda` — the answers, browsable.
 *
 * The assistant could already answer all of this, but only if you thought of
 * the question first. That is the whole gap P10 was capped on: searching and
 * browsing answer different needs, and a family opening the app for the first
 * time cannot ask about something they do not yet know exists.
 *
 * Deliberately reachable WITHOUT a session. The two questions asked most often
 * — "when does my child train" and "how do I sign in" — are asked by people
 * who are, by definition, not signed in.
 */

"use client";

import Link from "next/link";
import { HelpCircle } from "lucide-react";
import AppShell from "@/components/shell/AppShell";
import BackLink from "@/components/BackLink";
import { Button } from "@/components/ui";
import { openHelpChat } from "@/components/chatbot/help-chat-store";
import { FAQ_SCHEDULES, FAQ_SECTIONS } from "./faq-content";

export default function AyudaPage(): React.ReactElement {
  return (
    <AppShell
      eyebrow="Ayuda"
      title="Preguntas frecuentes"
      subtitle="Cómo funciona la app del club, sección por sección."
    >
      <BackLink href="/" label="Volver al inicio" />

      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {/*
         * The schedule first, and as a table rather than prose. It is the most
         * asked question in the club and the only answer here that someone
         * needs to READ OFF rather than read — a parent checking whether they
         * make it from school by 16:00 is scanning a column, not a paragraph.
         */}
        <section
          aria-labelledby="horarios-heading"
          className="rounded-card border border-line bg-paper p-5 sm:p-6"
        >
          <h2 id="horarios-heading" className="mb-1 text-[15px] font-extrabold text-ink">
            Horarios de entrenamiento
          </h2>
          <p className="mb-4 text-[12.5px] text-ink-2">
            Días y horas fijos del club, por categoría.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="pb-2 pr-4 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3-strong">
                    Categoría
                  </th>
                  <th scope="col" className="pb-2 pr-4 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3-strong">
                    Para quién
                  </th>
                  <th scope="col" className="pb-2 pr-4 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3-strong">
                    Días
                  </th>
                  <th scope="col" className="pb-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3-strong">
                    Hora
                  </th>
                </tr>
              </thead>
              <tbody>
                {FAQ_SCHEDULES.map((schedule) => (
                  <tr key={schedule.category} className="border-b border-line last:border-b-0">
                    <th scope="row" className="py-2.5 pr-4 text-[13px] font-bold text-ink">
                      {schedule.category}
                    </th>
                    <td className="py-2.5 pr-4 text-[12.5px] text-ink-2">{schedule.ages}</td>
                    <td className="py-2.5 pr-4 text-[12.5px] text-ink-2">{schedule.days}</td>
                    <td className="py-2.5 text-[12.5px] font-semibold tabular-nums text-ink">
                      {schedule.hours}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {FAQ_SECTIONS.map((section) => {
          const headingId = `faq-${section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
          return (
            <section
              key={section.title}
              aria-labelledby={headingId}
              className="rounded-card border border-line bg-paper p-5 sm:p-6"
            >
              <h2 id={headingId} className="mb-4 text-[15px] font-extrabold text-ink">
                {section.title}
              </h2>
              <dl className="flex flex-col gap-4">
                {section.entries.map((entry) => (
                  <div key={entry.question}>
                    <dt className="text-[13px] font-bold text-ink">{entry.question}</dt>
                    <dd className="mt-1 text-[12.5px] leading-[1.55] text-ink-2">{entry.answer}</dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}

        {/*
         * The escape hatch, at the bottom rather than the top: someone who
         * scrolled this far did not find their answer, and that is exactly the
         * moment to offer a person.
         */}
        <section className="rounded-card border border-line-2 bg-sunken p-5 text-center sm:p-6">
          <HelpCircle size={20} strokeWidth={1.5} aria-hidden="true" className="mx-auto mb-2 text-ink-3" />
          <h2 className="text-[14px] font-extrabold text-ink">¿No encontró lo que buscaba?</h2>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-[1.5] text-ink-2">
            Pregúntele al asistente con sus propias palabras, o escríbale al club directamente.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Button variant="primary" onClick={() => openHelpChat()}>
              Preguntar al asistente
            </Button>
            <Link href="/" className="focus-ring rounded-ctl px-4 py-2 text-[13px] font-semibold text-ink underline underline-offset-2">
              Volver al inicio
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
