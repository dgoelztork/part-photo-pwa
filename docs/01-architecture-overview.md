# Part Receiving PWA — Architecture Overview

## Project Summary

Revamp the existing Part Photo PWA into a full **documented receiving workflow** for SAP Business One. The app guides warehouse receivers through a 5-step process: photographing the shipment box, shipping label, packing slips (OCR), material test reports (OCR), and individual products — then posts a Goods Receipt PO to SAP with all documentation attached.

## Current State vs. Target State

| Aspect | Current | Target |
|---|---|---|
| Purpose | Capture & upload part photos | Full receiving workflow with SAP posting |
| SAP Integration | None | Service Layer (B1) — PO lookup, GRPO posting, attachments |
| OCR | Part number scan (M-number) | Full packing slip extraction + document capture |
| Workflow | Linear: scan → photo → upload | 5-step wizard with branching and validation |
| Data Flow | One-way (photos → OneDrive) | Bidirectional (SAP ↔ app ↔ OneDrive) |
| Auth | Azure AD only | Azure AD + SAP B1 session (via proxy) |
| Users | Single user assumed | 4-10 receivers, user-level tracking |

## High-Level Architecture

```
┌─────────────────────────────────────────────────┐
│                 iPhone PWA (Vite + React)        │
│                                                   │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌────┐ │
│  │ Step1 │→│ Step2 │→│ Step3 │→│ Step4 │→│ S5 │ │
│  │ Box   │ │ Label │ │Packing│ │ MTR/  │ │Line│ │
│  │ Photo │ │ Photo │ │ Slip  │ │ Docs  │ │Recv│ │
│  └───────┘ └───────┘ └───┬───┘ └───────┘ └──┬─┘ │
│                           │                   │   │
│                     OCR Engine          PO Lines  │
│                     (Tesseract /        from SAP  │
│                      Azure AI)                    │
└────────────────┬──────────────────────┬───────────┘
                 │ HTTPS                │ HTTPS
                 ▼                      ▼
┌────────────────────────┐  ┌───────────────────────┐
│     Proxy / API        │  │   Microsoft Graph     │
│     (Node.js)          │  │   (OneDrive)          │
│                        │  └───────────────────────┘
│  - SL session mgmt     │
│  - CORS handling        │
│  - Auth relay           │
│  - Request validation   │
└───────────┬─────────────┘
            │ Internal network
            ▼
┌───────────────────────┐
│  SAP B1 Service Layer │
│                       │
│  - PurchaseOrders     │
│  - PurchaseDelivery   │
│    Notes (GRPO)       │
│  - Attachments2       │
└───────────────────────┘
```

## Tech Stack Recommendation

### Frontend: React + TypeScript + Vite

**Why React over vanilla TS for this revamp:**

- **Multi-step wizard with complex state** — The 5-step flow with branching (step 3 determines step 5 content), partial line receiving, and photo collections per step needs real state management. Vanilla TS with manual DOM updates becomes fragile at this complexity.
- **Component reuse** — Camera capture, photo gallery, OCR status, line item cards will all be reused across steps.
- **Form handling** — Line-by-line receiving with quantities, conditions, notes per line item is form-heavy. React makes this manageable.
- **Ecosystem** — Libraries for camera access (`react-webcam`), state machines (`xstate` or `zustand`), and form management are mature.

**Specific choices:**

| Layer | Choice | Why |
|---|---|---|
| UI Framework | React 18+ | Component model, hooks, suspense for loading states |
| State | Zustand | Lightweight, no boilerplate, persists to IndexedDB easily |
| Routing | React Router v6 | Nested routes map well to wizard steps |
| Styling | Tailwind CSS | Utility-first, mobile-optimized, no CSS-in-JS overhead |
| Camera | Native `<input capture>` + `getUserMedia` | iOS PWA compatible, no heavy lib needed |
| OCR | Tesseract.js (basic) + Azure AI Document Intelligence (packing slips) | See OCR section |
| Build | Vite + vite-plugin-pwa | Keep existing, works great |
| HTTP | Fetch (native) or Axios | Proxy calls are simple REST |

### Proxy: Node.js + Express (or Hono)

Lightweight API server that:
1. Manages SAP B1 Service Layer sessions (login, session cookie, re-auth)
2. Proxies PO lookup and GRPO posting
3. Handles CORS for the PWA
4. Validates requests before forwarding to SL
5. Runs on the same internal network as the SAP server

