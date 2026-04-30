# receiving-proxy

A two-part app for warehouse part receiving:

- **Frontend PWA** — installable iOS-first React app at the repo root (`src/`). Walks a receiver through a multi-step wizard, captures photos, and posts a Goods Receipt PO to SAP.
- **Backend proxy** — Express server in `proxy/` that fronts the SAP B1 Service Layer (auth, GRPO post, PO lookup, vision-OCR helpers) and uploads evidence to SharePoint via Microsoft Graph.

## Stack
- React 19 + TypeScript + Vite 7
- Tailwind v4 (`@tailwindcss/vite`)
- Zustand for state, persisted to IndexedDB via `idb-keyval`
- React Router (`HashRouter`)
- `@azure/msal-browser` for Azure AD login
- `vite-plugin-pwa` (Workbox) + `vite-plugin-mkcert` for local HTTPS dev
- Backend: Express + `jsonwebtoken`, talks to SAP B1 Service Layer over `slFetch`

## Wizard flow
The receiver walks through these steps in order (status values on `ReceivingSession.status`):

1. `BOX` — box photos (with optional damage flag/notes) and shipping label photos. Label OCR auto-fills shipping detail defaults.
2. `CARRIER` — pick UPS / FedEx / LTL / Other.
3. `PACKING_SLIP` — capture packing slip (or check "None included") and look up the PO number. After lookup, surfaces the PO header notes (`U_pImportantInfo`, `U_pInternalComments`, `U_exponotes`) read-only.
4. `SHIPPING_DETAILS` — verify/edit the OPOR shipping fields (`TrnspCode`, `U_ShipSpeed`, `U_pFOB`, `U_pFrtChargeType`, `U_pFrtTracking`).
5. `DOCUMENTS` — MTRs, CoCs, etc., or check "No documents."
6. `LINES` — per-line receive: photo + qty + condition + notes. Surfaces `POR1.FreeTxt` from the PO line.
7. `REVIEW` → `SUBMITTED` — posts the GRPO and uploads photos to SharePoint.

`STEP_ORDER` in `src/types/session.ts` drives the progress bar in `StepHeader`.

## SAP integration
- **SL endpoint name `PurchaseDeliveryNotes` = Goods Receipt PO** (object 20, OPDN/PDN1). Not the customer-facing `DeliveryNotes`.
- PO lookup: `GET /api/po/:poNumber` → SL `/PurchaseOrders` filtered by `DocNum`.
- GRPO post: `POST /api/grpo` → SL `/PurchaseDeliveryNotes`. Lines reference the PO via `BaseType=22 / BaseEntry / BaseLine`, so SAP fills item/price/UoM from the PO.
- Catch-all dump field: anything the wizard captures that doesn't have a dedicated SAP destination today is concatenated into `OPDN.U_GoodsReturnComment` (built by `buildGoodsReturnComment` in `ReviewSubmit.tsx`).

## Auth
- User signs in with Azure AD via MSAL (`src/lib/auth.ts`, `src/screens/Login.tsx`).
- The Azure access token is exchanged for a proxy-issued JWT at `POST /api/auth/login` (`api-client.ts → authenticate()`); the JWT is held in memory and re-fetched on 401.

## Proxy URL
Configurable; default `https://tork-app.tail14e57a.ts.net:3001` (set in `src/services/api-client.ts`). Override with `localStorage["proxy-url"]`.

## Layout
```
src/
  App.tsx, main.tsx
  screens/
    Login.tsx, Dashboard.tsx
    receiving/
      ReceivingWizard.tsx        # routes by session.status
      BoxPhotoStep.tsx           # box + label photos
      CarrierStep.tsx
      PackingSlipStep.tsx        # photos + PO lookup + header notes
      ShippingDetailsStep.tsx
      DocumentsStep.tsx
      LineReceivingStep.tsx
      ReviewSubmit.tsx           # builds U_GoodsReturnComment, posts GRPO
  stores/
    auth-store.ts, session-store.ts
  services/
    api-client.ts                # all proxy calls
    photo-service.ts
  lib/
    auth.ts                      # MSAL
    file-exporter.ts             # SharePoint upload of session photos
    graph-client.ts              # Microsoft Graph
    ocr-reader.ts                # Tesseract.js for PO-number OCR
  types/session.ts               # SessionStatus, ReceivingSession, etc.
  components/
    camera/  (CameraCapture, PhotoGallery)
    layout/  (StepHeader, StepNavigation)

proxy/
  src/
    server.ts (entry)
    routes/
      auth.ts                    # Azure → proxy JWT
      purchase-orders.ts         # PO lookup
      grpo.ts                    # GRPO post + read
    services/
      sl-session.ts              # SAP B1 Service Layer session + slFetch
```

## Deploy
- The frontend deploys to GitHub Pages at **https://dgoelztork.github.io/part-photo-pwa/** via [.github/workflows/deploy.yml](.github/workflows/deploy.yml). Any push to `main` triggers the workflow (build with `GITHUB_PAGES=true` so vite uses the `/part-photo-pwa/` base, then `actions/deploy-pages`). Deploy takes ~1–2 min after push.
- The user's standing instruction is **commit and push without asking** at the end of a task. Don't gate on confirmation. Apply normal hygiene (accurate message, never stage secrets/certs, never `--no-verify`, never force-push to main).
- The backend proxy is not deployed by this workflow — it runs separately on the user's tailnet (`tork-app.tail14e57a.ts.net:3001`).

## Dev commands
```sh
# Frontend (root)
npm run dev          # vite, https on :5173 via mkcert
npm run build        # tsc + vite build
VITE_NO_MKCERT=1 npm run dev   # plain HTTP — pair with `tailscale serve` to get HTTPS for iOS

# Backend
cd proxy && npm run dev
```

### Testing on iPhone
mkcert needs admin on Windows to install its root CA. If that fails, run vite plain-HTTP and front it with Tailscale:
```sh
VITE_NO_MKCERT=1 npx vite
tailscale serve --bg --https=443 http://localhost:5173
# → https://<your-tailnet-name>.ts.net/
```

## Conventions
- The PWA persists session state to IndexedDB. Photos can't survive a serialize/deserialize cycle (blob → empty Blob in `stripBlob`), so resumed sessions show empty galleries — this is intentional.
- Zustand actions live alongside state; never mutate state directly outside the store.
- Use the typed `ReceivingSession` shape in `src/types/session.ts` as the source of truth — backend returns are mapped to it in `api-client.ts` and `session-store.ts:applyPoLookup`.
- All proxy calls go through `proxyFetch` in `api-client.ts` (handles auth + 401 retry). Don't `fetch` the proxy directly.
