"use client";

import { useEffect, useState } from "react";

// Renders its children only in the browser, after the first paint — the way RequireAuth does for the signed-in
// screens. A page outside the sign-in gate (forgot / set password, onboarding, suspended) says its texts in the user's
// language (lib/i18n tx) — the server's Hebrew page would otherwise disagree with the browser's English.
export default function AfterMount({ children }: { children: React.ReactNode }) {
    const [on, setOn] = useState(false);
    useEffect(() => { setOn(true); }, []);   // eslint-disable-line react-hooks/set-state-in-effect
    return on ? <>{children}</> : null;
}
