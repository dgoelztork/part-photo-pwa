# Part Receiving PWA — Implementation Plan

## Phase Breakdown

This revamp is best done in 4 phases. Each phase delivers a usable increment so you can test with real receiving workflows early and iterate.

---

## Phase 1: Foundation & Camera Flow (Weeks 1-2)

**Goal:** Replace the current vanilla TS app with React + Vite. Implement the 5-step wizard shell with camera capture at each step. No SAP integration yet — just the photo workflow.

### Tasks

**1.1 Project Setup**
- Initialize React + TypeScript in the existing Vite project
- Add Tailwind CSS
- Add React Router v6 (hash-based routing for PWA compatibility)
- Add Zustand for state management
- Configure PWA manifest (update existing vite-plugin-pwa config)
- Keep MSAL auth (Azure AD) — port to React component

**1.2 Shared Components**
- `CameraCapture` — reusable camera component with viewfinder, shutter, flash toggle
  - Uses `getUserMedia` for live preview
  - Falls back to `<input type="file" capture="environment">` on iOS if needed
  - Returns captured photo as Blob
- `PhotoGallery` — thumbnail strip with tap-to-preview and delete
- `StepHeader` — progress indicator showing current step (1-5)
- `StepNavigation` — Back / Next buttons with validation state

**1.3 Wizard Flow**
- `ReceivingWizard` — parent component managing step state
- Step 1: `BoxPhotoStep` — camera + damage toggle + notes
- Step 2: `ShippingLabelStep` — camera + manual fields (carrier, tracking)
- Step 3: `PackingSlipStep` — camera + manual PO entry (no OCR or SAP yet)
- Step 4: `DocumentsStep` — camera + document type tagging + skip option
- Step 5: `LineReceivingStep` — placeholder with mock PO line data
- Review screen with session summary

**1.4 Session Persistence**
- Zustand store with IndexedDB persistence (via `zustand/middleware`)
- Session created on "Start New Receiving" tap
- Session state survives app close / PWA restart
- Dashboard lists sessions from IndexedDB

### Deliverable
Working PWA where a receiver can walk through all 5 steps taking photos, with sessions saved locally. Submit button is a no-op (shows "SAP integration coming in Phase 2").

---

## Phase 2: Proxy Server & SAP Integration (Weeks 3-4)

**Goal:** Build the Node.js proxy. Connect Step 3 (PO lookup) and Step 5 (line receiving) to live SAP data. Post GRPO on submit.

### Tasks

**2.1 Proxy Server**
- Node.js + Express (or Hono) project
- SAP SL session manager (login, session pool, re-auth)
- Azure AD token validation middleware
- JWT issuance for proxy auth
- CORS configuration for PWA origin
- Endpoints:
  - `POST /api/auth/login`
  - `GET /api/po/:poNumber`
  - `GET /api/po/:poNumber/lines`
  - `POST /api/grpo`
  - `POST /api/attachments`
  - `PATCH /api/grpo/:docEntry/attach`
- Error handling and SL error translation
- Logging (structured JSON logs)

**2.2 PWA ↔ Proxy Integration**
- API client service in the PWA
- Auth flow: Azure AD token → proxy login → JWT stored in memory
- Step 3: PO lookup after OCR/manual entry
  - Loading state, error handling, PO display
- Step 5: Populate line items from SAP PO data
  - Show open quantities (ordered - already received)
  - Line-by-line receiving UI with real data

**2.3 GRPO Posting**
- Build GRPO payload from session state
- Validate quantities (cannot exceed open qty)
- Submit via proxy → SL
- Handle success (show doc number) and failure (show error, allow retry)
- Mark session as submitted

**2.4 Proxy Deployment**
- Dockerfile for the proxy
- docker-compose with env vars for SL credentials
- Deployment to internal server (same network as SAP)
- HTTPS with internal CA cert (or mkcert for dev)

