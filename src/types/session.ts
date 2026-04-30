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
  shippingSpeed: string;
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
  photos: CapturedPhoto[];
  confirmed: boolean;
  // POR1.FreeTxt from the PO line, surfaced read-only for the receiver
  freeText: string;
}

export interface ShippingDetails {
  transpCode: string;
  shipSpeed: string;
  fob: string;
  frtChargeType: string;
  frtTracking: string;
}

export interface ReceivingSession {
  id: string;
  createdAt: string;
  createdBy: string;
  status: SessionStatus;

  // BOX step — box photos + label photos captured together
  boxPhotos: CapturedPhoto[];
  boxDamaged: boolean;
  boxDamageNotes: string;
  labelPhotos: CapturedPhoto[];
  // Raw OCR extraction from the shipping label, used to prefill shipping details
  shippingInfo: ShippingInfo;

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
  CARRIER: "Carrier",
  PACKING_SLIP: "Packing Slip",
  SHIPPING_DETAILS: "Shipping Details",
  DOCUMENTS: "Documents",
  LINES: "Line Receiving",
  REVIEW: "Review",
};

export const STEP_ORDER: SessionStatus[] = [
  "BOX",
  "CARRIER",
  "PACKING_SLIP",
  "SHIPPING_DETAILS",
  "DOCUMENTS",
  "LINES",
];
