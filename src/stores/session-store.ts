import { create } from "zustand";
import { persist, type StorageValue } from "zustand/middleware";
import { get, set, del } from "idb-keyval";
import type {
  ReceivingSession,
  SessionStatus,
  CapturedPhoto,
  CapturedDocument,
  ShippingDetails,
  ShippingBox,
  ReceivingLine,
  ItemCondition,
  Carrier,
} from "../types/session";

interface SessionStore {
  sessions: ReceivingSession[];
  activeSessionId: string | null;

  // Session management
  createSession: (userName: string) => string;
  resumeSession: (id: string) => void;
  deleteSession: (id: string) => void;
  getActiveSession: () => ReceivingSession | null;

  // Navigation
  setStatus: (status: SessionStatus) => void;
  goToStep: (step: SessionStatus) => void;

  // BOX step (now also holds the per-box shipping labels)
  addBoxPhoto: (photo: CapturedPhoto) => void;
  removeBoxPhoto: (photoId: string) => void;
  setShipmentBoxCount: (count: number) => void;
  setBoxDamaged: (damaged: boolean) => void;
  setBoxDamageNotes: (notes: string) => void;
  /** Append a new ShippingBox entry. Returns the new box id so the caller can update its OCR fields. */
  addShippingBox: (partial?: Partial<Omit<ShippingBox, "id">>) => string;
  removeShippingBox: (id: string) => void;
  updateShippingBox: (id: string, updates: Partial<ShippingBox>) => void;
  addShippingBoxLabelPhoto: (id: string, photo: CapturedPhoto) => void;
  removeShippingBoxLabelPhoto: (id: string, photoId: string) => void;

  // CARRIER step
  setCarrier: (carrier: Carrier) => void;

  // PACKING_SLIP step
  addPackingSlipPhoto: (photo: CapturedPhoto) => void;
  removePackingSlipPhoto: (photoId: string) => void;
  setNoPackingSlip: (noPackingSlip: boolean) => void;
  setPoNumber: (poNumber: string) => void;
  // Called after a successful PO lookup; pulls in everything we need to surface
  // on later steps (shipping details defaults, header notes, etc.).
  applyPoLookup: (data: {
    docEntry: number;
    vendorCode: string;
    vendorName: string;
    importantInfo: string;
    internalComments: string;
    expoNotes: string;
    transpCode: string | null;
    shipSpeed: string;
    fob: string;
    frtChargeType: string;
  }) => void;

  // SHIPPING_DETAILS step
  updateShippingDetails: (patch: Partial<ShippingDetails>) => void;

  // DOCUMENTS step
  addDocument: (doc: CapturedDocument) => void;
  removeDocument: (photoId: string) => void;
  setNoDocuments: (noDocuments: boolean) => void;

