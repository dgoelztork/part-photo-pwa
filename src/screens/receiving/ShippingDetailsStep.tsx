import { useEffect, useRef, useState } from "react";
import { useSessionStore } from "../../stores/session-store";
import { StepHeader } from "../../components/layout/StepHeader";
import { StepNavigation } from "../../components/layout/StepNavigation";
import { getUpsRate } from "../../services/api-client";

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
        <Field
          label="Ship From Zip"
          value={sd.shipFromZip}
          onChange={(v) => update({ shipFromZip: v })}
          placeholder="From the shipping label"
        />
        <Field
          label="Weight"
          value={sd.weight}
          onChange={(v) => update({ weight: v })}
          placeholder="e.g., 4.3 LBS"
        />
      </div>

      <UpsRatePanel />

      <StepNavigation onNext={() => goToStep("DOCUMENTS")} />
    </div>
  );
}

/**
 * Auto-fetched UPS parcel rate. Only renders when carrier=UPS and the
 * required label fields (ship-from-zip + weight) are present. Debounces
 * on input change so we don't hammer the proxy while the user types.
 */
function UpsRatePanel() {
  const session = useSessionStore((s) => s.getActiveSession());
  const update = useSessionStore((s) => s.updateShippingDetails);

  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err" | "unavailable">("idle");
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const sd = session?.shippingDetails;
  const carrier = session?.carrier;
  const transp = (sd?.transpCode ?? "").toUpperCase();
  const isUps = carrier === "UPS" || transp.includes("UPS");
  const zip = (sd?.shipFromZip ?? "").match(/\d{5}/)?.[0] ?? "";
  const weightNum = parseFloat((sd?.weight ?? "").match(/(\d+(?:\.\d+)?)/)?.[1] ?? "");
  const speed = sd?.shipSpeed ?? "";

  const eligible = isUps && Boolean(zip) && weightNum > 0;

  useEffect(() => {
    if (!eligible) {
      setStatus("idle");
      return;
    }
    const reqId = ++reqIdRef.current;
    setStatus("loading");
    setError(null);
    const handle = setTimeout(async () => {
      try {
        const result = await getUpsRate({
          originZip: zip,
          weight: String(weightNum),
          shippingSpeed: speed,
        });
        if (reqId !== reqIdRef.current) return; // superseded
        if (!result) {
          setStatus("unavailable");
          update({ freightRate: "", freightRateLabel: "" });
          return;
        }
        const amount = result.negotiatedAmount ?? result.listAmount;
        const tier = result.negotiatedAmount != null ? "negotiated" : "list";
        const label = `UPS ${result.serviceName} (${tier})`;
        setStatus("ok");
        update({
          freightRate: amount.toFixed(2),
          freightRateLabel: label,
        });
      } catch (e) {
        if (reqId !== reqIdRef.current) return;
        setStatus("err");
        setError(e instanceof Error ? e.message : "Rate lookup failed");
        update({ freightRate: "", freightRateLabel: "" });
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [eligible, zip, weightNum, speed, update]);

  if (!isUps) return null;

  return (
    <div className="bg-surface rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-text-secondary">UPS Estimated Rate</span>
        {status === "loading" && (
          <span className="text-xs text-text-secondary animate-pulse">Looking up…</span>
        )}
      </div>

      {!eligible && (
        <p className="text-sm text-text-secondary">
          Need <strong>Ship From Zip</strong> and <strong>Weight</strong> above to look up a rate.
        </p>
      )}

      {eligible && status === "ok" && sd?.freightRate && (
        <div>
          <p className="text-2xl font-semibold text-text">${sd.freightRate}</p>
          <p className="text-xs text-text-secondary">{sd.freightRateLabel}</p>
        </div>
      )}

      {eligible && status === "unavailable" && (
        <p className="text-xs text-text-secondary">
          UPS rating not configured on the proxy.
        </p>
      )}

      {eligible && status === "err" && (
        <p className="text-xs text-error">Couldn't get rate: {error}</p>
      )}
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
