import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You extract structured data from photographs of shipping labels.

The label may be from FedEx, UPS, USPS, DHL, OnTrac, a freight carrier (R+L, Old Dominion, etc.), or a vendor's own label. Extract only the fields specified in the tool. Use null for any field not clearly visible or unreadable in the image. Do not guess. Do not infer. If the carrier is unclear, return null.

Return your answer by calling the extract_shipping_info tool exactly once.`;

export interface ShippingLabelExtraction {
  carrier: string | null;
  trackingNumber: string | null;
  weight: string | null;
  shipFrom: string | null;
  shippingSpeed: string | null;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export function isVisionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Extract shipping label fields from a JPEG/PNG image (base64-encoded, no data URL prefix). */
export async function extractShippingLabel(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"
): Promise<ShippingLabelExtraction> {
  const response = await getClient().messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      {
        name: "extract_shipping_info",
        description: "Record the shipping label fields you read from the image.",
        // strict mode guarantees the tool input matches the schema exactly
        // (additionalProperties:false, every required field present, types enforced).
        // Without strict, the model can occasionally drop fields or add extras.
        strict: true,
        input_schema: {
          type: "object",
          properties: {
            carrier: {
              type: ["string", "null"],
              description:
                "Carrier name as written on the label, e.g. 'FedEx', 'UPS', 'USPS', 'DHL'. Null if not clearly identifiable.",
            },
            trackingNumber: {
              type: ["string", "null"],
              description:
                "The tracking number, exactly as printed (no spaces). Null if not visible.",
            },
            weight: {
              type: ["string", "null"],
              description:
                "Weight in POUNDS only, formatted as a number followed by ' LBS' (e.g. '5.2 LBS'). " +
                "If the label shows a different unit, convert: 1 kg = 2.205 LBS, 16 oz = 1 LBS. " +
                "Round to one decimal place. Null if not visible.",
            },
            shipFrom: {
              type: ["string", "null"],
              description:
                "Sender's 5-digit US ZIP code (or ZIP+4) from the ship-from address block. " +
                "Just the ZIP digits, no city/state/company name. Examples: '90210', '10001-1234'. " +
                "Null if no ZIP is visible. International postal codes also acceptable if no US ZIP exists.",
            },
            shippingSpeed: {
              type: ["string", "null"],
              description:
                "Service level / shipping speed as printed on the label. Examples: 'Ground', " +
                "'2-Day', 'Next Day Air', 'Priority Overnight', 'Standard Overnight', 'Express Saver', " +
                "'Priority Mail', 'First Class'. Use the exact phrase from the label. Null if not visible.",
            },
          },
          required: ["carrier", "trackingNumber", "weight", "shipFrom", "shippingSpeed"],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: { type: "tool", name: "extract_shipping_info" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          {
            type: "text",
            text: "Extract the shipping label fields from this image.",
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!toolUse) {
    throw new Error("Model did not call the extraction tool");
  }
  return toolUse.input as ShippingLabelExtraction;
}

const TRANSCRIBE_SYSTEM = `You transcribe documents from photographs for archival search.

Output rules:
- Return only the visible text from the image, top-to-bottom, left-to-right.
- Preserve line breaks where they appear on the page.
- Include all text: labels, addresses, numbers, dates, reference codes, fine print.
- For barcodes you can read, write "[barcode: <value>]"; for ones you can't, write "[barcode]".
- For signatures or illegible marks, write "[signature]" or "[illegible]".
- Handle any orientation — the document may be rotated.
- Do not add commentary, summaries, descriptions, or markdown formatting.
- Output is plain text only.`;

/** Extract a flat text transcription of a document image, suitable for embedding as a hidden PDF text layer. */
export async function transcribeDocument(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"
): Promise<string> {
  const response = await getClient().messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4096,
    system: [
      { type: "text", text: TRANSCRIBE_SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: "Transcribe this document." },
        ],
      },
    ],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text;
}
