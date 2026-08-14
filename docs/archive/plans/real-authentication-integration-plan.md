# Real Authentication Integration Plan

This plan replaces the frontend's mock `localStorage` authentication with a secure JWT flow connected to the FastAPI backend. It covers login, automatic access-token refresh, logout, role mapping, protected routes, environment configuration, CORS, testing, and delivery across both repositories.

## Outcome

Users authenticate against the real backend, credentials remain inaccessible to browser JavaScript, sessions refresh safely after the 60-minute access-token lifetime, and each backend role reaches an appropriate frontend area.

## Repositories and branches

| Repository | Local path | Working branch |
|---|---|---|
| Frontend | `/home/alejandro/OpenCode/.projects/apps/cata-club-admin-frontend` | `feat/real-auth-bff` |
| Backend | `/home/alejandro/OpenCode/.projects/apps/product-admin-backend` | `feat/real-auth-bff` |

No commit or push is part of this plan until implementation, tests, and Full Assurance review pass.

## Decisions

| Topic | Decision |
|---|---|
| Browser session | Use a same-origin Next.js BFF instead of exposing backend JWTs to React. |
| Token storage | Store access and refresh tokens only in `HttpOnly` cookies. Never use `localStorage` or `sessionStorage`. |
| Authorization | Backend remains authoritative. Frontend role checks only control navigation and UX. |
| Refresh | Refresh access credentials server-side before expiry or once after an authenticated request returns `401`; prevent loops and concurrent refresh storms. |
| Logout | Clear cookies even when backend logout acknowledgement fails. Document that the current backend does not revoke issued JWTs. |
| CORS | Browser calls same-origin `/api/auth/*` routes. Next.js calls FastAPI server-to-server. Keep backend CORS explicitly configured for approved development origins. |
| Scope | Implement all backend roles: `ADMINISTRADOR`, `ENTRENADOR`, `TESORERO`, and `ALUMNO`. Do not invent a `REPRESENTANTE` backend role. |

## Verified starting point

### Backend

- FastAPI is exposed under `/api/v1` on port `8000`.
- `POST /auth/login` expects `application/x-www-form-urlencoded` fields named `username` and `password`.
- Login returns `access_token`, `refresh_token`, and `token_type`.
- Access tokens expire after 60 minutes; refresh tokens after seven days.
- `POST /auth/refresh` returns a new access token.
- `GET /auth/me` returns `correo`, `persona_id`, `nombres`, `apellidos`, and `roles`.
- `POST /auth/logout` acknowledges logout but does not revoke tokens.
- Security defect: the bearer decoder does not currently reject refresh tokens on protected endpoints.

### Frontend

- Authentication currently uses demo credentials and a forgeable `localStorage` session.
- Route protection is client-side only.
- The generic API client does not inject authorization or refresh credentials.
- Mock mode defaults to enabled.
- The enrollment cookie is unrelated and must remain isolated from authentication.

## Role mapping

| Backend role | Frontend role | Initial destination |
|---|---|---|
| `ADMINISTRADOR` | `admin` | `/dashboard` |
| `ENTRENADOR` | `trainer` | `/trainer` |
| `TESORERO` | `treasurer` | `/payments` |
| `ALUMNO` | `student` | `/student` |

If a user has multiple roles, routing precedence must be explicit and tested. Recommended precedence: administrator, treasurer, trainer, student.

`REPRESENTANTE` is a relationship, not a backend role. Representative access requires a separate backend relationship contract and is outside this authentication slice.

## Implementation phases

### Phase 1 — Repair the backend token boundary

1. Update the JWT bearer decoder to require `type = "access"`.
2. Return `401` when a refresh token is used on `/auth/me` or another protected endpoint.
3. Add behavior-focused regression tests.
4. Apply explicit response models to login and refresh responses where compatible.
5. Confirm the JWT secret validation remains fail-fast and no token is logged.

**Exit criteria**

- A valid access token reaches `/auth/me`.
- A valid refresh token used as bearer receives `401`.
- Existing authorization tests remain green.

### Phase 2 — Build the Next.js authentication BFF

Add same-origin route handlers for:

