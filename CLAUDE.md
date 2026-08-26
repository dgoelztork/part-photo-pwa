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

1. `BOX` — carrier pick, shipment box count, per-box label captures. Each label populates its own `ShippingBox` entry (tracking, weight, origin ZIP) via barcode + OCR running **in the background** (the receiver can keep capturing while extraction is in flight; per-box `extracting` flag drives the spinner). Each box card has a "damaged" checkbox; only when checked does the receiver get a damage-photo prompt + notes textarea. `boxes.length` must reach `shipmentBoxCount` before Next; a "this box had no label" escape hatch creates a no-label box. There are no longer session-level outer-box photos.
2. `PACKING_SLIP` — capture packing slip (or check "None included") and look up the PO number. After lookup, surfaces the PO header notes (`U_pImportantInfo`, `U_pInternalComments`, `U_exponotes`) read-only.
3. `SHIPPING_DETAILS` — shipment-wide PO defaults (`TrnspCode`, `U_ShipSpeed`, `U_pFOB`, `U_pFrtChargeType`, ship-to-zip) + a card per `ShippingBox` for editing tracking, weight, origin ZIP. Each box gets its own UPS list rate. Total freight summed at bottom.
4. `DOCUMENTS` — MTRs, CoCs, etc., or check "No documents."
5. `LINES` — per-line receive: three photo groups (item, nameplate, full-quantity) + qty + condition + notes. Only item photos are required to confirm a line; nameplate and quantity photos are optional. Surfaces `POR1.FreeTxt` from the PO line.
6. `REVIEW` → `SUBMITTED` — posts the GRPO (per-box tracking concat into `U_pFrtTracking`, per-box freight summed into `U_InboundFrt`). Status flips to SUBMITTED and the success card renders **immediately** after the SAP post; the SharePoint upload + subsequent `U_GRPODocs` PATCH run as a background async block. Receiver can tap Done and return to the dashboard while photos finish uploading.

`STEP_ORDER` in `src/types/session.ts` drives the progress bar in `StepHeader`.

## SAP integration
- **SL endpoint name `PurchaseDeliveryNotes` = Goods Receipt PO** (object 20, OPDN/PDN1). Not the customer-facing `DeliveryNotes`.
- PO lookup: `GET /api/po/:poNumber` → SL `/PurchaseOrders` filtered by `DocNum`.
- GRPO post: `POST /api/grpo` → SL `/PurchaseDeliveryNotes`. Lines reference the PO via `BaseType=22 / BaseEntry / BaseLine`, so SAP fills item/price/UoM from the PO.
- Catch-all dump field: anything the wizard captures that doesn't have a dedicated SAP destination today is concatenated into `OPDN.U_GRPOdetails` (built by `buildGrpoDetails` in `ReviewSubmit.tsx`). The proxy appends `[Received via PWA by <email>]` so we always have receiver attribution in SAP.
- The proxy intentionally does **not** set `OPDN.Comments` — SAP auto-populates it with `"Based on Purchase Orders <DocNum>"` when the GRPO references a PO via `BaseType=22 / BaseEntry`. Overwriting that breaks the Related Documents breadcrumb. If a caller passes `comments` explicitly, that wins; otherwise let SAP fill the standard remark.
- After GRPO posts and the SharePoint upload completes, the proxy `PATCH /api/grpo/:docEntry` writes the SharePoint folder webUrl to `OPDN.U_GRPODocs` so SAP users can click through to the photo evidence. Best-effort — failure logs a warning but does not undo the GRPO/upload.
- Per-line **item** and **nameplate** photos are saved a **second** time to `WEB_IMAGES_SHAREPOINT_PATH` (flat folder, named by part number — e.g. `M106412.jpg` for product, `M106412_nameplate.jpg` for nameplate) for AI/marketing/web reuse. Built into `buildUploadPlan` as additional entries with `conflictBehavior: "rename"` so older shots aren't clobbered. Quantity, box, label, packing-slip, and document photos are NOT duplicated to web images. Filename suffixes in the receiving folder distinguish the groups: `_LINE_NNN_<itemcode>_<ts>.jpg` (item), `_NAMEPLATE_<ts>.jpg`, `_QTY_<ts>.jpg`.

