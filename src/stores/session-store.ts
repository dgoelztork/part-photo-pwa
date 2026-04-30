import { create } from "zustand";
import { persist, type StorageValue } from "zustand/middleware";
import { get, set, del } from "idb-keyval";
import type {
  ReceivingSession,
  SessionStatus,
  CapturedPhoto,
  CapturedDocument,
  ShippingInfo,
  ShippingDetails,
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

  // BOX step (now also holds the shipping label photos)
  addBoxPhoto: (photo: CapturedPhoto) => void;
  removeBoxPhoto: (photoId: string) => void;
  setBoxDamaged: (damaged: boolean) => void;
  setBoxDamageNotes: (notes: string) => void;
  addLabelPhoto: (photo: CapturedPhoto) => void;
  removeLabelPhoto: (photoId: string) => void;
  updateShippingInfo: (info: Partial<ShippingInfo>) => void;

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
    frtTracking: string;
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
    boxDamaged: false,
    boxDamageNotes: "",
    labelPhotos: [],
    shippingInfo: { carrier: "", trackingNumber: "", weight: "", shipFrom: "", shippingSpeed: "" },
    packingSlipPhotos: [],
    noPackingSlip: false,
    poNumber: "",
    importantInfo: "",
    internalComments: "",
    expoNotes: "",
    shippingDetails: { transpCode: "", shipSpeed: "", fob: "", frtChargeType: "", frtTracking: "" },
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

      // BOX (label photos captured on the same step)
      addLabelPhoto: (photo: CapturedPhoto) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            labelPhotos: [...s.labelPhotos, photo],
          })),
        }));
      },
      removeLabelPhoto: (photoId: string) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            labelPhotos: s.labelPhotos.filter((p) => p.id !== photoId),
          })),
        }));
      },
      updateShippingInfo: (info: Partial<ShippingInfo>) => {
        set((state) => ({
          sessions: updateSession(state.sessions, state.activeSessionId, (s) => ({
            shippingInfo: { ...s.shippingInfo, ...info },
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
                shipSpeed: sd.shipSpeed || s.shippingInfo.shippingSpeed || data.shipSpeed,
                fob: sd.fob || data.fob,
                frtChargeType: sd.frtChargeType || data.frtChargeType,
                frtTracking: sd.frtTracking || s.shippingInfo.trackingNumber || data.frtTracking,
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
      partialize: (state) => {
        // Strip blob data from photos for persistence (blobs can't be serialized)
        // Photos will need to be re-captured if the session is resumed after app close
        const stripped = {
          ...state,
          sessions: state.sessions.map((s) => ({
            ...s,
            boxPhotos: s.boxPhotos.map(stripBlob),
            labelPhotos: s.labelPhotos.map(stripBlob),
            packingSlipPhotos: s.packingSlipPhotos.map(stripBlob),
            documents: s.documents.map((d) => ({ ...d, photo: stripBlob(d.photo) })),
            lineItems: s.lineItems.map((l) => ({
              ...l,
              photos: l.photos.map(stripBlob),
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
