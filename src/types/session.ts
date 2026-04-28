export type SessionStatus =
  | "CREATED"
  | "STEP_1"
  | "STEP_2"
  | "STEP_3"
  | "STEP_4"
  | "STEP_5"
  | "REVIEW"
  | "SUBMITTED";

export type DocumentType = "mtr" | "coc" | "coa" | "inspection" | "other";
export type ItemCondition = "good" | "damaged" | "wrong_item" | "short";

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
}

export interface ReceivingSession {
  id: string;
  createdAt: string;
  createdBy: string;
  status: SessionStatus;

  // Step 1: Box
  boxPhotos: CapturedPhoto[];
  boxDamaged: boolean;
  boxDamageNotes: string;

  // Step 2: Shipping Label
  labelPhotos: CapturedPhoto[];
  shippingInfo: ShippingInfo;

  // Step 3: Packing Slip
  packingSlipPhotos: CapturedPhoto[];
  poNumber: string;
  poDocEntry?: number;
  vendorCode?: string;
  vendorName?: string;

  // Step 4: Documents
  documents: CapturedDocument[];
  noDocuments: boolean;

  // Step 5: Line Receiving
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
  STEP_1: "Box Photos",
  STEP_2: "Shipping Label",
  STEP_3: "Packing Slip",
  STEP_4: "Documents",
  STEP_5: "Line Receiving",
  REVIEW: "Review",
};
