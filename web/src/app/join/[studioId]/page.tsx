"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import LandingPageTemplate from "@/components/LandingPageTemplate";

// Define the API URL directly since this page is public and doesn't use the standard authenticated api fetcher for everything.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

type PublicStudioInfo = {
    id: string;
    name: string;
    theme_primary_color: string;
    theme_secondary_color: string;
    logo_filename: string | null;
    landing_page_active_template: number;
    landing_page_title: string | null;
    landing_page_description: string | null;
    landing_page_title_font: string;
    landing_page_desc_font: string;
    landing_page_bg_image: string | null;
    landing_page_image_1: string | null;
    landing_page_image_2: string | null;
    landing_page_image_3: string | null;
};

export default function JoinStudioPage() {
    const params = useParams();
    const studioId = params.studioId as string;

    const [info, setInfo] = useState<PublicStudioInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const [fullName, setFullName] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [birthDate, setBirthDate] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [submitErr, setSubmitErr] = useState<string | null>(null);
    const [marketingConsent, setMarketingConsent] = useState(true);

    useEffect(() => {
        if (!studioId) return;

        fetch(`${API_BASE}/api/public/studio/${studioId}`)
            .then(res => {
                if (!res.ok) throw new Error("Studio not found");
                return res.json();
            })
            .then(data => setInfo(data))
            .catch(e => setErr(e.message))
            .finally(() => setLoading(false));
    }, [studioId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setSubmitErr(null);

        try {
            const res = await fetch(`${API_BASE}/api/public/studio/${studioId}/join`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    full_name: fullName,
                    phone: phone,
                    email: email || undefined,
                    birth_date: birthDate || undefined,
                    marketing_consent: marketingConsent
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.detail || "שגיאה בהרשמה");
            }

            setSuccess(true);
        } catch (error: any) {
            setSubmitErr(error.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <div className="min-h-screen flex items-center justify-center">טוען נתונים...</div>;
    if (err || !info) return <div className="min-h-screen flex items-center justify-center text-red-500">העסק לא נמצא</div>;

    const logoUrl = info.logo_filename ? `${API_BASE}/uploads/${info.logo_filename}` : null;

    return (
        <LandingPageTemplate
            themePrimary={info.theme_primary_color}
            themeSecondary={info.theme_secondary_color}
            logoUrl={logoUrl}
            title={info.landing_page_title || ""}
            description={info.landing_page_description || ""}
            studioName={info.name}
            templateId={info.landing_page_active_template}
            bgImage={info.landing_page_bg_image ? `${API_BASE}/uploads/${info.landing_page_bg_image}` : null}
            titleFont={info.landing_page_title_font}
            descFont={info.landing_page_desc_font}
            galleryImages={[
                info.landing_page_image_1 ? `${API_BASE}/uploads/${info.landing_page_image_1}` : null,
                info.landing_page_image_2 ? `${API_BASE}/uploads/${info.landing_page_image_2}` : null,
                info.landing_page_image_3 ? `${API_BASE}/uploads/${info.landing_page_image_3}` : null,
            ]}
            isLive={true}
            fullName={fullName}
            phone={phone}
            email={email}
            birthDate={birthDate}
            setFullName={setFullName}
            setPhone={setPhone}
            setEmail={setEmail}
            setBirthDate={setBirthDate}
            onSubmit={handleSubmit}
            submitting={submitting}
            success={success}
            submitErr={submitErr}
            marketingConsent={marketingConsent}
            setMarketingConsent={setMarketingConsent}
        />
    );
}
