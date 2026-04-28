import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You extract structured data from photographs of shipping labels.

The label may be from FedEx, UPS, USPS, DHL, OnTrac, a freight carrier (R+L, Old Dominion, etc.), or a vendor's own label. Extract only the fields specified in the tool. Use null for any field not clearly visible or unreadable in the image. Do not guess. Do not infer. If the carrier is unclear, return null.

Return your answer by calling the extract_shipping_info tool exactly once.`;

export interface ShippingLabelExtraction {
  carrier: string | null;
  trackingNumber: string | null;
  weight: string | null;
  shipFrom: string | null;
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
                "Weight as printed, including units, e.g. '5.2 LBS', '12 oz', '2.4 kg'. Null if not visible.",
            },
            shipFrom: {
              type: ["string", "null"],
              description:
                "Sender identifier — company name and/or city/state. One short line. Null if not visible.",
            },
          },
          required: ["carrier", "trackingNumber", "weight", "shipFrom"],
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
