# Part Receiving PWA — SAP B1 Service Layer Integration

## Overview

The PWA communicates with SAP Business One through a **Node.js proxy server** running on the internal network alongside the SAP server. The proxy handles SL session management, CORS, request validation, and attachment uploads.

## Proxy Server Design

### Why a Proxy

1. **Network access** — SL is internal-only; iPhones connect via company WiFi. The proxy is reachable on the LAN.
2. **CORS** — SL doesn't serve CORS headers. The proxy adds them.
3. **Session management** — SL uses session cookies with 30-minute timeout. The proxy manages a session pool and re-authenticates transparently.
4. **Security** — SL credentials stay on the server. Mobile devices authenticate via Azure AD token; the proxy validates the token and proxies the request.
5. **Validation** — The proxy can validate GRPO payloads before posting, catching errors before they hit SAP.

### Proxy Endpoints

```
Base URL: https://{internal-server}:3001/api

Authentication:
  POST   /api/auth/login          — Validate Azure AD token, return JWT
  POST   /api/auth/refresh        — Refresh proxy JWT

Purchase Orders:
  GET    /api/po/:poNumber        — Look up PO by DocNum
  GET    /api/po/:poNumber/lines  — Get PO lines with open quantities

Goods Receipt:
  POST   /api/grpo                — Post Goods Receipt PO
  GET    /api/grpo/:docEntry      — Get posted GRPO details

Attachments:
  POST   /api/attachments         — Upload file(s) to SAP attachment folder
  PATCH  /api/grpo/:docEntry/attach — Link attachment to GRPO document
```

### Proxy Auth Flow

```
iPhone PWA                    Proxy Server                SAP Service Layer
    │                              │                              │
    │ POST /api/auth/login         │                              │
    │ { azureToken: "eyJ..." }     │                              │
    │─────────────────────────────►│                              │
    │                              │ Validate Azure AD token      │
    │                              │ (verify signature, tenant,   │
    │                              │  check allowed users list)   │
    │                              │                              │
    │                              │ POST /b1s/v1/Login           │
    │                              │ { CompanyDB, UserName, Pwd } │
    │                              │─────────────────────────────►│
    │                              │◄── B1SESSION cookie ─────────│
    │                              │                              │
    │                              │ Store session in pool        │
    │◄── { jwt: "proxy-token" } ───│                              │
    │                              │                              │
    │ GET /api/po/4500001234       │                              │
    │ Authorization: Bearer {jwt}  │                              │
    │─────────────────────────────►│                              │
    │                              │ GET /b1s/v1/PurchaseOrders   │
    │                              │ Cookie: B1SESSION=xxx        │
    │                              │─────────────────────────────►│
    │                              │◄── PO JSON ──────────────────│
    │◄── PO JSON (filtered) ───────│                              │
```

## Service Layer API Calls

### 1. PO Lookup — `GET PurchaseOrders`

**Request:**
```
GET /b1s/v1/PurchaseOrders?$filter=DocNum eq {poNumber}&$select=DocEntry,DocNum,CardCode,CardName,DocDate,DocumentLines
```

**Response (relevant fields):**
```json
{
  "value": [{
    "DocEntry": 1234,
    "DocNum": 4500001234,
    "CardCode": "V10000",
    "CardName": "Acme Steel Suppliers",
    "DocDate": "2026-03-15",
    "DocumentLines": [
      {
        "LineNum": 0,
        "ItemCode": "M1234567",
        "ItemDescription": "Steel Rod 1/2 inch x 12ft",
        "Quantity": 100,
        "RemainingOpenQuantity": 100,
        "UnitPrice": 12.50,
        "WarehouseCode": "01",
        "UoMCode": "EA"
      },
      {
        "LineNum": 1,
        "ItemCode": "M7654321",
        "ItemDescription": "Steel Plate 4x8 1/4in",
        "Quantity": 50,
        "RemainingOpenQuantity": 25,
        "UnitPrice": 85.00,
        "WarehouseCode": "01",
        "UoMCode": "EA"
      }
    ]
  }]
}
```

**Proxy transforms this into:**
```json
{
  "docEntry": 1234,
  "docNum": 4500001234,
  "vendorCode": "V10000",
  "vendorName": "Acme Steel Suppliers",
  "orderDate": "2026-03-15",
  "lines": [
    {
      "lineNum": 0,
      "itemCode": "M1234567",
      "itemDescription": "Steel Rod 1/2 inch x 12ft",
      "orderedQty": 100,
      "openQty": 100,
      "unitPrice": 12.50,
      "warehouse": "01",
      "uom": "EA"
    }
  ]
}
```

### 2. Post GRPO — `POST PurchaseDeliveryNotes`

**Request body built from receiving session:**
```json
{
  "DocDate": "2026-03-31",
  "CardCode": "V10000",
  "Comments": "Received via Part Receiving PWA by dgoelz@torksystems.com",
  "DocumentLines": [
    {
      "BaseEntry": 1234,
      "BaseLine": 0,
      "BaseType": 22,
      "ItemCode": "M1234567",
      "Quantity": 100,
      "WarehouseCode": "01"
    },
    {
      "BaseEntry": 1234,
      "BaseLine": 1,
      "BaseType": 22,
      "ItemCode": "M7654321",
      "Quantity": 20,
      "WarehouseCode": "01"
    }
  ]
}
```

**Key fields:**
- `BaseEntry`: DocEntry of the source PO
- `BaseLine`: Line number from the PO
- `BaseType`: 22 = Purchase Order
- Only include lines where `receivedQty > 0`
- Quantities must not exceed `RemainingOpenQuantity`

**Response:**
```json
{
  "DocEntry": 5678,
  "DocNum": 200001234
}
```

