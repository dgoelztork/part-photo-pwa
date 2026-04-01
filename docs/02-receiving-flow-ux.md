# Part Receiving PWA — Receiving Flow & UX Design

## Workflow Overview

The receiving flow is a **guided wizard** with 5 steps. The user cannot skip steps (photos are required documentation), but can go back to retake. Step 3 (packing slip OCR) is the pivot point — it provides the PO number that drives step 5.

```
[Login] → [New Session] → [Step 1] → [Step 2] → [Step 3] → [Step 4] → [Step 5] → [Review] → [Submit]
                              │          │          │           │          │
                            Box Photo  Label     Packing     MTR/Docs   Product
                                       Photo     Slip OCR    Capture    Line Recv
```

## Screen-by-Screen Design

---

### Screen 0: Dashboard (Home)

**Purpose:** Landing screen after login. Shows active/recent sessions.

**Content:**
- Greeting with user name (from Azure AD)
- **"Start New Receiving Session"** — large primary button
- **Recent Sessions** — list of in-progress or completed sessions today
  - Each shows: PO#, vendor, timestamp, status (in-progress / completed / submitted)
  - Tap to resume an in-progress session
- **Settings gear** — proxy URL, OneDrive path config

**State:**
- Sessions stored in Zustand + IndexedDB
- List pulled from local store (not SAP — sessions are local until submitted)

---

### Screen 1: Box Condition Photo

**Purpose:** Document the received condition of the shipping box before opening.

**UX Flow:**
1. Screen opens with camera viewfinder (full-screen, landscape-friendly)
2. Overlay text: "Photograph the box as received"
3. User taps shutter button → photo captured
4. Photo appears as thumbnail below viewfinder
5. User can take multiple photos (damaged box = more angles)
6. **"Next"** button enabled after at least 1 photo

**UI Elements:**
- Full-screen camera preview
- Shutter button (large, centered at bottom)
- Photo count badge
- Thumbnail strip (horizontal scroll) at bottom
- Tap thumbnail → full-screen preview with delete option
- Optional: "Add note" text field for damage description
- **Back** / **Next** navigation

**Validation:**
- Minimum 1 photo required
- Optional damage flag toggle: "Box appears damaged?" → If yes, require a note

---

### Screen 2: Shipping Label Photo

**Purpose:** Capture the shipping label for cost verification and shipment tracking.

**UX Flow:**
1. Camera opens, overlay: "Photograph the shipping label clearly"
2. Guide frame overlay (rectangle) to help user frame the label
3. User captures photo(s)
4. After capture, the app could attempt OCR to extract:
   - Carrier name
   - Tracking number
   - Weight / dimensions (for cost calc)
   - Ship-from address
5. Extracted data shown for quick review (editable)
6. **"Next"** to proceed

**UI Elements:**
- Camera with guide frame overlay
- Shutter button
- Post-capture: extracted data card (if OCR succeeds)
- Manual entry fields as fallback: carrier, tracking #, weight
- Thumbnail strip for multiple label photos
- **Back** / **Next**

**Notes:**
- Shipping label OCR is a nice-to-have at launch. Start with photo capture + manual entry of key fields.
- Cost calculation is a downstream process (not in this app). The photo and extracted data enable it.

---

### Screen 3: Packing Slip Scan (Critical Step)

**Purpose:** OCR the packing slip(s) to extract the PO number and line details. This drives the rest of the workflow.

**UX Flow:**
1. Camera opens, overlay: "Photograph each page of the packing slip"
2. User captures one or more photos (multi-page slips)
3. After each capture, OCR runs automatically:
   - **Tier 1 (immediate):** Tesseract.js scans for PO number pattern
   - **Tier 2 (background):** If configured, sends to Azure AI for full extraction
4. PO number detected → shown in a prominent card
5. If PO not detected → manual entry field appears
6. User confirms or corrects the PO number
7. App calls proxy → Service Layer to look up the PO
8. PO details shown: vendor name, order date, line count
9. **"Next"** to proceed with this PO

**UI Elements:**
- Camera with "document scan" frame (full page)
- Auto-capture hint: "Hold steady..." → auto-snap when stable (stretch goal)
- Post-capture: processing spinner → extracted PO# displayed
- **PO number field** — pre-filled from OCR, always editable
- "Look Up PO" button
- PO summary card showing vendor, date, # of lines
- Error state: "PO not found in SAP" with retry/re-enter option
- Thumbnail strip for packing slip pages
- **Back** / **Next**

