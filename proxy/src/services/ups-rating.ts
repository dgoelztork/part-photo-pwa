/**
 * UPS Rating API client. Server-to-server OAuth (client_credentials grant)
 * with a cached access token. Returns negotiated rates when an account number
 * is configured, else published list rates.
 *
 * Docs: https://developer.ups.com/api/reference/rating
 */

const CLIENT_ID = process.env.UPS_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.UPS_CLIENT_SECRET ?? "";
const ACCOUNT_NUMBER = process.env.UPS_ACCOUNT_NUMBER ?? "";
const BASE_URL = (process.env.UPS_BASE_URL ?? "https://onlinetools.ups.com").replace(/\/$/, "");
/**
 * Default destination zip used when the request body doesn't supply one.
 * Also used as the Shipper.PostalCode in every rate request — i.e., the
 * account-holder's billing zip — so it stays static even when receipts roll
 * out to other warehouses with different ship-to zips.
 */
const DEFAULT_DEST_ZIP = process.env.UPS_DEST_ZIP ?? "";

export function isUpsConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export function getDefaultDestZip(): string {
  return DEFAULT_DEST_ZIP;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.accessToken;
  }

  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE_URL}/security/v1/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`UPS OAuth failed (${res.status}): ${text}`);
  }

  const body = (await res.json()) as { access_token: string; expires_in: string | number };
  const ttlSec = typeof body.expires_in === "string" ? parseInt(body.expires_in, 10) : body.expires_in;
  tokenCache = {
    accessToken: body.access_token,
    expiresAt: Date.now() + ttlSec * 1000,
  };
  return body.access_token;
}

/** Map a free-text shipping speed (from label OCR) to a UPS service code. */
export function shippingSpeedToServiceCode(speed: string | null | undefined): string {
  const s = (speed ?? "").toLowerCase();
  if (!s) return "03"; // Ground default
  if (s.includes("next day") || s.includes("overnight")) {
    if (s.includes("early")) return "14"; // Next Day Air Early
    if (s.includes("saver")) return "13"; // Next Day Air Saver
    return "01"; // Next Day Air
  }
  if (s.includes("2") && (s.includes("day") || s.includes("nd"))) {
    if (s.includes("am")) return "59"; // 2nd Day Air A.M.
    return "02"; // 2nd Day Air
  }
  if (s.includes("3") && s.includes("day")) return "12"; // 3 Day Select
  if (s.includes("saver")) return "13";
  if (s.includes("express")) return "07"; // UPS Worldwide Express (international)
  return "03"; // Ground
}

const SERVICE_NAMES: Record<string, string> = {
  "01": "Next Day Air",
  "02": "2nd Day Air",
  "03": "Ground",
  "07": "Worldwide Express",
  "08": "Worldwide Expedited",
  "11": "Standard",
  "12": "3 Day Select",
  "13": "Next Day Air Saver",
  "14": "Next Day Air Early",
  "54": "Worldwide Express Plus",
  "59": "2nd Day Air A.M.",
  "65": "Saver",
};

export interface UpsRateInput {
  originZip: string;
  destZip: string;
  weightLbs: number;
  serviceCode: string;
}

export interface UpsRateResult {
  serviceCode: string;
  serviceName: string;
  currency: string;
  /** Published list rate. */
  listAmount: number;
  /** Negotiated rate when account number is provided; null otherwise. */
  negotiatedAmount: number | null;
  /** Billing weight UPS returned (after dim-weight calc, if any). */
  billingWeightLbs: number | null;
}

/**
 * Build a minimal Rating request. We don't have package dimensions, so UPS
 * will use actual weight (no dim-weight billing). Address blocks are
 * intentionally minimal — postal code + country is sufficient for parcel rate.
 */
function buildRateRequest(input: UpsRateInput) {
  // Shipper = account-holder zip (stays static across warehouses).
  // ShipTo  = destination warehouse zip from the request (label OCR or user-edited).
  const shipperZip = DEFAULT_DEST_ZIP || input.destZip;
  const shipper = {
    Address: {
      PostalCode: shipperZip,
      CountryCode: "US",
    },
    ...(ACCOUNT_NUMBER ? { ShipperNumber: ACCOUNT_NUMBER } : {}),
  };
  const shipFrom = {
    Address: {
      PostalCode: input.originZip,
      CountryCode: "US",
    },
  };
  const shipTo = {
    Address: {
      PostalCode: input.destZip,
      CountryCode: "US",
    },
  };

  return {
    RateRequest: {
      Request: {
        SubVersion: "2403",
        TransactionReference: { CustomerContext: "receiving-proxy" },
      },
      Shipment: {
        Shipper: shipper,
        ShipTo: shipTo,
        ShipFrom: shipFrom,
        Service: { Code: input.serviceCode },
        Package: [
          {
            PackagingType: { Code: "02" }, // Customer Supplied Package
            PackageWeight: {
              UnitOfMeasurement: { Code: "LBS" },
              Weight: input.weightLbs.toFixed(1),
            },
          },
        ],
        ...(ACCOUNT_NUMBER
          ? { ShipmentRatingOptions: { NegotiatedRatesIndicator: "Y" } }
          : {}),
      },
    },
  };
}

export async function getUpsRate(input: UpsRateInput): Promise<UpsRateResult> {
  const token = await getAccessToken();
  const body = buildRateRequest(input);

  const res = await fetch(`${BASE_URL}/api/rating/v2403/Rate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      transId: `recv-${Date.now()}`,
      transactionSrc: "receiving-proxy",
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) {
    const errs = json?.response?.errors;
    const msg = Array.isArray(errs) && errs[0]?.message
      ? `${errs[0].code}: ${errs[0].message}`
      : `UPS rating failed (${res.status})`;
    throw new Error(msg);
  }

  const shipment = json?.RateResponse?.RatedShipment;
  if (!shipment) {
    throw new Error("UPS rating returned no RatedShipment");
  }

  const total = shipment.TotalCharges ?? {};
  const negotiated = shipment.NegotiatedRateCharges?.TotalCharge ?? null;
  const billingWeight = shipment.BillingWeight?.Weight ?? null;
  const serviceCode = shipment.Service?.Code ?? input.serviceCode;

  return {
    serviceCode,
    serviceName: SERVICE_NAMES[serviceCode] ?? serviceCode,
    currency: total.CurrencyCode ?? "USD",
    listAmount: parseFloat(total.MonetaryValue ?? "0"),
    negotiatedAmount: negotiated ? parseFloat(negotiated.MonetaryValue) : null,
    billingWeightLbs: billingWeight ? parseFloat(billingWeight) : null,
  };
}
