import { useSessionStore } from "../../stores/session-store";
import { StepHeader } from "../../components/layout/StepHeader";
import { StepNavigation } from "../../components/layout/StepNavigation";

export function ShippingDetailsStep() {
  const session = useSessionStore((s) => s.getActiveSession());
  const update = useSessionStore((s) => s.updateShippingDetails);
  const goToStep = useSessionStore((s) => s.goToStep);

  if (!session) return null;

  const sd = session.shippingDetails;

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      <StepHeader currentStep="SHIPPING_DETAILS" onBack={() => goToStep("PACKING_SLIP")} />

      <p className="text-sm text-text-secondary">
        Verify the shipping details from the PO. Edits are saved with the receipt.
      </p>

      <div className="bg-surface rounded-xl p-4 shadow-sm flex flex-col gap-3">
        <Field
          label="Transporter"
          value={sd.transpCode}
          onChange={(v) => update({ transpCode: v })}
          placeholder="UPS / FedEx / LTL / ..."
        />
        <Field
          label="Shipping Speed"
          value={sd.shipSpeed}
          onChange={(v) => update({ shipSpeed: v })}
          placeholder="Ground, Next Day Air, ..."
        />
        <Field
          label="Tracking Number"
          value={sd.frtTracking}
          onChange={(v) => update({ frtTracking: v })}
          placeholder="1Z..."
        />
        <Field
          label="Freight Charge Type"
          value={sd.frtChargeType}
          onChange={(v) => update({ frtChargeType: v })}
          placeholder="Prepaid, Collect, ..."
        />
        <Field
          label="FOB"
          value={sd.fob}
          onChange={(v) => update({ fob: v })}
          placeholder="Origin, Destination, ..."
        />
      </div>

      <StepNavigation onNext={() => goToStep("DOCUMENTS")} />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full p-3 rounded-lg border border-border text-base"
      />
    </label>
  );
}