### 3. Attachments — `Attachments2`

SAP B1 uses a two-step process for attachments:

**Step 1: Upload file to attachment folder**
```
POST /b1s/v1/Attachments2
Content-Type: multipart/form-data

--boundary
Content-Disposition: form-data; name="files"; filename="box_001.jpg"
Content-Type: image/jpeg

{binary data}
--boundary--
```

Response returns `AbsoluteEntry` (attachment ID).

**Step 2: Link attachment to GRPO**
```
PATCH /b1s/v1/PurchaseDeliveryNotes({docEntry})
{
  "AttachmentEntry": {absoluteEntry}
}
```

**Note:** SL allows one `AttachmentEntry` per document, but that entry can contain multiple files (lines). For multiple files, you create one attachment entry with multiple lines:

```
POST /b1s/v1/Attachments2
{
  "Attachments2_Lines": [
    {
      "SourcePath": "/tmp/receiving",
      "FileName": "box_001",
      "FileExtension": "jpg",
      "Override": "tNO"
    },
    {
      "SourcePath": "/tmp/receiving",
      "FileName": "label_001",
      "FileExtension": "jpg",
      "Override": "tNO"
    }
  ]
}
```

The proxy server handles:
1. Receiving all photos from the PWA
2. Saving them to a temp directory accessible by the SL attachment path
3. Creating the Attachments2 entry with all file lines
4. Linking to the GRPO

### 4. Batch Operations

SL supports `$batch` for multiple operations. Useful for posting GRPO + attachments atomically:

```
POST /b1s/v1/$batch
Content-Type: multipart/mixed; boundary=batch

--batch
Content-Type: application/http

POST /b1s/v1/PurchaseDeliveryNotes
{GRPO body}

--batch
Content-Type: application/http

POST /b1s/v1/Attachments2
{attachment body}

--batch--
```

Consider using batch for the final submission to reduce round trips and improve atomicity.

## Proxy Implementation Notes

### Session Pool

```typescript
interface SLSession {
  sessionId: string;     // B1SESSION cookie value
  routeId: string;       // ROUTEID cookie value (if load balanced)
  createdAt: number;
  lastUsedAt: number;
  companyDb: string;
}

class SLSessionManager {
  private sessions: Map<string, SLSession> = new Map();
  private readonly TIMEOUT_MS = 25 * 60 * 1000; // 25 min (SL default is 30)

  async getSession(): Promise<SLSession> {
    // Return valid session or create new one
    // Re-login if session expired
    // Handle 401 responses by re-authenticating
  }
}
```

### Error Handling

| SL Error | Proxy Response | PWA Action |
|---|---|---|
| 401 Unauthorized | Re-authenticate, retry once | Transparent to user |
| 404 (PO not found) | `{ error: "PO_NOT_FOUND" }` | Show "PO not found" message |
| -2028 (qty exceeds open) | `{ error: "QTY_EXCEEDS_OPEN", details: {...} }` | Show specific line error |
| -10 (document locked) | `{ error: "DOC_LOCKED" }` | "Document is being edited, try again" |
| -5002 (invalid data) | `{ error: "VALIDATION_ERROR", message: "..." }` | Show SAP error message |
| Network timeout | 504 Gateway Timeout | "Cannot reach SAP, check connection" |

### Proxy Configuration

```env
# .env for proxy server
SAP_SL_URL=https://sapserver:50000/b1s/v1
SAP_COMPANY_DB=TORK_PROD
SAP_USERNAME=api_receiving
SAP_PASSWORD=***
AZURE_TENANT_ID=6dea7009-0c2d-49ce-9887-fb702c17447c
AZURE_CLIENT_ID=8d67b410-ec72-469c-ab0a-3b4c60ee8738
CORS_ORIGIN=https://receiving.torksystems.local
JWT_SECRET=***
PORT=3001
```

## Data Mapping: Session → GRPO

```
Receiving Session                    SAP GRPO Document
─────────────────                    ──────────────────
session.poData.vendorCode        →   CardCode
session.poData.docEntry          →   DocumentLines[].BaseEntry
today's date                     →   DocDate
user email + session notes       →   Comments

Per line:
  line.lineNum                   →   DocumentLines[].BaseLine
  22 (Purchase Order)            →   DocumentLines[].BaseType
  line.itemCode                  →   DocumentLines[].ItemCode
  line.receivedQty               →   DocumentLines[].Quantity
  line.warehouse                 →   DocumentLines[].WarehouseCode

Post-submission:
  All photos (all steps)         →   Attachments2 → linked via AttachmentEntry
  Session metadata               →   UDF fields (if configured)
```

## User-Defined Fields (Optional)

If you want to store additional receiving metadata on the GRPO in SAP, add UDFs:

| UDF Name | Type | Purpose |
|---|---|---|
| `U_RecvSessionId` | Alphanumeric(36) | Links back to PWA session |
| `U_RecvUser` | Alphanumeric(100) | Azure AD email of receiver |
| `U_BoxDamaged` | Alphanumeric(1) | Y/N flag |
| `U_CarrierName` | Alphanumeric(50) | From shipping label |
| `U_TrackingNum` | Alphanumeric(100) | From shipping label |
| `U_OneDrivePath` | Alphanumeric(254) | Path to photo folder in OneDrive |

These are set in the GRPO POST body:
```json
{
  "U_RecvSessionId": "abc-123-def",
  "U_RecvUser": "dgoelz@torksystems.com",
  "U_BoxDamaged": "N",
  "U_CarrierName": "FedEx",
  "U_TrackingNum": "7489274892748",
  "U_OneDrivePath": "/Receiving/2026-03-31/PO-4500001234/"
}
```