  // LINES step
  setLineItems: (lines: ReceivingLine[]) => void;
  updateLine: (lineNum: number, updates: Partial<ReceivingLine>) => void;
  addLinePhoto: (lineNum: number, photo: CapturedPhoto) => void;
  removeLinePhoto: (lineNum: number, photoId: string) => void;
  addLineNameplatePhoto: (lineNum: number, photo: CapturedPhoto) => void;
  removeLineNameplatePhoto: (lineNum: number, photoId: string) => void;
  addLineQuantityPhoto: (lineNum: number, photo: CapturedPhoto) => void;
  removeLineQuantityPhoto: (lineNum: number, photoId: string) => void;
  confirmLine: (lineNum: number) => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function createEmptySession(userName: string): ReceivingSession {
  return {
    id: generateId(),
    createdAt: new Date().toISOString(),
    createdBy: userName,
    status: "BOX",
    boxPhotos: [],
    shipmentBoxCount: 1,
    boxDamaged: false,
    boxDamageNotes: "",
    boxes: [],
    packingSlipPhotos: [],
    noPackingSlip: false,
    poNumber: "",
    importantInfo: "",
    internalComments: "",
    expoNotes: "",
    shippingDetails: {
      transpCode: "",
      shipSpeed: "",
      fob: "",
      frtChargeType: "",
      shipToZip: "",
    },
    documents: [],
    noDocuments: false,
    lineItems: [],
  };
}

// Custom IndexedDB storage adapter for Zustand persist
const idbStorage = {
  getItem: async (name: string): Promise<StorageValue<SessionStore> | null> => {
    const value = await get<string>(name);
    return value ? JSON.parse(value) : null;
  },
  setItem: async (name: string, value: StorageValue<SessionStore>): Promise<void> => {
    await set(name, JSON.stringify(value));
  },
  removeItem: async (name: string): Promise<void> => {
    await del(name);
  },
};

function updateSession(
  sessions: ReceivingSession[],
  id: string | null,
  updater: (session: ReceivingSession) => Partial<ReceivingSession>
): ReceivingSession[] {
  if (!id) return sessions;
  return sessions.map((s) =>
    s.id === id ? { ...s, ...updater(s) } : s
  );
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,

      createSession: (userName: string) => {
        const session = createEmptySession(userName);
        set((state) => ({
          sessions: [session, ...state.sessions],
          activeSessionId: session.id,
        }));
        return session.id;
      },

      resumeSession: (id: string) => {
        set({ activeSessionId: id });
      },

      deleteSession: (id: string) => {
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== id),
          activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
        }));
      },

      getActiveSession: () => {
        const { sessions, activeSessionId } = get();
        return sessions.find((s) => s.id === activeSessionId) ?? null;
      },

      setStatus: (status: SessionStatus) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, () => ({
            status,
          })),
        }));
      },

      goToStep: (step: SessionStatus) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, () => ({
            status: step,
          })),
        }));
      },

      // BOX
      addBoxPhoto: (photo: CapturedPhoto) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            boxPhotos: [...s.boxPhotos, photo],
          })),
        }));
      },
      removeBoxPhoto: (photoId: string) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            boxPhotos: s.boxPhotos.filter((p) => p.id !== photoId),
          })),
        }));
      },
      setShipmentBoxCount: (count: number) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, () => ({
            shipmentBoxCount: Math.max(1, Math.floor(count) || 1),
          })),
        }));
      },
      setBoxDamaged: (damaged: boolean) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, () => ({
            boxDamaged: damaged,
          })),
        }));
      },
      setBoxDamageNotes: (notes: string) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, () => ({
            boxDamageNotes: notes,
          })),
        }));
      },

      // BOX (per-box shipping label captures)
      addShippingBox: (partial?: Partial<Omit<ShippingBox, "id">>) => {
        const id = generateId();
        const box: ShippingBox = {
          id,
          labelPhotos: [],
          noLabel: false,
          trackingNumber: "",
          weight: "",
          shipFromZip: "",
          freightRate: "",
          freightRateLabel: "",
          ...partial,
        };
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            boxes: [...s.boxes, box],
          })),
        }));
        return id;
      },
      removeShippingBox: (id: string) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            boxes: s.boxes.filter((b) => b.id !== id),
          })),
        }));
      },
      updateShippingBox: (id: string, updates: Partial<ShippingBox>) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            boxes: s.boxes.map((b) => (b.id === id ? { ...b, ...updates } : b)),
          })),
        }));
      },
      addShippingBoxLabelPhoto: (id: string, photo: CapturedPhoto) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            boxes: s.boxes.map((b) =>
              b.id === id ? { ...b, labelPhotos: [...b.labelPhotos, photo] } : b,
            ),
          })),
        }));
      },
      removeShippingBoxLabelPhoto: (id: string, photoId: string) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            boxes: s.boxes.map((b) =>
              b.id === id ? { ...b, labelPhotos: b.labelPhotos.filter((p) => p.id !== photoId) } : b,
            ),
          })),
        }));
      },

      // CARRIER
      setCarrier: (carrier: Carrier) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            carrier,
            // Mirror into the editable shipping details if the receiver hasn't
            // overridden it yet — saves a re-entry on the SHIPPING_DETAILS step.
            shippingDetails: s.shippingDetails.transpCode
              ? s.shippingDetails
              : { ...s.shippingDetails, transpCode: carrier },
          })),
        }));
      },

      // PACKING_SLIP
      addPackingSlipPhoto: (photo: CapturedPhoto) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            packingSlipPhotos: [...s.packingSlipPhotos, photo],
          })),
        }));
      },
      removePackingSlipPhoto: (photoId: string) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            packingSlipPhotos: s.packingSlipPhotos.filter((p) => p.id !== photoId),
          })),
        }));
      },
      setNoPackingSlip: (noPackingSlip: boolean) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, () => ({
            noPackingSlip,
          })),
        }));
      },
      setPoNumber: (poNumber: string) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, () => ({
            poNumber,
          })),
        }));
      },
      applyPoLookup: (data) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => {
            // Don't clobber edits the receiver may have already made on the
            // shipping-details step; only fill blanks from the PO defaults.
            const sd = s.shippingDetails;
            const carrierDefault = s.carrier ?? data.transpCode ?? "";
            return {
              poDocEntry: data.docEntry,
              vendorCode: data.vendorCode,
              vendorName: data.vendorName,
              importantInfo: data.importantInfo,
              internalComments: data.internalComments,
              expoNotes: data.expoNotes,
              shippingDetails: {
                transpCode: sd.transpCode || carrierDefault,
                shipSpeed: sd.shipSpeed || data.shipSpeed,
                fob: sd.fob || data.fob,
                frtChargeType: sd.frtChargeType || data.frtChargeType,
                shipToZip: sd.shipToZip,
              },
            };
          }),
        }));
      },
      updateShippingDetails: (patch: Partial<ShippingDetails>) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            shippingDetails: { ...s.shippingDetails, ...patch },
          })),
        }));
      },

      // DOCUMENTS
      addDocument: (doc: CapturedDocument) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            documents: [...s.documents, doc],
          })),
        }));
      },
      removeDocument: (photoId: string) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            documents: s.documents.filter((d) => d.photo.id !== photoId),
          })),
        }));
      },
      setNoDocuments: (noDocuments: boolean) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, () => ({
            noDocuments,
          })),
        }));
      },

      // LINES
      setLineItems: (lines: ReceivingLine[]) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, () => ({
            lineItems: lines,
          })),
        }));
      },
      updateLine: (lineNum: number, updates: Partial<ReceivingLine>) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            lineItems: s.lineItems.map((l) =>
              l.lineNum === lineNum ? { ...l, ...updates } : l
            ),
          })),
        }));
      },
      addLinePhoto: (lineNum: number, photo: CapturedPhoto) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            lineItems: s.lineItems.map((l) =>
              l.lineNum === lineNum ? { ...l, photos: [...l.photos, photo] } : l
            ),
          })),
        }));
      },
      removeLinePhoto: (lineNum: number, photoId: string) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            lineItems: s.lineItems.map((l) =>
              l.lineNum === lineNum
                ? { ...l, photos: l.photos.filter((p) => p.id !== photoId) }
                : l
            ),
          })),
        }));
      },
      addLineNameplatePhoto: (lineNum: number, photo: CapturedPhoto) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            lineItems: s.lineItems.map((l) =>
              l.lineNum === lineNum ? { ...l, nameplatePhotos: [...l.nameplatePhotos, photo] } : l
            ),
          })),
        }));
      },
      removeLineNameplatePhoto: (lineNum: number, photoId: string) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            lineItems: s.lineItems.map((l) =>
              l.lineNum === lineNum
                ? { ...l, nameplatePhotos: l.nameplatePhotos.filter((p) => p.id !== photoId) }
                : l
            ),
          })),
        }));
      },
      addLineQuantityPhoto: (lineNum: number, photo: CapturedPhoto) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            lineItems: s.lineItems.map((l) =>
              l.lineNum === lineNum ? { ...l, quantityPhotos: [...l.quantityPhotos, photo] } : l
            ),
          })),
        }));
      },
      removeLineQuantityPhoto: (lineNum: number, photoId: string) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            lineItems: s.lineItems.map((l) =>
              l.lineNum === lineNum
                ? { ...l, quantityPhotos: l.quantityPhotos.filter((p) => p.id !== photoId) }
                : l
            ),
          })),
        }));
      },
      confirmLine: (lineNum: number) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            lineItems: s.lineItems.map((l) =>
              l.lineNum === lineNum ? { ...l, confirmed: true } : l
            ),
          })),
        }));
      },
    }),
    {
      name: "receiving-sessions",
      storage: idbStorage,
      // v1 added per-line nameplatePhotos and quantityPhotos.
      // v2 added per-line boxCount (later moved to the shipment level).
      // v3 introduced session.shipmentBoxCount and abandoned per-line boxCount.
      // v4 retired the CARRIER wizard step (carrier moved to BOX).
      // v5 restructured shipping: session.labelPhotos+shippingInfo and the
      //    per-box fields on shippingDetails (frtTracking, weight, shipFromZip,
      //    freightRate, freightRateLabel) move into session.boxes[].
      // Backfill so resumed sessions don't crash.
      version: 5,
      migrate: (persistedState, fromVersion) => {
        const state = (persistedState ?? {}) as { sessions?: ReceivingSession[] };
        if (fromVersion < 5 && Array.isArray(state.sessions)) {
          state.sessions = state.sessions.map((s) => {
            const legacy = s as ReceivingSession & {
              labelPhotos?: CapturedPhoto[];
              shippingInfo?: { trackingNumber?: string; weight?: string; shipFrom?: string };
              shippingDetails?: {
                frtTracking?: string;
                weight?: string;
                shipFromZip?: string;
                freightRate?: string;
                freightRateLabel?: string;
              } & ShippingDetails;
            };
            const oldSd = legacy.shippingDetails ?? ({} as ShippingDetails);
            const oldLabels = Array.isArray(legacy.labelPhotos) ? legacy.labelPhotos : [];
            const hasLegacyData =
              oldLabels.length > 0 ||
              (legacy.shippingInfo && Object.values(legacy.shippingInfo).some(Boolean)) ||
              oldSd.frtTracking || oldSd.weight || oldSd.shipFromZip || oldSd.freightRate;

            const seedBox: ShippingBox = {
              id: generateId(),
              labelPhotos: oldLabels,
              noLabel: oldLabels.length === 0,
              trackingNumber: oldSd.frtTracking ?? legacy.shippingInfo?.trackingNumber ?? "",
              weight: oldSd.weight ?? legacy.shippingInfo?.weight ?? "",
              shipFromZip: oldSd.shipFromZip ?? legacy.shippingInfo?.shipFrom ?? "",
              freightRate: oldSd.freightRate ?? "",
              freightRateLabel: oldSd.freightRateLabel ?? "",
            };

            return {
              ...legacy,
              status: legacy.status === "CARRIER" ? "BOX" : legacy.status,
              shipmentBoxCount:
                typeof legacy.shipmentBoxCount === "number" && legacy.shipmentBoxCount > 0
                  ? legacy.shipmentBoxCount
                  : 1,
              boxes: Array.isArray(legacy.boxes) && legacy.boxes.length > 0
                ? legacy.boxes
                : hasLegacyData
                  ? [seedBox]
                  : [],
              shippingDetails: {
                transpCode: oldSd.transpCode ?? "",
                shipSpeed: oldSd.shipSpeed ?? "",
                fob: oldSd.fob ?? "",
                frtChargeType: oldSd.frtChargeType ?? "",
                shipToZip: (oldSd as ShippingDetails & { shipToZip?: string }).shipToZip ?? "",
              },
              lineItems: Array.isArray(legacy.lineItems)
                ? legacy.lineItems.map((l: ReceivingLine) => ({
                    ...l,
                    nameplatePhotos: Array.isArray(l.nameplatePhotos) ? l.nameplatePhotos : [],
                    quantityPhotos: Array.isArray(l.quantityPhotos) ? l.quantityPhotos : [],
                  }))
                : [],
            } as ReceivingSession;
          });
        }
        return state as unknown as SessionStore;
      },
      partialize: (state) => {
        // Strip blob data from photos for persistence (blobs can't be serialized)
        // Photos will need to be re-captured if the session is resumed after app close
        const stripped = {
          ...state,
          sessions: state.sessions.map((s) => ({
            ...s,
            boxPhotos: s.boxPhotos.map(stripBlob),
            boxes: s.boxes.map((b) => ({
              ...b,
              labelPhotos: b.labelPhotos.map(stripBlob),
            })),
            packingSlipPhotos: s.packingSlipPhotos.map(stripBlob),
            documents: s.documents.map((d) => ({ ...d, photo: stripBlob(d.photo) })),
            lineItems: s.lineItems.map((l) => ({
              ...l,
              photos: l.photos.map(stripBlob),
              nameplatePhotos: l.nameplatePhotos.map(stripBlob),
              quantityPhotos: l.quantityPhotos.map(stripBlob),
            })),
          })),
        };
        return stripped as unknown as SessionStore;
      },
    }
  )
);

function stripBlob(photo: CapturedPhoto): CapturedPhoto {
  return { ...photo, blob: new Blob(), thumbnailUrl: "" };
}

// Suppress unused import warnings — these are used by the store's type signature
void (0 as unknown as ItemCondition);
