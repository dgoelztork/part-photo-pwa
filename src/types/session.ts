export type SessionStatus =
  | "BOX"
  | "CARRIER"
  | "PACKING_SLIP"
  | "SHIPPING_DETAILS"
  | "DOCUMENTS"
  | "LINES"
  | "REVIEW"
  | "SUBMITTED";

export type DocumentType = "mtr" | "coc" | "coa" | "inspection" | "other";
export type ItemCondition = "good" | "damaged" | "wrong_item" | "short";
export type Carrier = "UPS" | "FedEx" | "LTL" | "Other";

export interface CapturedPhoto {
  id: string;
  blob: Blob;
  thumbnailUrl: string;
  timestamp: string;
}

export interface CapturedDocument {
  photo: CapturedPhoto;
  documentType: DocumentType;
  label: string;
}

export interface ShippingInfo {
  carrier: string;
  trackingNumber: string;
  weight: string;
  shipFrom: string;
  shipToZip: string;
  shippingSpeed: string;
}

/**
 * One physical box in a multi-piece shipment. Each box carries its own label
 * (tracking number, weight, origin ZIP) and gets its own UPS list rate. Aggregated
 * up at submit time: trackingNumber values join into OPDN.U_pFrtTracking and the
 * freightRate numbers sum into OPDN.U_InboundFrt.
 */
export interface ShippingBox {
  id: string;
  labelPhotos: CapturedPhoto[];
  /** Receiver checked "this box had no label" — labelPhotos can be empty. */
  noLabel: boolean;
  /** True while barcode+OCR extraction is still running for this box. */
  extracting?: boolean;
  /** Damage flag is per-box now (multi-piece shipments may have one damaged box and others fine). */
  damaged: boolean;
  damageNotes: string;
  /** Photos of damage, only captured when damaged === true. Replaces the old session-level boxPhotos. */
  damagePhotos: CapturedPhoto[];
  // OCR/barcode-extracted, editable on the SHIPPING_DETAILS step:
  trackingNumber: string;
  weight: string;          // "12.5 LBS"
  shipFromZip: string;
  // Computed via the UPS Rating API per box; list rate, not negotiated.
  freightRate: string;     // dollar amount as a plain string, no $
  freightRateLabel: string;
}

export interface ReceivingLine {
  lineNum: number;
  itemCode: string;
  itemDescription: string;
  orderedQty: number;
  previouslyReceivedQty: number;
  openQty: number;
  receivedQty: number;
  condition: ItemCondition;
  notes: string;
  /** Product/item photos. Required for confirm. Also copied to the per-part Web images folder. */
  photos: CapturedPhoto[];
  /** Nameplate / label / stamp photos of the part itself. Optional. Receiving folder only. */
  nameplatePhotos: CapturedPhoto[];
  /** Photo(s) showing the full quantity received, to document the count. Optional. Receiving folder only. */
  quantityPhotos: CapturedPhoto[];
  confirmed: boolean;
  // POR1.FreeTxt from the PO line, surfaced read-only for the receiver
  freeText: string;
}

/**
 * Shipment-wide shipping details. PO-header defaults that apply to every box
 * in a multi-piece arrival. Per-box fields (tracking, weight, origin ZIP,
 * freight rate) now live on each ShippingBox.
 */
export interface ShippingDetails {
  transpCode: string;
  shipSpeed: string;
  fob: string;
  frtChargeType: string;
  /** Destination warehouse ZIP. Same for every box in the shipment. */
  shipToZip: string;
}

export interface ReceivingSession {
  id: string;
  createdAt: string;
  createdBy: string;
  status: SessionStatus;

  // BOX step — per-box shipping labels with per-box damage state
  /** Target number of boxes in this carrier shipment. boxes.length must reach this before Next is enabled. */
  shipmentBoxCount: number;
  /** One entry per physical box in the shipment, populated as labels are captured. */
  boxes: ShippingBox[];

  // CARRIER step — receiver picks before packing slip
  carrier?: Carrier;

  // PACKING_SLIP step
  packingSlipPhotos: CapturedPhoto[];
  noPackingSlip: boolean;
  poNumber: string;
  poDocEntry?: number;
  vendorCode?: string;
  vendorName?: string;
  // PO-header notes surfaced for the receiver to read (read-only)
  importantInfo: string;
  internalComments: string;
  expoNotes: string;

  // SHIPPING_DETAILS step — editable values, prefilled from PO + carrier + label OCR
  shippingDetails: ShippingDetails;

  // DOCUMENTS step
  documents: CapturedDocument[];
  noDocuments: boolean;

  // LINES step
  lineItems: ReceivingLine[];

  // Submission
  submittedAt?: string;
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  mtr: "Material Test Report (MTR)",
  coc: "Certificate of Conformance (CoC)",
  coa: "Certificate of Analysis (CoA)",
  inspection: "Inspection Report",
  other: "Other",
};

export const CONDITION_LABELS: Record<ItemCondition, string> = {
  good: "Good",
  damaged: "Damaged",
  wrong_item: "Wrong Item",
  short: "Short Ship",
};

export const STEP_LABELS: Record<string, string> = {
  BOX: "Box & Label",
  PACKING_SLIP: "Packing Slip",
  SHIPPING_DETAILS: "Shipping Details",
  DOCUMENTS: "Documents",
  LINES: "Line Receiving",
  REVIEW: "Review",
};

// CARRIER is intentionally absent — carrier selection now lives on the BOX
// step. The status string is retained in the SessionStatus union so resumed
// pre-v4 sessions don't fail typing; the persist migration coerces any
// "CARRIER" status to "BOX" on load.
export const STEP_ORDER: SessionStatus[] = [
  "BOX",
  "PACKING_SLIP",
  "SHIPPING_DETAILS",
  "DOCUMENTS",
  "LINES",
];
