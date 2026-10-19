import type { FeedbackRow } from "./feedback-store.js";

/**
 * Email a new feedback report to whoever looks after the app.
 *
 * Without this a report just sat in the database until someone happened to
 * open the feedback board: Gabriel's first one (19 Oct 2026) went unnoticed.
 * Sends through Microsoft Graph as the app itself (client credentials), the
 * same setup the nightly health check uses. Off unless every setting is there.
 */

/** Graph rejects a sendMail body much over 4 MB; leave room for the rest. */
const MAX_ATTACH_CHARS = 3_000_000;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function settings() {
  const tenant = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const secret = process.env.GRAPH_CLIENT_SECRET;
  const to = process.env.FEEDBACK_NOTIFY_EMAIL;
  const from = process.env.FEEDBACK_FROM_MAILBOX ?? "sourcing@torksystems.com";
  if (!tenant || !clientId || !secret || !to) return null;
  return { tenant, clientId, secret, to, from };
}

/** Never throws: a report is already saved, and email is only a heads-up. */
export async function sendFeedbackMail(row: FeedbackRow, photoDataUrl: string | null): Promise<void> {
  const cfg = settings();
  if (!cfg) return;
  try {
    const tokRes = await fetch(`https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.secret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokRes.ok) throw new Error(`token ${tokRes.status}`);
    const { access_token } = (await tokRes.json()) as { access_token: string };

    const photo = photoDataUrl ? /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(photoDataUrl) : null;
    const attachPhoto = photo !== null && photo[2].length <= MAX_ATTACH_CHARS;
    const photoNote = photo
      ? attachPhoto
        ? "Photo attached."
        : "A photo came with it but is too large to attach; open the feedback board to see it."
      : "No photo.";

    const kind = row.kind === "bug" ? "Problem" : "Idea";
    const html = `
<div style="font-family:Segoe UI,system-ui,Arial,sans-serif;font-size:14px;color:#16324f">
  <h2 style="margin:0 0 8px">Receiving app — new ${kind.toLowerCase()} report #${row.id}</h2>
  <p style="margin:0 0 4px"><b>From:</b> ${escapeHtml(row.userEmail ?? "unknown")}</p>
  <p style="margin:0 0 4px"><b>Screen:</b> ${escapeHtml(row.page ?? "/")}</p>
  <p style="margin:0 0 12px"><b>When:</b> ${escapeHtml(row.createdAt)} (UTC)</p>
  <p style="margin:0 0 4px;font-size:16px"><b>${escapeHtml(row.title)}</b></p>
  ${row.body ? `<p style="margin:0 0 12px;white-space:pre-wrap">${escapeHtml(row.body)}</p>` : ""}
  <p style="margin:12px 0 0;color:#555">${photoNote}</p>
</div>`;

    const message: Record<string, unknown> = {
      subject: `Receiving app ${kind.toLowerCase()} from ${row.userEmail ?? "unknown"}: ${row.title}`.slice(0, 250),
      body: { contentType: "HTML", content: html },
      toRecipients: cfg.to.split(",").map((a) => ({ emailAddress: { address: a.trim() } })),
    };
    if (attachPhoto && photo) {
      const ext = photo[1].split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
      message.attachments = [
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: `feedback-${row.id}.${ext}`,
          contentType: photo[1],
          contentBytes: photo[2],
        },
      ];
    }

    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.from)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message, saveToSentItems: false }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`sendMail ${res.status} ${(await res.text()).slice(0, 200)}`);
    console.log(`[Feedback] #${row.id} emailed to ${cfg.to}`);
  } catch (err) {
    console.error(`[Feedback] #${row.id} saved but the email failed:`, err instanceof Error ? err.message : err);
  }
}
