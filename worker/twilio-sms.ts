export interface TwilioSmsEnv {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  TWILIO_MESSAGING_SERVICE_SID?: string;
}

export type SmsSendResult = {
  status: "sent" | "failed" | "not-configured";
  providerId: string;
  error: string;
  to: string;
};

function txt(v: unknown, max = 500) {
  return String(v ?? "").trim().slice(0, max);
}

export function normalizePhone(value: unknown) {
  let raw = txt(value, 80).replace(/[\s().-]/g, "");
  if (!raw) return "";
  if (raw.startsWith("00")) raw = `+${raw.slice(2)}`;
  if (raw.startsWith("0")) raw = `+27${raw.slice(1)}`;
  else if (raw.startsWith("27")) raw = `+${raw}`;
  if (!raw.startsWith("+")) return "";
  const digits = raw.slice(1);
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : "";
}

export function smsConfigured(env: TwilioSmsEnv) {
  return Boolean(
    txt(env.TWILIO_ACCOUNT_SID) &&
      txt(env.TWILIO_AUTH_TOKEN) &&
      (txt(env.TWILIO_FROM_NUMBER) || txt(env.TWILIO_MESSAGING_SERVICE_SID)),
  );
}

export async function sendTwilioSms(
  env: TwilioSmsEnv,
  toValue: unknown,
  bodyValue: unknown,
): Promise<SmsSendResult> {
  const to = normalizePhone(toValue);
  if (!to)
    return {
      status: "failed",
      providerId: "",
      error: "Invalid SMS phone number. Use an international number such as +27821234567.",
      to: "",
    };

  const sid = txt(env.TWILIO_ACCOUNT_SID, 80);
  const token = txt(env.TWILIO_AUTH_TOKEN, 200);
  const from = normalizePhone(env.TWILIO_FROM_NUMBER);
  const messagingServiceSid = txt(env.TWILIO_MESSAGING_SERVICE_SID, 80);
  if (!sid || !token || (!from && !messagingServiceSid))
    return {
      status: "not-configured",
      providerId: "",
      error:
        "Twilio SMS is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and either TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID.",
      to,
    };

  const body = txt(bodyValue, 1200);
  if (!body)
    return { status: "failed", providerId: "", error: "SMS body is empty.", to };

  const form = new URLSearchParams();
  form.set("To", to);
  form.set("Body", body);
  if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
  else form.set("From", from);

  try {
    const auth = btoa(`${sid}:${token}`);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: form.toString(),
      },
    );
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok)
      return {
        status: "sent",
        providerId: txt(data.sid, 120),
        error: "",
        to,
      };
    return {
      status: "failed",
      providerId: "",
      error: txt(data.message || data.detail || `Twilio returned HTTP ${res.status}`, 600),
      to,
    };
  } catch (error) {
    return {
      status: "failed",
      providerId: "",
      error: error instanceof Error ? error.message : String(error),
      to,
    };
  }
}

export async function sendTwilioSmsMany(
  env: TwilioSmsEnv,
  recipients: unknown[],
  body: unknown,
) {
  const unique = [...new Set(recipients.map(normalizePhone).filter(Boolean))].slice(0, 10);
  const results: SmsSendResult[] = [];
  for (const to of unique) results.push(await sendTwilioSms(env, to, body));
  return results;
}
