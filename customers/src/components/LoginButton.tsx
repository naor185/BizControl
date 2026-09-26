"use client";

import { useState } from "react";
import AuthModal from "@/components/AuthModal";

// "התחברות" — opens the phone login and calls onDone when the customer is signed in. Used where a page
// needs a signed-in customer first (the classes page, the check-in at the door).
export default function LoginButton({ primary, onDone }: { primary: string; onDone: () => void }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}
                style={{ minHeight: 46, padding: "0 1.4rem", borderRadius: 14, border: "none", background: primary, color: "#fff", fontWeight: 800, cursor: "pointer" }}>
                התחברות
            </button>
            {open && <AuthModal onClose={() => setOpen(false)} onSuccess={() => { setOpen(false); onDone(); }} />}
        </>
    );
}
