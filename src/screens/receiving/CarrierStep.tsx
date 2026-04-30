import { useSessionStore } from "../../stores/session-store";
import { StepHeader } from "../../components/layout/StepHeader";
import { StepNavigation } from "../../components/layout/StepNavigation";
import type { Carrier } from "../../types/session";

interface CarrierOption {
  id: Carrier;
  label: string;
  // Tailwind classes — selected and unselected. Each carrier gets its
  // signature brand color when picked.
  selectedClass: string;
  unselectedClass: string;
}

const OPTIONS: CarrierOption[] = [
  {
    id: "UPS",
    label: "UPS",
    selectedClass: "bg-amber-800 text-white border-amber-900",
    unselectedClass: "bg-amber-50 text-amber-900 border-amber-200",
  },
  {
    id: "FedEx",
    label: "FedEx",
    selectedClass: "bg-purple-700 text-white border-purple-800",
    unselectedClass: "bg-purple-50 text-purple-900 border-purple-200",
  },
  {
    id: "LTL",
    label: "LTL",
    selectedClass: "bg-blue-700 text-white border-blue-800",
    unselectedClass: "bg-blue-50 text-blue-900 border-blue-200",
  },
  {
    id: "Other",
    label: "Other",
    selectedClass: "bg-gray-700 text-white border-gray-800",
    unselectedClass: "bg-gray-100 text-gray-900 border-gray-300",
  },
];

export function CarrierStep() {
  const session = useSessionStore((s) => s.getActiveSession());
  const setCarrier = useSessionStore((s) => s.setCarrier);
  const goToStep = useSessionStore((s) => s.goToStep);

  if (!session) return null;

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      <StepHeader currentStep="CARRIER" onBack={() => goToStep("BOX")} />

      <p className="text-sm text-text-secondary">
        Which carrier delivered this shipment?
      </p>

      <div className="grid grid-cols-2 gap-3 mt-2">
        {OPTIONS.map((opt) => {
          const isSelected = session.carrier === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setCarrier(opt.id)}
              className={`aspect-square rounded-2xl border-2 font-bold text-2xl
                          active:scale-[0.98] transition-transform
                          ${isSelected ? opt.selectedClass : opt.unselectedClass}`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <StepNavigation
        onNext={() => goToStep("PACKING_SLIP")}
        nextDisabled={!session.carrier}
      >
        {!session.carrier && (
          <p className="text-center text-sm text-text-secondary">
            Select a carrier to continue
          </p>
        )}
      </StepNavigation>
    </div>
  );
}