## Picklist
- After a GRPO posts, the success card offers **Print Picklist**. Tork raises vendor POs against a customer sales order and stamps the SO number on the PO header (`OPOR.U_pSONumber`, a string holding the SO `DocNum`), so most of what the warehouse receives is already committed to an order.
- `GET /api/picklist/:poNumber` (`proxy/src/routes/picklist.ts`) resolves PO → `U_pSONumber` → SO header + lines, then attaches **live** on-hand per item.
- One SO is commonly fed by **several** vendor POs, so the sheet covers the whole SO, not just this PO's lines. Each SO line's `POTargetNum` (the PO DocNum it was ordered on) drives the `fromThisPo` flag that highlights what this receipt filled.
- Stock is read live from `/Items` → `ItemWarehouseInfoCollection.InStock`, **not** from the SO line's stored `U_01Stock` / `U_TotalAvailable` UDFs — those are stamped at line entry and go stale (observed `U_TotalAvailable="0.00"` on an item with 2 on hand).
- Stock lookup is best-effort and chunked 15 items per SL call; a failed chunk leaves `onHandTotal: null` (rendered `?`) rather than sinking the whole sheet.
- POs with no SO linked (stock replenishment) return `404 NO_SO_LINKED`, which the UI shows as a plain "nothing to pick" message rather than an error.
- Printing: `PicklistView` portals to `<body>` and `@media print` in `app.css` hides `#root`, so the sheet flows across pages instead of being clipped to the overlay's scroll box.

## Freight rating
- `POST /api/freight/ups-rate` rates one box against UPS. The service code comes from the shipment's Shipping Speed field via `shippingSpeedToServiceCode` (`proxy/src/services/ups-rating.ts`).
- That field holds **either** a Tork SAP code from `OPOR.U_ShipSpeed` (`GROUND`, `1DAY`, `2DAY` — the only values in the last 400 POs) **or** the free-text service level read off the shipping label. The mapper handles both: exact SAP-code table first (case/space/dash-insensitive), then phrase heuristics.
- Add new SAP codes to `SAP_SPEED_CODES`, not to the phrase rules. `1DAY` matched no phrase and fell through an old `return "03"` Ground default, so every next-day receipt was priced as Ground — one real 58 lb shipment quoted $149.59 instead of $469.10. `2DAY` only ever worked by accident ("2day" contains "2" and "day"). Reported by GGarcia 2026-07-30, who had been correcting it by hand.
- **Never default an unknown speed to a service code.** Ground is the cheapest UPS service, so a guess becomes a too-low `OPDN.U_InboundFrt` that looks authoritative. Unrecognised or missing speed → mapper returns `null` → route returns `422 SPEED_NOT_RECOGNIZED` / `SPEED_MISSING` → the PWA shows an amber "enter the freight manually" hint (not a red error, since there's nothing to retry).
- The label's service level is applied to `shippingDetails.shipSpeed` in `BoxPhotoStep.runExtraction`. The BOX step runs before the PO lookup and `applyPoLookup` only fills blanks, so the label (how it actually shipped) beats the PO header (what was ordered) without clobbering receiver edits.

## Item label printing
- Standalone feature (Dylan's request, Aug 2026), reached from its own Dashboard button — **not** part of the receiving wizard. Flow: search a sales order → pick the part → enter how many labels (defaults to the SO line quantity) → send to the Zebra at that site.
- `GET /api/labels/sales-order/:soNumber` returns every line, closed ones included: labels get reprinted for stock that already shipped.
- `POST /api/labels/print` builds ZPL and streams it to the printer; `POST /api/labels/preview` returns the same ZPL without printing, which is how to check the layout with no printer present.
- **The ZPL layout in `proxy/src/services/zpl.ts` is PROVISIONAL.** It assumes 4"x2" at 203 dpi and guesses the fields. Dylan is supplying a sample of Tork's existing item label; replacing `buildItemLabel` is the whole job of matching it. Everything else is layout-agnostic. Do not run production stock through it until it's been matched and test-printed.
- Printers come from the `LABEL_PRINTERS` env var (JSON array of `{id,name,host,port,warehouses}`). Warehouse codes route a line to its site: Alameda is `01`/`01A`/`2`/`S`/`02`, **Pascagoula is `3`** ("Mississippi Warehouse" in SAP).
- There is deliberately **no fallback to "the first printer"** when no printer claims a warehouse — a mis-routed label prints 2,000 miles from whoever asked for it. The route 422s and the UI offers a manual picker instead.
- The Dashboard button is hidden while `LABEL_PRINTERS` is empty, so the feature stays invisible until a site is actually wired up.
- Raw port 9100 is fire-and-forget: a successful write means the printer accepted the bytes, **not** that a label came out. Out of media, head open and ribbon faults are all invisible to us — the UI says "sent", never "printed".
- `escapeZpl` strips `^` and `~` from field data. SAP descriptions are free text, and an embedded `^XZ` would silently truncate the label.
- **Open blocker — Pascagoula has no network path.** TORK-APP has only `192.168.201.0/24` plus Tailscale, and no route to any other private subnet. An Alameda printer is directly reachable; a Pascagoula one is not. It needs a Tailscale subnet router at the site (or the printer on the tailnet) before warehouse `3` can print. `host` is just an address, so nothing in the code changes once a path exists.

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
      ReviewSubmit.tsx           # builds U_GRPOdetails, posts GRPO, then PATCHes U_GRPODocs
      PicklistView.tsx           # post-receipt pick sheet for the linked SO (print overlay)
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
      picklist.ts                # PO → U_pSONumber → SO lines + live stock
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
