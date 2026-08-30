import commercialV2 from "./router-owner-commercial-v2";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface Env { DB: D1Database; [key:string]: unknown; }

const SARS_TAX_NUMBER = "9759031207";
const SARS_REGISTERED_ADDRESS = "109 Madala Street, Kwazanele, Breyten, Mpumalanga, 2330";

let profilePromise: Promise<void> | null = null;
async function ensureOfficialCommercialProfile(env: Env) {
  if (profilePromise) return profilePromise;
  profilePromise = (async () => {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS owner_commercial_profile_v3 (
      id INTEGER PRIMARY KEY CHECK(id=1),
      tax_number TEXT,
      residential_address TEXT,
      updated_at TEXT NOT NULL
    )`).run();
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO owner_commercial_profile_v3(id,tax_number,residential_address,updated_at)
      VALUES(1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        tax_number=CASE WHEN tax_number IS NULL OR trim(tax_number)='' THEN excluded.tax_number ELSE tax_number END,
        residential_address=CASE WHEN residential_address IS NULL OR trim(residential_address)='' THEN excluded.residential_address ELSE residential_address END,
        updated_at=CASE WHEN (tax_number IS NULL OR trim(tax_number)='' OR residential_address IS NULL OR trim(residential_address)='') THEN excluded.updated_at ELSE updated_at END`).bind(
          SARS_TAX_NUMBER,
          SARS_REGISTERED_ADDRESS,
          now
        ).run();
  })().catch((e) => { profilePromise = null; throw e; });
  return profilePromise;
}

async function polishCommercialText(res: Response) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return res;
  let body = await res.text();
  body = body.replaceAll("Residential / Business Address", "Registered / Business Address");
  body = body.replaceAll("Residential / business address", "Registered / business address");
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.set("cache-control", "private, no-store");
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await ensureOfficialCommercialProfile(env);
    const res = await commercialV2.fetch(request, env as never, ctx);
    return polishCommercialText(res);
  },
};
