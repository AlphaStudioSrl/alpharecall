import { useState, useEffect, useCallback, useRef } from "react";
import { getGatedItem, setGatedItem, writeConsent } from "@/lib/consent-storage";
import { fetchWithProofOfWork } from "@/lib/pow-fetch";

interface WpUser {
  wp_user_id: number;
  user_email: string;
  display_name: string;
  avatar_url?: string;
}

interface ConsentExtra {
  consentPurposes?: {
    chatProcessing: boolean;
    notifications?: boolean;
    marketing?: boolean;
  };
  policyVersion?: string;
  policyTextHash?: string;
}

interface UseVisitorIdentityArgs {
  restBase: string;
  nonce?: string;
  chatSig?: string;
  chatTs?: string;
  deviceId?: string | null;
  wpUser?: WpUser | null;
  requireVisitorInfo: boolean;
  /** null/undefined = legacy default (True); false = suppress WP-user auto-register */
  autoRegisterWpUsers?: boolean | null;
  /** Whether the tenant has configured a privacy_notice_url. When false, convenience
   *  items fall back to legacy unconditional access (zero-impact for existing tenants). */
  privacyNoticeConfigured?: boolean;
}

interface UseVisitorIdentityReturn {
  visitorToken: string | null;
  visitorName: string | null;
  isIdentified: boolean;
  isRegistering: boolean;
  registerVisitor: (name: string, email: string, notifyOptIn: boolean, wpUserId?: number, avatarUrl?: string, consent?: ConsentExtra) => Promise<string>;
  ensureVisitorToken: () => Promise<string | null>;
}

const getStorageKey = () => `alpharecall_visitor_token:${window.location.host}`;
const getNameKey = () => `alpharecall_visitor_name:${window.location.host}`;

function readStoredToken(): string | null {
  try {
    // visitor_token is strictly necessary (user submitted pre-chat form explicitly)
    const raw = getGatedItem(getStorageKey(), { strictlyNecessary: true });
    if (!raw) return null;

    // Parse the current envelope and legacy { token, expiresAt } envelopes.
    // Backend ownership tokens are opaque and do not expire, so an arbitrary
    // client TTL only caused repeated consent prompts.
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && typeof parsed.token === "string") {
        return parsed.token;
      }
    } catch {
      // Not JSON -- treat as legacy plain-text token and migrate below
    }

    // Legacy plain-text token: migrate to envelope format
    const envelope = JSON.stringify({ token: raw });
    setGatedItem(getStorageKey(), envelope, { strictlyNecessary: true });
    return raw;
  } catch {
    return null;
  }
}

function writeStoredToken(token: string): void {
  const envelope = JSON.stringify({ token });
  setGatedItem(getStorageKey(), envelope, { strictlyNecessary: true });
}