### Deliverable
End-to-end receiving flow: photo documentation → PO lookup → line receiving → GRPO posted in SAP. No file uploads yet (photos stay local).

---

## Phase 3: OCR & File Uploads (Weeks 5-6)

**Goal:** Add OCR for packing slips, upload all photos to OneDrive and SAP attachments.

### Tasks

**3.1 Packing Slip OCR (Step 3)**
- Integrate Tesseract.js for client-side PO number extraction
  - Web worker setup (avoid blocking UI)
  - Regex patterns for common PO number formats
  - Confidence scoring — auto-fill if high confidence, prompt if low
- Manual entry always available as fallback
- Future hook: Azure AI Document Intelligence for full extraction (add API client in proxy, feature-flag it off initially)

**3.2 Shipping Label OCR (Step 2) — Optional**
- Basic text extraction for carrier name and tracking number
- Lower priority — manual entry is fine for launch

**3.3 OneDrive Upload**
- Port existing Graph API upload logic to new React architecture
- Organize photos into folder structure per session:
  ```
  /Receiving/{date}/PO-{number}/{step-folder}/{filename}
  ```
- Large file upload (chunked) for high-res photos
- Progress tracking per file
- Retry logic for failed uploads

**3.4 SAP Attachment Upload**
- Proxy receives photos from PWA (multipart upload)
- Saves to SL-accessible temp directory
- Creates Attachments2 entry with all files
- Links to GRPO document
- Cleanup temp files after successful attachment

**3.5 Submission Flow Update**
- Submit button now: posts GRPO → uploads to OneDrive → attaches to SAP
- Progress indicator for each phase
- Partial failure handling (GRPO posted but uploads failed → show status)

### Deliverable
Full workflow with OCR-assisted PO lookup and all documentation uploaded to both OneDrive and SAP.

---

## Phase 4: Polish & Production Readiness (Weeks 7-8)

**Goal:** Harden the app for daily production use. Add user tracking, error recovery, and operational features.

### Tasks

**4.1 User Tracking & Audit**
- Log receiving user (Azure AD identity) on every session
- UDF fields on GRPO for receiver email, session ID, OneDrive path
- Session history with search/filter on dashboard

**4.2 Error Recovery**
- Retry failed uploads from session detail view
- "Resume" a session that was interrupted
- Handle SL downtime gracefully (queue GRPO post, alert user)

**4.3 Exception Handling in Receiving**
- Damaged item workflow: require photos, add notes, flag on GRPO
- Wrong item: capture what was received, flag for purchasing
- Short ship: record received vs expected, note discrepancy
- Over-ship: allow receiving over PO qty? (Business decision — may need to disallow)

**4.4 Notifications**
- Push notification when a GRPO posts successfully (if app is backgrounded)
- Email summary of receiving session (optional, via proxy)

**4.5 Settings & Admin**
- Configurable proxy URL
- OneDrive path configuration
- Camera preferences (resolution, flash default)
- Admin: view all receiving sessions across users (if needed)

**4.6 Testing**
- Test with real iPhone on company WiFi
- Test with multiple concurrent users
- Test partial receiving scenarios
- Test large shipments (20+ line items)
- Test poor lighting / blurry photo scenarios for OCR
- Test session recovery after app crash / network loss

### Deliverable
Production-ready app deployed to internal hosting, tested with real receiving workflows.

---

## Project Structure

