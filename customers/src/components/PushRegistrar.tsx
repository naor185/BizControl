"use client";
import { useEffect } from "react";
import { registerForPushNotifications } from "@/lib/push";

// Mounted once in the root layout — registers this device for push on app
// launch when a customer is already logged in from a previous session.
// (Fresh logins are handled separately by saveCustomer() in lib/auth.ts.)
export default function PushRegistrar() {
    useEffect(() => {
        registerForPushNotifications();
    }, []);
    return null;
}