**Data Extracted (from OCR or manual):**
- PO Number (required)
- Vendor name
- Ship date
- Carrier / tracking
- Line items with part numbers and quantities (if full OCR succeeds)

**Error Handling:**
- OCR fails → Manual PO entry (always available)
- PO not in SAP → "PO {number} not found. Check the number or contact purchasing."
- PO already fully received → Warning: "This PO has already been received. Continue anyway?"
- Multiple POs on one shipment → Support adding additional POs (less common, v2 feature)

---

### Screen 4: Material Test Reports & Documents

**Purpose:** Capture any MTRs, certificates of conformance, or other documents shipped with the order.

**UX Flow:**
1. Camera opens, overlay: "Photograph any included documents (MTRs, CoCs, etc.)"
2. User captures document photos — one photo per page
3. Each photo tagged with a document type (dropdown):
   - Material Test Report (MTR)
   - Certificate of Conformance (CoC)
   - Certificate of Analysis (CoA)
   - Inspection Report
   - Other (free text)
4. **"No documents included"** skip button (some shipments don't have any)
5. **"Next"** when done

**UI Elements:**
- Camera with document frame
- After capture: document type selector dropdown
- Thumbnail grid with type labels
- "Add another document" button
- "No documents included" link/button (skip)
- **Back** / **Next**

**Notes:**
- No structured OCR here — documents vary too much by vendor
- Images are stored at full resolution for human readability
- Future enhancement: if a vendor's MTR format becomes known, can add targeted extraction

---

### Screen 5: Product Line Receiving (Core Business Logic)

**Purpose:** Receive each PO line item — photograph the product, verify quantity and condition, confirm receipt.

**UX Flow:**

**5a. Line List View:**
1. Shows all PO lines pulled from SAP Service Layer
2. Each line shows: line #, part number, description, ordered qty, already received qty, open qty
3. Lines color-coded: green (received this session), gray (not yet), yellow (partial)
4. Tap a line → enters line detail view

**5b. Line Detail View:**
1. Part number and description prominently displayed
2. **Expected quantity** shown
3. **Camera section:** "Photograph this item"
   - User takes photos of the physical product
   - At least 1 photo required per line
4. **Received quantity** — number input, defaults to open qty
5. **Condition** — selector: Good / Damaged / Wrong Item / Short Ship
6. **Notes** — free text for any issues
7. **"Confirm Line"** → marks line as received, returns to list view

**5c. Completion:**
1. When all lines are addressed (received, shorted, or flagged), **"Review & Submit"** button appears
2. User can leave lines un-received (partial receiving is OK)
3. Warning if any lines are flagged as damaged or wrong item

**UI Elements (Line List):**
- Scrollable list of PO lines
- Each line: card with part#, description, qty badge
- Status indicators per line
- Progress bar: "3 of 7 lines received"
- **"Review & Submit"** button (appears when user is done)
- **Back** to step 4

**UI Elements (Line Detail):**
- Part info header (sticky at top)
- Camera viewfinder + shutter
- Photo thumbnails
- Quantity input (large, numeric keyboard)
- Condition selector (large buttons, not dropdown)
- Notes field
- **"Confirm Line"** button (full width, prominent)
- **Back** to line list

**Receiving Logic:**
- User can receive less than ordered (partial)
- User can flag discrepancies (qty mismatch, wrong part, damage)
- Each line's received qty feeds into the GRPO document
- Lines with qty = 0 are not included in the GRPO
- Damaged items can still be received (with documentation) or rejected (qty = 0 + note)

---

### Screen 6: Review & Submit

**Purpose:** Final review of the entire receiving session before posting to SAP.

**UX Flow:**
1. Summary of all steps:
   - Box photos: {count} photos, damage noted: yes/no
   - Shipping label: carrier, tracking #
   - Packing slip: PO #{number}, vendor
   - Documents: {count} documents captured
   - Lines received: {received}/{total}, any exceptions flagged
2. Line-by-line summary with qty received vs expected
3. Exception callouts (damaged, wrong item, short) highlighted in yellow/red
4. **"Submit Receiving"** — posts GRPO to SAP, uploads all files
5. Progress indicator during submission

**UI Elements:**
- Collapsible sections for each step
- Line item summary table
- Exception alerts at top if any
- **"Submit Receiving"** button (prominent, with confirmation dialog)
- **"Save Draft"** — saves locally without submitting
- Progress: "Posting to SAP... Uploading photos... Done!"

**Submission Flow:**
1. Post GRPO to SAP via proxy → get DocEntry back
2. Upload all photos to OneDrive (organized folder structure)
3. Attach all photos to the SAP GRPO document (Attachments2 API)
4. Mark session as "submitted" locally
5. Show success screen with GRPO document number

**Error Handling:**
- SAP post fails → show error, allow retry, don't lose data
- OneDrive upload fails → show warning, offer retry, GRPO still posted
- Partial failure → clear indication of what succeeded and what didn't

---

## Navigation & State Management

### Session State Machine

```
                    ┌──────────┐
                    │  CREATED  │
                    └─────┬────┘
                          │ Start
                          ▼
                    ┌──────────┐
              ┌────►│  STEP_1   │ Box Photo
              │     └─────┬────┘
              │           │ Next
              │           ▼
              │     ┌──────────┐
              │     │  STEP_2   │ Shipping Label
        Back  │     └─────┬────┘
              │           │ Next
              │           ▼
              │     ┌──────────┐
              │     │  STEP_3   │ Packing Slip + PO Lookup
              │     └─────┬────┘
              │           │ Next (PO confirmed)
              │           ▼
              │     ┌──────────┐
              │     │  STEP_4   │ Documents
              │     └─────┬────┘
              │           │ Next
              │           ▼
              │     ┌──────────┐
              │     │  STEP_5   │ Line Receiving
              │     └─────┬────┘
              │           │ Done
              │           ▼
              │     ┌──────────┐
              │     │  REVIEW   │
              │     └─────┬────┘
              │           │ Submit
              │           ▼
              │     ┌──────────┐
              └─────│ SUBMITTED │
                    └──────────┘
```

### Zustand Store Shape (Conceptual)

```typescript
interface ReceivingSession {
  id: string;
  createdAt: string;
  createdBy: string;              // Azure AD user
  status: SessionStatus;          // CREATED → STEP_1...STEP_5 → REVIEW → SUBMITTED

  // Step 1: Box
  boxPhotos: CapturedPhoto[];
  boxDamaged: boolean;
  boxDamageNotes: string;

  // Step 2: Shipping Label
  labelPhotos: CapturedPhoto[];
  shippingInfo: {
    carrier?: string;
    trackingNumber?: string;
    weight?: string;
    shipFrom?: string;
  };

  // Step 3: Packing Slip
  packingSlipPhotos: CapturedPhoto[];
  poNumber: string;
  poData?: SAPPurchaseOrder;      // Full PO from SAP
  ocrResults?: PackingSlipOCR;

  // Step 4: Documents
  documents: CapturedDocument[];  // Photo + type tag
  noDocuments: boolean;           // User confirmed none included

  // Step 5: Line Receiving
  lineItems: ReceivingLine[];     // From SAP PO, with receiving data added

  // Submission
  grpoDocEntry?: number;          // SAP document number after posting
  submittedAt?: string;
  uploadResults?: UploadResult[];
}

interface ReceivingLine {
  lineNum: number;
  itemCode: string;
  itemDescription: string;
  orderedQty: number;
  previouslyReceivedQty: number;
  openQty: number;

  // User input
  receivedQty: number;
  condition: 'good' | 'damaged' | 'wrong_item' | 'short';
  notes: string;
  photos: CapturedPhoto[];
  confirmed: boolean;
}
```

## Mobile UX Guidelines

### Touch Targets
- All buttons minimum 48x48px (Apple HIG recommends 44pt)
- Camera shutter button: 72px diameter minimum
- Spacing between interactive elements: 12px minimum

### Camera Optimization
- Default to rear camera
- Support pinch-to-zoom
- Flash toggle available
- Capture at highest resolution available (for OCR and documentation quality)
- Show focus indicator

### Warehouse Environment Considerations
- High contrast UI (readable in bright warehouse lighting or dim dock areas)
- Large text for key information (part numbers, quantities)
- Haptic feedback on capture and confirmation (where supported)
- Condition buttons use color + icon (not just color, for accessibility)
- Support for landscape and portrait, but optimize for portrait (one-handed use)

### Performance
- Photos stored as blobs in IndexedDB until submission
- Thumbnail generation for gallery views (don't render full-res in lists)
- OCR runs in a web worker (doesn't block UI)
- PO lookup shows skeleton loading state
- Debounce manual PO entry field