```
part-photo-pwa/
├── docs/                          # These planning docs
├── proxy/                         # Node.js proxy server
│   ├── src/
│   │   ├── index.ts               # Express app entry
│   │   ├── middleware/
│   │   │   ├── auth.ts            # Azure AD token validation + JWT
│   │   │   └── cors.ts
│   │   ├── services/
│   │   │   ├── sl-session.ts      # SL session pool manager
│   │   │   ├── sl-client.ts       # SL API wrapper
│   │   │   └── attachment.ts      # File handling for SL attachments
│   │   └── routes/
│   │       ├── auth.ts
│   │       ├── purchase-orders.ts
│   │       ├── grpo.ts
│   │       └── attachments.ts
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── package.json
│   └── tsconfig.json
│
├── src/                           # React PWA (revamped)
│   ├── main.tsx                   # React entry point
│   ├── App.tsx                    # Router + auth provider
│   ├── config.ts                  # MSAL + proxy config
│   ├── components/
│   │   ├── camera/
│   │   │   ├── CameraCapture.tsx
│   │   │   ├── PhotoGallery.tsx
│   │   │   └── PhotoPreview.tsx
│   │   ├── layout/
│   │   │   ├── StepHeader.tsx
│   │   │   ├── StepNavigation.tsx
│   │   │   └── AppShell.tsx
│   │   └── ui/
│   │       ├── Button.tsx
│   │       ├── Input.tsx
│   │       ├── Card.tsx
│   │       └── Badge.tsx
│   ├── screens/
│   │   ├── Dashboard.tsx
│   │   ├── Login.tsx
│   │   └── receiving/
│   │       ├── ReceivingWizard.tsx
│   │       ├── BoxPhotoStep.tsx
│   │       ├── ShippingLabelStep.tsx
│   │       ├── PackingSlipStep.tsx
│   │       ├── DocumentsStep.tsx
│   │       ├── LineReceivingStep.tsx
│   │       ├── LineDetailView.tsx
│   │       └── ReviewSubmit.tsx
│   ├── stores/
│   │   ├── session-store.ts       # Zustand: receiving session state
│   │   ├── auth-store.ts          # Zustand: auth tokens
│   │   └── settings-store.ts      # Zustand: app settings
│   ├── services/
│   │   ├── api-client.ts          # Proxy HTTP client
│   │   ├── graph-client.ts        # OneDrive uploads (ported)
│   │   ├── ocr-service.ts         # Tesseract.js wrapper
│   │   └── photo-service.ts       # Capture, thumbnail, naming
│   ├── types/
│   │   ├── session.ts
│   │   ├── sap.ts
│   │   └── photo.ts
│   └── utils/
│       ├── format.ts
│       └── validation.ts
│
├── public/                        # PWA assets (existing)
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

## Resolved Decisions

| # | Question | Decision |
|---|---|---|
| 1 | **Over-receiving** | **Not allowed.** SAP blocks it. Hard-validate: `receivedQty <= openQty`. No override. |
| 2 | **Multiple POs per shipment** | **One PO per session.** Multiple POs = multiple sessions. Revisit in v2 if needed. |
| 3 | **Bin/location tracking** | **Not included.** No bin locations currently. Warehouse code comes from the PO line. |
| 4 | **OCR approach** | **Tesseract.js + manual entry.** No Azure AI for now. Architecture supports adding it later. |
| 5 | **Proxy hosting** | **Docker container.** See `docs/05-docker-primer.md` for setup guide. |
| 6 | **Photo resolution** | **Dual mode.** Steps 1-4 (documentation): compress to 80% JPEG. Step 5 (products): capture full-res originals — some may be used for marketing. User can toggle "high-res" per photo or per line item. |
| 7 | **SL User** | **Dedicated API user** (`api_receiving`). Use existing user for initial testing, then create dedicated user for production with GRPO-only permissions. |
| 8 | **UDFs** | **Use the fields from doc 03.** Some already exist; create the missing ones before Phase 2. |

## Dependencies & Prerequisites

Before development starts, these need to be in place:

- [ ] SAP B1 Service Layer accessible and tested (can login via Postman)
- [ ] Dedicated SL API user created with appropriate permissions
- [ ] Internal server identified for proxy hosting (Docker-capable)
- [ ] Azure AD app registration updated if scopes change
- [ ] UDFs created in SAP B1 (if using custom fields)
- [ ] Test PO(s) available in SAP for development
- [ ] iPhone(s) on company WiFi confirmed to reach proxy server
- [ ] OneDrive folder structure agreed upon
