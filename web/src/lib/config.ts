// Single source of truth for the public BizFind app URL.
//
// BizFind is the public platform — customers and business owners enter and
// register there; BizControl (this app) is the management interface only.
// Every register/login link that points at BizFind must read this constant,
// never a hardcoded domain, so the address lives in exactly one place:
// the NEXT_PUBLIC_BIZFIND_URL deployment env var.
//
// It is intentionally empty when the env var is unset — that is a deployment
// misconfiguration to fix by setting the var (after BizFind's own domain/
// deployment is live), not something to paper over with a hardcoded fallback.
export const BIZFIND_URL = (process.env.NEXT_PUBLIC_BIZFIND_URL || "").replace(/\/$/, "");
