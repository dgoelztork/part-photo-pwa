import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSessionStore } from "../../stores/session-store";
import { BoxPhotoStep } from "./BoxPhotoStep";
import { CarrierStep } from "./CarrierStep";
import { PackingSlipStep } from "./PackingSlipStep";
import { ShippingDetailsStep } from "./ShippingDetailsStep";
import { DocumentsStep } from "./DocumentsStep";
import { LineReceivingStep } from "./LineReceivingStep";
import { ReviewSubmit } from "./ReviewSubmit";

export function ReceivingWizard() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { sessions, resumeSession } = useSessionStore();
  const session = sessions.find((s) => s.id === sessionId);

  useEffect(() => {
    if (sessionId) resumeSession(sessionId);
  }, [sessionId, resumeSession]);

  if (!session) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center p-4 safe-top safe-bottom">
        <p className="text-text-secondary mb-4">Session not found</p>
        <button
          onClick={() => navigate("/")}
          className="text-primary font-medium"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const goHome = () => navigate("/");

  switch (session.status) {
    case "BOX":
      return <BoxPhotoStep onBack={goHome} />;
    case "CARRIER":
      return <CarrierStep />;
    case "PACKING_SLIP":
      return <PackingSlipStep />;
    case "SHIPPING_DETAILS":
      return <ShippingDetailsStep />;
    case "DOCUMENTS":
      return <DocumentsStep />;
    case "LINES":
      return <LineReceivingStep />;
    case "REVIEW":
      return <ReviewSubmit />;
    case "SUBMITTED":
      return (
        <div className="min-h-full flex flex-col items-center justify-center p-4 gap-4 safe-top safe-bottom">
          <div className="text-5xl">&#9989;</div>
          <h2 className="text-xl font-semibold">Session Submitted</h2>
          <button
            onClick={goHome}
            className="text-primary font-medium"
          >
            Back to Dashboard
          </button>
        </div>
      );
    default:
      return <BoxPhotoStep onBack={goHome} />;
  }
}
