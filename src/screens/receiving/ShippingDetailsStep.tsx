import { useEffect, useRef, useState } from "react";
import { useSessionStore } from "../../stores/session-store";
import { StepHeader } from "../../components/layout/StepHeader";
import { StepNavigation } from "../../components/layout/StepNavigation";
import { getUpsRate } from "../../services/api-client";
import { TailscaleHint } from "../../components/TailscaleHint";
import type { ShippingBox } from "../../types/session";

export function ShippingDetailsStep() {
  const session = useSessionStore((s) => s.getActiveSession());
  const update = useSessionStore((s) => s.updateShippingDetails);
  const updateShippingBox = useSessionStore((s) => s.updateShippingBox);
  const goToStep = useSessionStore((s) => s.goToStep);

  if (!session) return null;

  const sd = session.shippingDetails;
  const totalFreight = session.boxes.reduce((sum, b) => {
    const n = parseFloat(b.freightRate);
    return isFinite(n) ? sum + n : sum;
  }, 0);

  return (
    <div className="min-h-full flex flex-col gap-4 p-4 max-w-lg mx-auto safe-top safe-bottom">
      <StepHeader currentStep="SHIPPING_DETAILS" onBack={() => goToStep("PACKING_SLIP")} />

      <p className="text-sm text-text-secondary">
        Verify shipment-level details and each box's tracking, weight, and origin. Edits are saved with the receipt.
      </p>

      {/* Shipment-wide details */}
      <div className="bg-surface rounded-xl p-4 shadow-sm flex flex-col gap-3">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          Shipment
        </p>
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
          label="Ship To Zip"
          value={sd.shipToZip}
          onChange={(v) => update({ shipToZip: v })}
          placeholder="Receiving warehouse zip"
        />
      </div>

      {/* Per-box list */}
      {session.boxes.map((b, i) => (
        <BoxCard
          key={b.id}
          index={i}
          box={b}
          onChange={(updates) => updateShippingBox(b.id, updates)}
        />
      ))}

      {/* Total freight */}
      {session.boxes.length > 1 && totalFreight > 0 && (
        <div className="bg-surface rounded-xl p-4 shadow-sm flex items-center justify-between">
          <span className="text-sm font-medium text-text-secondary">
            Total Freight ({session.boxes.length} boxes)
          </span>
          <span className="text-2xl font-semibold text-text">${totalFreight.toFixed(2)}</span>
        </div>
      )}

      <StepNavigation onNext={() => goToStep("DOCUMENTS")} />
    </div>
  );
}

/**
 * One editable box card with its own UPS rate lookup. Inputs are debounced
 * via the inner UpsRateRow so we don't hammer the proxy while typing.
 */
function BoxCard({
  index,
  box,
  onChange,
}: {
  index: number;
  box: ShippingBox;
  onChange: (updates: Partial<ShippingBox>) => void;
}) {
  return (
    <div className="bg-surface rounded-xl p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          Box {index + 1}
        </p>
        {box.noLabel && (
          <span className="text-xs text-text-secondary italic">No label captured</span>
        )}
      </div>
      <Field
        label="Tracking Number"
        value={box.trackingNumber}
        onChange={(v) => onChange({ trackingNumber: v })}
        placeholder="1Z..."
      />
      <Field
        label="Weight"
        value={box.weight}
        onChange={(v) => onChange({ weight: v })}
        placeholder="e.g., 4.3 LBS"
      />
      <Field
        label="Ship From Zip"
        value={box.shipFromZip}
        onChange={(v) => onChange({ shipFromZip: v })}
        placeholder="From the shipping label"
      />
      <UpsRateRow box={box} onChange={onChange} />
    </div>
  );
}

/**
 * Per-box UPS rate. Watches the box's weight/origin/dest/speed (dest +
 * speed come from session.shippingDetails) and re-fetches when any change.
 */
function UpsRateRow({
  box,
  onChange,
}: {
  box: ShippingBox;
  onChange: (updates: Partial<ShippingBox>) => void;
}) {
  const session = useSessionStore((s) => s.getActiveSession());
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err" | "unavailable">("idle");
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const sd = session?.shippingDetails;
  const carrier = session?.carrier;
  const transp = (sd?.transpCode ?? "").toUpperCase();
  const isUps = carrier === "UPS" || transp.includes("UPS");
  const originZip = (box.shipFromZip ?? "").match(/\d{5}/)?.[0] ?? "";
  const destZip = (sd?.shipToZip ?? "").match(/\d{5}/)?.[0] ?? "";
  const weightNum = parseFloat((box.weight ?? "").match(/(\d+(?:\.\d+)?)/)?.[1] ?? "");
  const speed = sd?.shipSpeed ?? "";

  const eligible = isUps && Boolean(originZip) && Boolean(destZip) && weightNum > 0;

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
          originZip,
          destZip,
          weight: String(weightNum),
          shippingSpeed: speed,
        });
        if (reqId !== reqIdRef.current) return;
        if (!result) {
          setStatus("unavailable");
          onChange({ freightRate: "", freightRateLabel: "" });
          return;
        }
        const amount = result.listAmount;
        const label = `UPS ${result.serviceName} (list)`;
        setStatus("ok");
        onChange({ freightRate: amount.toFixed(2), freightRateLabel: label });
      } catch (e) {
        if (reqId !== reqIdRef.current) return;
        setStatus("err");
        setError(e instanceof Error ? e.message : "Rate lookup failed");
        onChange({ freightRate: "", freightRateLabel: "" });
      }
    }, 400);
    return () => clearTimeout(handle);
    // onChange identity changes per render — exclude it from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, originZip, destZip, weightNum, speed]);

  if (!isUps) return null;

  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-text-secondary">UPS Rate</span>
        {status === "loading" && (
          <span className="text-xs text-text-secondary animate-pulse">Looking up…</span>
        )}
      </div>

      {!eligible && (
        <p className="text-xs text-text-secondary">
          Need weight, origin ZIP (above), and shipment ship-to-zip to look up a rate.
        </p>
      )}

      {eligible && status === "ok" && box.freightRate && (
        <div>
          <p className="text-2xl font-semibold text-text">${box.freightRate}</p>
          <p className="text-xs text-text-secondary">{box.freightRateLabel}</p>
        </div>
      )}

      {eligible && status === "unavailable" && (
        <p className="text-xs text-text-secondary">UPS rating not configured on the proxy.</p>
      )}

      {eligible && status === "err" && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200">
          <p className="text-xs text-error">Couldn't get rate: {error}</p>
          <TailscaleHint />
        </div>
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