- `POST /api/auth/login`
- `GET /api/auth/session`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`

Server-only helpers will:

1. Call FastAPI using a server-only backend URL.
2. Encode login as form data with `username` and `password`.
3. Runtime-validate every backend response.
4. Set secure `HttpOnly` cookies.
5. Call `/auth/me` to build a browser-safe session without tokens.
6. Translate backend failures into controlled, user-readable errors.

**Cookie baseline**

- `HttpOnly: true`
- `SameSite: Lax`
- `Secure: true` in production
- Explicit `Path` and `Max-Age`
- Access and refresh cookies scoped as narrowly as the route design allows

### Phase 3 — Replace frontend mock authentication

1. Remove token and session persistence from `localStorage`.
2. Make login asynchronous and call the BFF.
3. Hydrate authentication state from `/api/auth/session` on application start.
4. Handle loading, invalid credentials, timeout, backend unavailable, and expired session states.
5. Make logout clear local state only after requesting server-side cookie deletion.
6. Preserve the mock enrollment flow independently.

### Phase 4 — Implement refresh behavior

1. Track access-token expiry server-side without exposing the token.
2. Refresh shortly before the 60-minute expiry when the session is actively used.
3. Allow one refresh-and-retry after an authenticated backend request returns `401`.
4. Prevent recursive retries and concurrent refresh storms.
5. Clear the session and return `401` when refresh expires or fails definitively.
6. Never retry unsafe state-changing requests unless their replay behavior is explicitly safe.

### Phase 5 — Map roles and protect views

1. Add explicit adapters for all four backend roles.
2. Define deterministic precedence for multi-role users.
3. Add coarse server-side or middleware redirects for protected sections.
4. Keep client guards for UX transitions, not as the security boundary.
5. Ensure backend requests still receive and enforce the authenticated identity.
6. Add a defined forbidden/unsupported state instead of silently redirecting forever.

### Phase 6 — Configure environment and CORS

Frontend environment template:

```dotenv
NEXT_PUBLIC_USE_MOCKS=false
BACKEND_API_URL=http://localhost:8000/api/v1
```

Rules:

- `BACKEND_API_URL` is server-only; do not prefix it with `NEXT_PUBLIC_`.
- Keep `NEXT_PUBLIC_API_URL` only for browser-accessible APIs that genuinely require it.
- Do not commit real secrets or local `.env` files.
- Validate required server variables at startup or first use with a controlled error.

Backend CORS:

- Allow `http://localhost:3000` explicitly in development.
- Do not use wildcard origins with credentials.
- Keep production origins environment-driven.
- Verify preflight requests if any browser-to-FastAPI calls remain.
- Prefer the same-origin BFF so authentication does not depend on cross-origin cookie behavior.

## Expected frontend change areas

- `src/services/auth.ts`
- `src/contexts/AuthContext.tsx`
- `src/app/login/page.tsx`
- `src/services/api.ts`
- `src/types/domain.ts`
- `src/lib/auth-utils.ts`
- `src/components/ProtectedRoute.tsx`
- `src/components/Header.tsx`
- `src/app/api/auth/**`
- `src/lib/server/auth.ts`
- `middleware.ts`
- `.env.local.example`
- Related unit, integration, and E2E tests

## Expected backend change areas

- `app/seguridad/gestor_auth.py`
- `app/presentacion/routers/auth_router.py`
- `app/presentacion/schemas/auth_schemas.py`
- Authentication and authorization tests
- CORS/environment documentation if the current configuration is incomplete

## Test plan

### Backend

- Login accepts valid form credentials and rejects invalid credentials.
- Access tokens authenticate `/auth/me`.
- Refresh tokens cannot authenticate protected endpoints.
- Refresh produces a usable access token.
- Expired and malformed tokens receive `401`.
- Role-restricted endpoints preserve `401` versus `403` behavior.

### Frontend

- Login uses form encoding and never returns tokens to browser JavaScript.
- Cookies have the required security attributes.
- Session hydration adapts `/auth/me` correctly.
- Each backend role maps to the expected frontend role and destination.
- Multi-role precedence is deterministic.
- Refresh occurs once and retries only the permitted request.
- Refresh failure clears the session.
- Logout clears cookies even when FastAPI is unavailable.
- Protected routes redirect unauthenticated users.
- Invalid credentials, timeout, and unavailable-backend messages are readable.
- No authentication data is written to `localStorage` or logs.

### Verification commands

Use the repositories' existing commands after inspecting their package/project configuration. At minimum:

- Backend focused authentication tests, then full backend test suite.
- Frontend focused auth tests, TypeScript check, lint, unit tests, and relevant Playwright flow.
- Manual local smoke test with frontend on `3000` and backend on `8000`.

## Acceptance checklist

- [ ] `NEXT_PUBLIC_USE_MOCKS=false` is documented for real integration.
- [ ] No auth token or trusted role is stored in browser storage.
- [ ] Login uses the real FastAPI endpoint.
- [ ] Access-token refresh works across the 60-minute boundary.
- [ ] Logout reliably clears browser credentials.
- [ ] Refresh tokens are rejected as bearer credentials.
- [ ] All four backend roles map to frontend views.
- [ ] Multi-role behavior is defined and tested.
- [ ] Protected routes have a server-side/coarse guard.
- [ ] Backend remains the authorization authority.
- [ ] Development CORS permits only the intended frontend origin.
- [ ] Environment templates contain no secrets.
- [ ] Relevant tests pass in both repositories.
- [ ] Native Full Assurance review and lifecycle validation pass before commit, push, or PR.

## Delivery sequence

1. Implement and test the backend token-boundary correction.
2. Implement and test the frontend BFF and secure cookies.
3. Replace mock authentication and add refresh behavior.
4. Add complete role mapping and protected navigation.
5. Validate environment and local `3000`/`8000` integration.
6. Stabilize both test suites.
7. Freeze the final candidates and run Full Assurance review.
8. Commit and publish each repository only after its receipt passes the required lifecycle gate.

## Residual risks and follow-up work

- Backend logout currently does not revoke issued JWTs. Production-grade logout should add refresh-token rotation or revocation.
- Seven-day refresh-token lifetime needs explicit product approval.
- Representative access needs a backend relationship contract separate from role mapping.
- Password recovery and registration are not part of this delivery.
- Production deployment must define HTTPS, trusted origins, cookie domain, and secret rotation.

## Next step

Review this plan, then implement Phase 1 and Phase 2 as the first reviewable work unit before expanding role-based navigation.
