/**
 * FedEx Rate API client — the FedEx twin of ups-rating.ts. Server-to-server
 * OAuth (client_credentials grant) with a cached access token.
 *
 * Unlike UPS, FedEx will not quote without an account number, so all three of
 * FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET / FEDEX_ACCOUNT_NUMBER are required.
 * The API project on developer.fedex.com must be linked to that account.
 *
 * Docs: https://developer.fedex.com/api/en-us/catalog/rate/v1/docs.html
 */

import { stateFromZip } from "./ups-rating.js";

const CLIENT_ID = process.env.FEDEX_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.FEDEX_CLIENT_SECRET ?? "";
const ACCOUNT_NUMBER = process.env.FEDEX_ACCOUNT_NUMBER ?? "";
/** https://apis-sandbox.fedex.com for test keys. */
const BASE_URL = (process.env.FEDEX_BASE_URL ?? "https://apis.fedex.com").replace(/\/$/, "");

export function isFedexConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET && ACCOUNT_NUMBER);
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

  // FedEx takes the client credentials in the form body, not a Basic header.
  const res = await fetch(`${BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`FedEx OAuth failed (${res.status}): ${text}`);
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  return body.access_token;
}

/**
 * Tork's SAP shipping-speed codes (U_ShipSpeed), normalised to bare
 * alphanumerics, mapped to FedEx service types.
 *
 * "1DAY" goes to Priority Overnight: it is FedEx's ordinary next-morning
 * service, and choosing it over the cheaper Standard Overnight errs high
 * rather than low. The label usually says which one it was, and the label's
 * service line wins over the PO code (see BoxPhotoStep), so this only decides
 * when the label didn't.
 */
const SAP_SPEED_CODES: Record<string, string> = {
  GROUND: "FEDEX_GROUND",
  GRD: "FEDEX_GROUND",
  GND: "FEDEX_GROUND",
  "1DAY": "PRIORITY_OVERNIGHT",
  "2DAY": "FEDEX_2_DAY",
  "2DAYAM": "FEDEX_2_DAY_AM",
  "3DAY": "FEDEX_EXPRESS_SAVER",
  EXPRESSSAVER: "FEDEX_EXPRESS_SAVER",
};

/**
 * Map a shipping speed to a FedEx service type. Accepts Tork's SAP codes and
 * the service line printed on a FedEx label ("PRIORITY OVERNIGHT", "FedEx
 * Ground", "2DAY"). Returns null when unknown — same rule as UPS: never guess
 * Ground, because a guessed-cheap rate gets posted to SAP as real freight.
 */
export function shippingSpeedToFedexService(speed: string | null | undefined): string | null {
  const raw = (speed ?? "").trim();
  if (!raw) return null;

  const code = raw.toUpperCase().replace(/[\s_-]+/g, "");
  if (SAP_SPEED_CODES[code]) return SAP_SPEED_CODES[code];

  const s = raw.toLowerCase();
  if (s.includes("first overnight")) return "FIRST_OVERNIGHT";
  if (s.includes("standard overnight")) return "STANDARD_OVERNIGHT";
  if (s.includes("priority overnight") || s.includes("overnight") || s.includes("next day")) {
    return "PRIORITY_OVERNIGHT";
  }
  if (s.includes("2") && (s.includes("day") || s.includes("nd"))) {
    if (s.includes("am")) return "FEDEX_2_DAY_AM";
    return "FEDEX_2_DAY";
  }
  if (s.includes("saver") || (s.includes("3") && s.includes("day"))) return "FEDEX_EXPRESS_SAVER";
  if (s.includes("home delivery")) return "GROUND_HOME_DELIVERY";
  if (s.includes("ground")) return "FEDEX_GROUND";

  return null;
}

const SERVICE_NAMES: Record<string, string> = {
  FEDEX_GROUND: "Ground",
  GROUND_HOME_DELIVERY: "Home Delivery",
  FIRST_OVERNIGHT: "First Overnight",
  PRIORITY_OVERNIGHT: "Priority Overnight",
  STANDARD_OVERNIGHT: "Standard Overnight",
  FEDEX_2_DAY: "2Day",
  FEDEX_2_DAY_AM: "2Day A.M.",
  FEDEX_EXPRESS_SAVER: "Express Saver",
};

export interface FedexRateInput {
  originZip: string;
  destZip: string;
  weightLbs: number;
  serviceType: string;
}

/** Same shape as UpsRateResult so the PWA can treat the two alike. */
export interface FedexRateResult {
  serviceCode: string;
  serviceName: string;
  currency: string;
  /** Published list rate. */
  listAmount: number;
  /** Tork's account rate, when FedEx returns one. */
  negotiatedAmount: number | null;
  billingWeightLbs: number | null;
}

function address(zip: string) {
  const state = stateFromZip(zip);
  return {
    address: {
      postalCode: zip,
      ...(state ? { stateOrProvinceCode: state } : {}),
      countryCode: "US",
    },
  };
}

export async function getFedexRate(input: FedexRateInput): Promise<FedexRateResult> {
  const token = await getAccessToken();

  const body = {
    accountNumber: { value: ACCOUNT_NUMBER },
    requestedShipment: {
      shipper: address(input.originZip),
      recipient: address(input.destZip),
      serviceType: input.serviceType,
      pickupType: "DROPOFF_AT_FEDEX_LOCATION",
      // Ask for both: the published rate (what the app shows, as for UPS)
      // and Tork's own account rate.
      rateRequestType: ["LIST", "ACCOUNT"],
      requestedPackageLineItems: [
        { weight: { units: "LB", value: Number(input.weightLbs.toFixed(1)) } },
      ],
    },
  };

  const res = await fetch(`${BASE_URL}/rate/v1/rates/quotes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-locale": "en_US",
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) {
    const errs = json?.errors;
    const msg = Array.isArray(errs) && errs[0]?.message
      ? `${errs[0].code}: ${errs[0].message}`
      : `FedEx rating failed (${res.status})`;
    throw new Error(msg);
  }

  const reply = json?.output?.rateReplyDetails?.[0];
  const details: Record<string, any>[] = reply?.ratedShipmentDetails ?? [];
  if (details.length === 0) {
    throw new Error("FedEx rating returned no rated shipment");
  }

  const list = details.find((d) => d.rateType === "LIST");
  const account = details.find((d) => d.rateType === "ACCOUNT");
  const listDetail = list ?? account!;
  const weight = listDetail.shipmentRateDetail?.totalBillingWeight?.value;
  const serviceType = reply?.serviceType ?? input.serviceType;

  return {
    serviceCode: serviceType,
    serviceName: SERVICE_NAMES[serviceType] ?? reply?.serviceName ?? serviceType,
    currency: listDetail.currency ?? "USD",
    listAmount: Number(listDetail.totalNetCharge ?? 0),
    negotiatedAmount: account ? Number(account.totalNetCharge) : null,
    billingWeightLbs: weight != null ? Number(weight) : null,
  };
}