export function useVisitorIdentity({
  restBase,
  nonce,
  chatSig,
  chatTs,
  deviceId,
  wpUser,
  requireVisitorInfo,
  autoRegisterWpUsers,
  privacyNoticeConfigured,
}: UseVisitorIdentityArgs): UseVisitorIdentityReturn {
  const [visitorToken, setVisitorToken] = useState<string | null>(() => {
    return readStoredToken();
  });
  const [visitorName, setVisitorName] = useState<string | null>(() => {
    // visitor_name is convenience (survives reload) — gated when privacyNotice configured
    return getGatedItem(getNameKey(), {
      strictlyNecessary: false,
      privacyNoticeConfigured: !!privacyNoticeConfigured,
    });
  });
  const [isRegistering, setIsRegistering] = useState(false);
  const didAutoRegister = useRef(false);
  const didRegisterAnonymous = useRef(false);
  const visitorTokenRef = useRef(visitorToken);
  const autoRegistrationRef = useRef<Promise<string | null> | null>(null);
  const anonymousRegistrationRef = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    visitorTokenRef.current = visitorToken;
  }, [visitorToken]);

  const registerVisitor = useCallback(async (name: string, email: string, notifyOptIn: boolean, wpUserId?: number, avatarUrl?: string, consent?: ConsentExtra) => {
    setIsRegistering(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (nonce) headers["X-WP-Nonce"] = nonce;
      if (chatSig) headers["X-AlphaRecall-Signature"] = chatSig;
      if (chatTs) headers["X-AlphaRecall-Timestamp"] = chatTs;
      if (deviceId) headers["X-AlphaRecall-Device-Id"] = deviceId;

      const body: Record<string, unknown> = { email, display_name: name, notification_consent: notifyOptIn };
      if (wpUserId) body.wp_user_id = wpUserId;
      if (avatarUrl) body.avatar_url = avatarUrl;
      if (consent?.consentPurposes) {
        body.consent_purposes = {
          chat_processing: consent.consentPurposes.chatProcessing,
          ...(typeof consent.consentPurposes.notifications === "boolean"
            ? { notifications: consent.consentPurposes.notifications }
            : {}),
          ...(typeof consent.consentPurposes.marketing === "boolean"
            ? { marketing: consent.consentPurposes.marketing }
            : {}),
        };
      }
      if (consent?.policyVersion) body.policy_version = consent.policyVersion;
      if (consent?.policyTextHash) body.policy_text_hash = consent.policyTextHash;

      const res = await fetchWithProofOfWork(`${restBase}/visitor-register`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Registration failed");
      const data = await res.json();
      const token = data.visitor_token || data.data?.visitor_token;
      const displayName = data.display_name || data.data?.display_name || name;
      if (!token) throw new Error("Registration response did not include a visitor token");

      // Only an explicit processing grant may open consent-gated storage.
      // Silent token restoration and WordPress identity registration must not
      // manufacture a new consent decision.
      if (consent?.consentPurposes?.chatProcessing === true) {
        writeConsent("granted");
      }
      writeStoredToken(token);
      setGatedItem(getNameKey(), displayName, {
        strictlyNecessary: false,
        privacyNoticeConfigured: !!privacyNoticeConfigured,
      });
      visitorTokenRef.current = token;
      setVisitorToken(token);
      setVisitorName(displayName);
      return token;
    } finally {
      setIsRegistering(false);
    }
  }, [restBase, nonce, chatSig, chatTs, deviceId, privacyNoticeConfigured]);

  const registerAnonymousVisitor = useCallback(async (): Promise<string | null> => {
    setIsRegistering(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (nonce) headers["X-WP-Nonce"] = nonce;
      const currentChatSig = (window as any).AlphaRecallChat?.chatSig || chatSig;
      const currentChatTs = (window as any).AlphaRecallChat?.chatTs || chatTs;
      if (currentChatSig) headers["X-AlphaRecall-Signature"] = currentChatSig;
      if (currentChatTs) headers["X-AlphaRecall-Timestamp"] = currentChatTs;
      if (deviceId) headers["X-AlphaRecall-Device-Id"] = deviceId;

      const res = await fetchWithProofOfWork(`${restBase}/visitor-register`, {
        method: "POST",
        headers,
        body: JSON.stringify({ anonymous: true }),
      });
      if (!res.ok) throw new Error("Anonymous session registration failed");
      const data = await res.json();
      const token = data.visitor_token || data.data?.visitor_token;
      if (!token) throw new Error("Anonymous registration response did not include a visitor token");
      // The ownership token is strictly necessary. Do not grant consent or
      // persist convenience/marketing fields for an anonymous session.
      writeStoredToken(token);
      visitorTokenRef.current = token;
      setVisitorToken(token);
      return token;
    } finally {
      setIsRegistering(false);
    }
  }, [restBase, nonce, chatSig, chatTs, deviceId]);

  const ensureVisitorToken = useCallback(async (): Promise<string | null> => {
    if (visitorTokenRef.current) return visitorTokenRef.current;
    if (autoRegistrationRef.current) return autoRegistrationRef.current;
    if (!anonymousRegistrationRef.current) {
      const registration = registerAnonymousVisitor();
      anonymousRegistrationRef.current = registration;
      void registration.finally(() => {
        if (anonymousRegistrationRef.current === registration) {
          anonymousRegistrationRef.current = null;
        }
      }).catch(() => undefined);
    }
    return anonymousRegistrationRef.current;
  }, [registerAnonymousVisitor]);

  // Auto-register for WP users, only when the site owner turned it on
  // (tenant setting auto_register_wp_users): it sends the logged-in user's
  // name and e-mail before they write, so a missing flag means off.
  useEffect(() => {
    const enabled = autoRegisterWpUsers === true;
    if (enabled && wpUser && !visitorToken && !didAutoRegister.current) {
      didAutoRegister.current = true;
      const registration = registerVisitor(
        wpUser.display_name,
        wpUser.user_email,
        false,
        wpUser.wp_user_id,
        wpUser.avatar_url
      );
      autoRegistrationRef.current = registration;
      void registration.finally(() => {
        if (autoRegistrationRef.current === registration) {
          autoRegistrationRef.current = null;
        }
      }).catch(() => undefined);
    }
  }, [wpUser, visitorToken, registerVisitor, autoRegisterWpUsers]);

  // Even when the tenant does not ask for contact details, create an opaque
  // visitor session so transcript reads and thread continuation stay bound to
  // the browser that started the conversation.
  useEffect(() => {
    if (
      !requireVisitorInfo &&
      (!wpUser || autoRegisterWpUsers === false) &&
      !visitorToken &&
      !didRegisterAnonymous.current
    ) {
      didRegisterAnonymous.current = true;
      void ensureVisitorToken().catch(() => undefined);
    }
  }, [requireVisitorInfo, wpUser, visitorToken, autoRegisterWpUsers, ensureVisitorToken]);

  const isIdentified = !requireVisitorInfo || !!visitorToken;

  return { visitorToken, visitorName, isIdentified, isRegistering, registerVisitor, ensureVisitorToken };
}
