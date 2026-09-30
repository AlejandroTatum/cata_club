# uv3-student — student/representative usability redesign

Branch `feat/uv3-student` (from `feat/usability-v3`). Local only, not pushed.

| Task | Commit | Subject |
| --- | --- | --- |
| T1 | 4310293 | use dashboard content width on student medical record and add-dependent |
| T2 | 814af80 | split student payments page into sibling components |
| T2 | 9afdb2d | redesign student payments into a main + rail layout with proof preview and actionable history |
| T3 | 9a43a1c | compose medical record with a live emergency card rail |
| T3 | c0c0b23 | compact empty emergency card lines into one row each |
| T4 | 8cd7f90 | redesign profile with hero stats, coverage meter and action tiles |
| T4 | f4261a4 | use rhythm gap tokens on profile hero |

Evidence: `pnpm type-check`, `pnpm lint` clean; `pnpm test` 5443 tests green
after the gap-token fix; role-pages checker PASS on :3011; screenshots in
`~/.cache/ui-compare/uv3/student/`.
