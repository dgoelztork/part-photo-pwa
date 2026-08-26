/**
 * Zebra label printer registry + raw ZPL transport.
 *
 * Networked Zebras listen on TCP 9100 and accept ZPL as a plain byte stream —
 * no protocol, no handshake, no response. That simplicity is also the catch:
 * a successful write means "the printer accepted the bytes", NOT "a label came
 * out". Out of labels, head open, or a ribbon fault all look identical to us.
 * Callers must not report a print as confirmed beyond "sent".
 *
 * Printers are configured via the LABEL_PRINTERS env var, a JSON array:
 *   [{"id":"alameda","name":"Alameda Warehouse","host":"192.168.201.50",
 *     "port":9100,"warehouses":["01","01A","2","S","02"]},
 *    {"id":"pascagoula","name":"Pascagoula","host":"100.x.y.z",
 *     "port":9100,"warehouses":["3"]}]
 *
 * NOTE ON SITES: TORK-APP sits on 192.168.201.0/24 with no route to any other
 * private subnet, so an Alameda printer is directly reachable and a Pascagoula
 * one is not. Pascagoula needs a path first — a Tailscale subnet router at the
 * site, or the printer itself on the tailnet. Nothing in this module cares
 * which: `host` is whatever address actually resolves from this box.
 */
import net from "node:net";

export interface LabelPrinter {
  id: string;
  name: string;
  host: string;
  port: number;
  /** SAP warehouse codes this printer serves, so a line routes to its site. */
  warehouses: string[];
}

/** Printer as exposed to the client — same shape minus the network address. */
export interface PublicPrinter {
  id: string;
  name: string;
  warehouses: string[];
}

const SEND_TIMEOUT_MS = 8000;

let cached: LabelPrinter[] | null = null;

function parsePrinters(): LabelPrinter[] {
  const raw = (process.env.LABEL_PRINTERS ?? "").trim();
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[Labels] LABEL_PRINTERS is not valid JSON — no printers configured:", err);
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.error("[Labels] LABEL_PRINTERS must be a JSON array — no printers configured");
    return [];
  }

  const printers: LabelPrinter[] = [];
  for (const entry of parsed as Record<string, any>[]) {
    if (!entry?.id || !entry?.host) {
      console.error("[Labels] Skipping printer entry without id/host:", entry);
      continue;
    }
    printers.push({
      id: String(entry.id),
      name: String(entry.name ?? entry.id),
      host: String(entry.host),
      port: Number(entry.port ?? 9100),
      warehouses: Array.isArray(entry.warehouses) ? entry.warehouses.map(String) : [],
    });
  }
  return printers;
}

export function listPrinters(): LabelPrinter[] {
  if (cached === null) {
    cached = parsePrinters();
    console.log(
      `[Labels] ${cached.length} printer(s) configured: ` +
        (cached.map((p) => `${p.id}(${p.warehouses.join("/") || "any"})`).join(", ") || "none")
    );
  }
  return cached;
}

export function listPublicPrinters(): PublicPrinter[] {
  return listPrinters().map(({ id, name, warehouses }) => ({ id, name, warehouses }));
}

export function getPrinterById(id: string): LabelPrinter | undefined {
  return listPrinters().find((p) => p.id === id);
}

/**
 * Best printer for a warehouse code, or undefined when nothing claims it.
 * Deliberately no fallback to "the first printer" — silently printing an
 * Alameda label in Mississippi is worse than refusing.
 */
export function getPrinterForWarehouse(warehouse: string): LabelPrinter | undefined {
  const code = (warehouse ?? "").trim().toUpperCase();
  if (!code) return undefined;
  return listPrinters().find((p) => p.warehouses.some((w) => w.toUpperCase() === code));
}

/**
 * Write ZPL to a printer over a raw socket. Resolves once the bytes are
 * flushed and the socket closes cleanly; rejects on refusal or timeout.
 */
export function sendZpl(printer: LabelPrinter, zpl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    socket.setTimeout(SEND_TIMEOUT_MS);

    socket.on("timeout", () => {
      finish(
        new Error(
          `Printer ${printer.name} (${printer.host}:${printer.port}) did not respond within ${
            SEND_TIMEOUT_MS / 1000
          }s — check that it is powered on and on the network`
        )
      );
    });

    socket.on("error", (err: NodeJS.ErrnoException) => {
      const hint =
        err.code === "ECONNREFUSED"
          ? " — the address answered but nothing is listening on that port"
          : err.code === "EHOSTUNREACH" || err.code === "ENETUNREACH"
            ? " — no network route from the proxy to that address"
            : err.code === "ETIMEDOUT"
              ? " — no response; the printer may be off or on a different network"
              : "";
      finish(new Error(`Printer ${printer.name} (${printer.host}:${printer.port}): ${err.message}${hint}`));
    });

    socket.connect(printer.port, printer.host, () => {
      // end() writes the payload then sends FIN; "close" confirms the flush.
      socket.end(zpl, "utf8");
    });

    socket.on("close", (hadError) => {
      if (!hadError) finish();
    });
  });
}