**Why a proxy is required:**
- SL is internal-only; iPhones connect via company WiFi
- SL uses session cookies + CSRF tokens — browser CORS policies block direct cross-origin calls from a PWA
- Centralizes SL credentials and session management (no SL passwords on mobile devices)
- Adds a validation layer before posting to SAP

### OCR Strategy

**Packing Slips (Step 3) — Full Extraction:**

For full data extraction (PO#, line items, quantities, vendor, carrier, dates), client-side Tesseract.js alone will be unreliable. Packing slips have varied layouts, tables, and mixed fonts.

**Two-tier approach:**

1. **Tier 1 — Client-side (Tesseract.js):** Quick PO number extraction using regex patterns. Runs immediately after capture. Gets the user into the PO lookup flow fast.
2. **Tier 2 — Server-side (Azure AI Document Intelligence or similar):** Send the full packing slip image to a document intelligence API for structured extraction. Returns vendor, line items, quantities, etc. The proxy server relays this call.

> **Decision point:** If budget is a concern, start with Tesseract.js only + manual entry as fallback. The architecture supports adding Azure AI later without reworking the flow.

**Material Test Reports (Step 4) — Image Capture Only:**

MTRs vary wildly by vendor. No structured OCR — just capture high-quality images and attach them to the SAP document and OneDrive. The images serve as the permanent record.

## Photo Resolution Strategy

Photos serve two purposes: documentation and (sometimes) marketing. The app uses a **dual-mode** approach:

| Steps | Mode | Quality | Typical Size | Purpose |
|---|---|---|---|---|
| 1-4 (box, label, slips, docs) | Standard | 80% JPEG compression | ~200-500KB | Documentation only |
| 5 (product photos) | Dual | Standard by default, "High-Res" toggle available | 200KB or 2-4MB | Documentation + potential marketing use |

In Step 5, each photo (or each line item) has a **high-res toggle**. When enabled, the photo is saved at full camera resolution with minimal compression. These originals are uploaded to OneDrive in a separate `hi-res/` subfolder so marketing can pull them directly.

The photo service handles this:
```typescript
function compressPhoto(blob: Blob, mode: 'standard' | 'high-res'): Promise<Blob> {
  if (mode === 'high-res') return blob; // pass through original
  // Canvas resize + toBlob at 0.8 quality for standard
}
```

## File Storage Strategy

All photos and scanned documents go to **both** locations:

1. **OneDrive** — Organized folder structure for easy browsing and sharing
2. **SAP B1 Attachments** — Linked directly to the GRPO document

```
OneDrive Structure:
/Receiving/
  └── {YYYY-MM-DD}/
      └── PO-{PONumber}/
          ├── 01-box/
          │   └── box_001.jpg
          ├── 02-shipping-label/
          │   └── label_001.jpg
          ├── 03-packing-slips/
          │   ├── slip_001.jpg
          │   └── slip_002.jpg
          ├── 04-documents/
          │   ├── mtr_001.jpg
          │   └── coa_001.jpg
          └── 05-products/
              ├── {PartNumber}_001.jpg
              ├── {PartNumber}_002.jpg
              └── hi-res/               # Full-resolution originals
                  ├── {PartNumber}_001.jpg
                  └── {PartNumber}_002.jpg
```

## Authentication Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  iPhone   │     │  Proxy   │     │   SAP    │
│  PWA      │     │  Server  │     │   SL     │
└────┬─────┘     └────┬─────┘     └────┬─────┘
     │                 │                │
     │ 1. Azure AD     │                │
     │    login ───────────► MS Graph   │
     │    (existing)   │                │
     │                 │                │
     │ 2. POST /api/   │                │
     │    auth ────────►│                │
     │    (Azure token) │                │
     │                 │ 3. POST /Login │
     │                 │───────────────►│
     │                 │◄─── session ───│
     │                 │     cookie     │
     │◄── proxy token ─│                │
     │    (JWT)        │                │
     │                 │                │
     │ 4. All SAP calls│                │
     │    go through   │                │
     │    proxy with   │                │
     │    JWT token    │                │
```

The proxy authenticates the user via their Azure AD token, then manages a pool of SAP SL sessions. The PWA never sees SL credentials.

## Key Design Principles

1. **Photo-first UX** — Every step starts with the camera. Minimize typing.
2. **Fail-forward** — If OCR misses, user can always manually enter. Never block the flow.
3. **Atomic sessions** — A receiving session captures everything for one shipment. Can be abandoned and restarted.
4. **Audit trail** — Every photo, every confirmation, every override is timestamped and attributed to a user.
5. **Mobile-native feel** — Large touch targets, swipe gestures, haptic feedback where supported. Designed for gloved hands in a warehouse.
