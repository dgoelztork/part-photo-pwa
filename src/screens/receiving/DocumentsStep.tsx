import { useState, useCallback } from "react";
import { useSessionStore } from "../../stores/session-store";
import { StepHeader } from "../../components/layout/StepHeader";
import { StepNavigation } from "../../components/layout/StepNavigation";
import { captureDocument, processDocumentCapture } from "../../services/photo-service";
import type { CapturedPhoto, DocumentType } from "../../types/session";
import { DOCUMENT_TYPE_LABELS } from "../../types/session";

export function DocumentsStep() {
  const session = useSessionStore((s) => s.getActiveSession());
  const addDocument = useSessionStore((s) => s.addDocument);
  const removeDocument = useSessionStore((s) => s.removeDocument);
  const setNoDocuments = useSessionStore((s) => s.setNoDocuments);
  const goToStep = useSessionStore((s) => s.goToStep);

  const [pendingPhoto, setPendingPhoto] = useState<CapturedPhoto | null>(null);
  const [selectedType, setSelectedType] = useState<DocumentType>("mtr");
  const [capturing, setCapturing] = useState(false);

  const handleCapture = useCallback(async () => {
    const file = await captureDocument();
    if (!file) return;
    setCapturing(true);
    try {
      const photo = await processDocumentCapture(file);
      setPendingPhoto(photo);
    } finally {
      setCapturing(false);
    }
  }, []);

  const handleAddDocument = () => {
    if (!pendingPhoto) return;
    addDocument({
      photo: pendingPhoto,
      documentType: selectedType,
      label: DOCUMENT_TYPE_LABELS[selectedType],
    });
    setPendingPhoto(null);
    setSelectedType("mtr");
  };

  if (!session) return null;

  const canProceed = session.documents.length > 0 || session.noDocuments;

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      <StepHeader currentStep="STEP_4" onBack={() => goToStep("STEP_3")} />

      <p className="text-sm text-text-secondary">
        Add MTRs, certificates, or other documents. On iPhone, tap{" "}
        <span className="font-medium">Choose Files → Scan Documents</span> to use the
        built-in scanner (recommended; supports multi-page). Or take a photo.
      </p>

      {!session.noDocuments && (
        <>
          <button
            onClick={handleCapture}
            disabled={capturing}
            className="w-full py-4 rounded-xl bg-text text-white font-semibold text-base
                       flex items-center justify-center gap-2
                       active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            {capturing ? "Processing…" : "Add Document"}
          </button>

          {/* Pending photo — choose type */}
          {pendingPhoto && (
            <div className="bg-surface rounded-xl p-4 shadow-sm animate-slide-in flex flex-col gap-3">
              <div className="flex gap-3">
                <img
                  src={pendingPhoto.thumbnailUrl}
                  alt=""
                  className="w-20 h-20 object-cover rounded-lg"
                />
                <div className="flex-1">
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Document Type
                  </label>
                  <select
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value as DocumentType)}
                    className="w-full p-2 rounded-lg border border-border text-base"
                  >
                    {Object.entries(DOCUMENT_TYPE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                onClick={handleAddDocument}
                className="w-full py-3 rounded-lg bg-primary text-white font-medium"
              >
                Add Document
              </button>
            </div>
          )}

          {/* Document list */}
          {session.documents.length > 0 && (
            <div className="flex flex-col gap-2">
              {session.documents.map((doc) => (
                <div
                  key={doc.photo.id}
                  className="bg-surface rounded-xl p-3 shadow-sm flex items-center gap-3"
                >
                  <img
                    src={doc.photo.thumbnailUrl}
                    alt=""
                    className="w-12 h-12 object-cover rounded-lg"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{doc.label}</p>
                  </div>
                  <button
                    onClick={() => removeDocument(doc.photo.id)}
                    className="text-text-secondary text-sm px-2"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* No documents toggle */}
      <label className="flex items-center gap-3 cursor-pointer px-1">
        <input
          type="checkbox"
          checked={session.noDocuments}
          onChange={(e) => setNoDocuments(e.target.checked)}
          className="w-5 h-5 accent-primary"
        />
        <span className="text-sm text-text">No documents included with this shipment</span>
      </label>

      <StepNavigation
        onNext={() => goToStep("STEP_5")}
        nextDisabled={!canProceed}
      >
        {!canProceed && (
          <p className="text-center text-sm text-text-secondary">
            Add documents or mark &ldquo;No documents&rdquo; to continue
          </p>
        )}
      </StepNavigation>
    </div>
  );
}
