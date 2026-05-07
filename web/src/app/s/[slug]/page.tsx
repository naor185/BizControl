"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import LandingPageTemplate from "@/components/LandingPageTemplate";

type LandingData = {
    studio_id: string;
    studio_name: string;
    theme_primary_color: string;
    theme_secondary_color: string;
    logo_filename: string | null;
    landing_page_active_template: number;
    landing_page_title: string | null;
    landing_page_description: string | null;
    landing_page_bg_image: string | null;
    landing_page_title_font: string;
    landing_page_desc_font: string;
    landing_page_image_1: string | null;
    landing_page_image_2: string | null;
    landing_page_image_3: string | null;
    points_on_signup: number;
};

function imgUrl(filename: string | null | undefined): string | null {
    if (!filename) return null;
    if (filename.startsWith("http")) return filename;
    const base = process.env.NEXT_PUBLIC_API_BASE || "";
    return `${base}/uploads/${filename}`;
}

export default function StudioLandingPage() {
    const params = useParams();
    const slug = params?.slug as string;

    const [data, setData] = useState<LandingData | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    const [fullName, setFullName] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [birthDate, setBirthDate] = useState("");
    const [marketingConsent, setMarketingConsent] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [submitErr, setSubmitErr] = useState<string | null>(null);

    const apiBase = process.env.NEXT_PUBLIC_API_BASE || "";

    useEffect(() => {
        if (!slug) return;
        fetch(`${apiBase}/api/public/landing/${slug}`)
            .then(res => {
                if (!res.ok) throw new Error("not found");
                return res.json();
            })
            .then(setData)
            .catch(() => setNotFound(true))
            .finally(() => setLoading(false));
    }, [slug, apiBase]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!data) return;
        setSubmitting(true);
        setSubmitErr(null);
        try {
            const res = await fetch(`${apiBase}/api/public/studio/${data.studio_id}/join`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    full_name: fullName,
                    phone,
                    email: email || null,
                    birth_date: birthDate || null,
                    marketing_consent: marketingConsent,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.detail || "שגיאה בהרשמה");
            }
            setSuccess(true);
        } catch (e: unknown) {
            setSubmitErr((e as Error)?.message || "שגיאה בהרשמה, נסה שוב");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900" />
            </div>
        );
    }

    if (notFound || !data) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50" dir="rtl">
                <div className="text-center space-y-4">
                    <p className="text-6xl">🔍</p>
                    <h1 className="text-2xl font-bold text-slate-800">הסטודיו לא נמצא</h1>
                    <p className="text-slate-500">הקישור לא תקין או שהסטודיו אינו פעיל</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen">
            <LandingPageTemplate
                themePrimary={data.theme_primary_color}
                themeSecondary={data.theme_secondary_color}
                logoUrl={imgUrl(data.logo_filename)}
                title={data.landing_page_title || ""}
                description={data.landing_page_description || ""}
                studioName={data.studio_name}
                templateId={data.landing_page_active_template}
                bgImage={imgUrl(data.landing_page_bg_image)}
                titleFont={data.landing_page_title_font}
                descFont={data.landing_page_desc_font}
                galleryImages={[
                    imgUrl(data.landing_page_image_1),
                    imgUrl(data.landing_page_image_2),
                    imgUrl(data.landing_page_image_3),
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
        </div>
    );
}
