import React, { useEffect, useRef } from "react";

export type LandingPageContentProps = {
    themePrimary: string;
    themeSecondary: string;
    logoUrl: string | null;
    title: string;
    description: string;
    studioName?: string;
    templateId: number;
    bgImage?: string | null;
    titleFont?: string;
    descFont?: string;
    galleryImages?: (string | null)[];
    // For the actual form interaction when rendered publically
    isLive?: boolean;
    fullName?: string;
    phone?: string;
    email?: string;
    birthDate?: string;
    setFullName?: (val: string) => void;
    setPhone?: (val: string) => void;
    setEmail?: (val: string) => void;
    setBirthDate?: (val: string) => void;
    onSubmit?: (e: React.FormEvent) => void;
    submitting?: boolean;
    success?: boolean;
    alreadyMember?: boolean;
    joinedPoints?: number;
    submitErr?: string | null;
    marketingConsent?: boolean;
    setMarketingConsent?: (val: boolean) => void;
};

function SuccessScreen({ themePrimary, studioName, joinedPoints }: { themePrimary: string; studioName: string; joinedPoints: number }) {
    const fired = useRef(false);

    useEffect(() => {
        if (fired.current) return;
        fired.current = true;
        import("canvas-confetti").then(({ default: confetti }) => {
            const end = Date.now() + 2200;
            const colors = [themePrimary, "#fbbf24", "#34d399", "#60a5fa", "#f472b6"];
            const frame = () => {
                confetti({ particleCount: 6, angle: 60, spread: 55, origin: { x: 0 }, colors });
                confetti({ particleCount: 6, angle: 120, spread: 55, origin: { x: 1 }, colors });
                if (Date.now() < end) requestAnimationFrame(frame);
            };
            frame();
        });
    }, [themePrimary]);

    return (
        <div className="text-center py-10 px-4 space-y-6" dir="rtl">
            {/* Animated checkmark */}
            <div className="relative mx-auto w-28 h-28">
                <div
                    className="w-28 h-28 rounded-full flex items-center justify-center text-white text-5xl shadow-2xl"
                    style={{
                        backgroundColor: themePrimary,
                        animation: "successPop 0.6s cubic-bezier(0.175,0.885,0.32,1.275) forwards",
                    }}
                >
                    ✓
                </div>
                {/* Pulse ring */}
                <div
                    className="absolute inset-0 rounded-full"
                    style={{
                        border: `3px solid ${themePrimary}`,
                        animation: "successRing 1s ease-out 0.3s forwards",
                        opacity: 0,
                    }}
                />
            </div>

            {/* Text */}
            <div className="space-y-2">
                <h2
                    className="text-3xl font-black tracking-tight"
                    style={{
                        color: themePrimary,
                        animation: "successFade 0.5s ease 0.3s both",
                    }}
                >
                    🎉 ברוך הבא למועדון!
                </h2>
                <p
                    className="text-slate-600 text-lg font-medium"
                    style={{ animation: "successFade 0.5s ease 0.5s both" }}
                >
                    הצטרפת בהצלחה ל{studioName}. נשמח לראותך!
                </p>
            </div>

            {/* Points badge */}
            {joinedPoints > 0 && (
                <div
                    className="inline-flex flex-col items-center gap-1 px-8 py-4 rounded-3xl text-white shadow-xl"
                    style={{
                        backgroundColor: themePrimary,
                        animation: "successFade 0.6s ease 0.7s both",
                    }}
                >
                    <span className="text-4xl">⭐</span>
                    <span className="font-black text-2xl">{joinedPoints} נקודות</span>
                    <span className="text-sm opacity-80 font-medium">קיבלת מתנת הצטרפות!</span>
                </div>
            )}

            {/* What's next */}
            <div
                className="bg-slate-50 rounded-2xl border border-slate-100 px-6 py-4 text-sm text-slate-500 space-y-1 max-w-xs mx-auto"
                style={{ animation: "successFade 0.5s ease 0.9s both" }}
            >
                <p>✅ הנקודות נוספו לחשבונך</p>
                <p>📲 תקבל הודעת וואטסאפ בקרוב</p>
            </div>

            <style>{`
                @keyframes successPop {
                    0%   { transform: scale(0); opacity: 0; }
                    70%  { transform: scale(1.15); }
                    100% { transform: scale(1); opacity: 1; }
                }
                @keyframes successRing {
                    0%   { transform: scale(1); opacity: 0.8; }
                    100% { transform: scale(1.6); opacity: 0; }
                }
                @keyframes successFade {
                    from { opacity: 0; transform: translateY(16px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}

export default function LandingPageTemplate({
    themePrimary,
    themeSecondary,
    logoUrl,
    title,
    description,
    studioName = "הסטודיו",
    templateId,
    bgImage = null,
    titleFont = "Heebo",
    descFont = "Assistant",
    galleryImages = [],
    isLive = false,
    fullName = "",
    phone = "",
    email = "",
    birthDate = "",
    setFullName,
    setPhone,
    setEmail,
    setBirthDate,
    onSubmit,
    submitting = false,
    success = false,
    alreadyMember = false,
    joinedPoints = 0,
    submitErr = null,
    marketingConsent = true,
    setMarketingConsent,
}: LandingPageContentProps) {

    const handleFormSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (onSubmit) onSubmit(e);
    };

    const RegistrationForm = (
        <form onSubmit={handleFormSubmit} className="space-y-4 w-full text-right" dir="rtl">
            <div>
                <label className="block text-sm font-medium mb-1 text-slate-700">שם מלא</label>
                <input required={isLive} type="text" value={fullName} onChange={e => setFullName?.(e.target.value)} disabled={!isLive} className="w-full border px-4 py-2.5 rounded-xl bg-white/60 backdrop-blur-sm focus:bg-white focus:ring-2 focus:outline-none transition-all" style={{ borderColor: themePrimary, outlineColor: themePrimary }} placeholder="ישראל ישראלי" />
            </div>
            <div>
                <label className="block text-sm font-medium mb-1 text-slate-700">טלפון</label>
                <input required={isLive} type="tel" dir="ltr" value={phone} onChange={e => setPhone?.(e.target.value)} disabled={!isLive} className="w-full border px-4 py-2.5 rounded-xl bg-white/60 backdrop-blur-sm text-right focus:bg-white focus:ring-2 focus:outline-none transition-all" style={{ borderColor: themePrimary, outlineColor: themePrimary }} placeholder="050-1234567" />
            </div>
            <div>
                <label className="block text-sm font-medium mb-1 text-slate-700">דוא&quot;ל</label>
                <input required={isLive} type="email" dir="ltr" value={email} onChange={e => setEmail?.(e.target.value)} disabled={!isLive} className="w-full border px-4 py-2.5 rounded-xl bg-white/60 backdrop-blur-sm text-right focus:bg-white focus:ring-2 focus:outline-none transition-all" style={{ borderColor: themePrimary, outlineColor: themePrimary }} placeholder="you@example.com" />
            </div>
            <div>
                <label className="block text-sm font-medium mb-1 text-slate-700">תאריך לידה (ליום הולדת 🎉)</label>
                <input required={isLive} type="date" value={birthDate} onChange={e => setBirthDate?.(e.target.value)} disabled={!isLive} className="w-full border px-4 py-2.5 rounded-xl bg-white/60 backdrop-blur-sm text-right focus:bg-white focus:ring-2 focus:outline-none transition-all" style={{ borderColor: themePrimary, outlineColor: themePrimary }} />
            </div>

            <div className="flex items-start gap-3 py-2">
                <input
                    type="checkbox"
                    id="marketing"
                    checked={marketingConsent}
                    onChange={e => setMarketingConsent?.(e.target.checked)}
                    className="mt-1.5 h-4 w-4 rounded border-slate-300 transition-all cursor-pointer"
                    style={{ accentColor: themePrimary }}
                />
                <label htmlFor="marketing" className="text-sm text-slate-600 cursor-pointer">
                    אני מאשר/ת קבלת עדכונים, הטבות והודעות שיווקיות מ-{studioName} ומסכים/ה ל
                    <a href="/accessibility" target="_blank" className="underline mx-1">תנאי השימוש</a>
                    ו
                    <a href="/accessibility" target="_blank" className="underline mx-1">הצהרת הנגישות</a>.
                </label>
            </div>

            {submitErr && <div className="text-red-500 font-medium text-sm mt-2">{submitErr}</div>}

            <button disabled={!isLive || submitting} type="submit" className="w-full text-white font-bold py-3.5 rounded-xl mt-6 shadow-xl disabled:opacity-70 hover:opacity-90 hover:-translate-y-0.5 transition-all overflow-hidden relative group" style={{ backgroundColor: themePrimary }}>
                <div className="absolute inset-0 w-full h-full bg-white/20 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>
                <span className="relative z-10">{submitting ? "שולח..." : "הצטרפות למועדון"}</span>
            </button>
        </form>
    );

    const SuccessMessage = success
        ? <SuccessScreen themePrimary={themePrimary} studioName={studioName} joinedPoints={joinedPoints} />
        : alreadyMember
        ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center space-y-5" dir="rtl">
                <div className="w-24 h-24 rounded-full flex items-center justify-center text-5xl shadow-xl" style={{ background: `linear-gradient(135deg, ${themePrimary}22, ${themePrimary}44)`, border: `3px solid ${themePrimary}` }}>
                    👑
                </div>
                <h2 className="text-2xl font-black text-slate-800">אתה כבר חבר המועדון!</h2>
                <p className="text-slate-500 text-base">אנחנו מכירים אותך — אתה כבר VIP אצלנו ב-{studioName}.</p>
                {joinedPoints > 0 && (
                    <div className="px-6 py-3 rounded-2xl text-white font-bold text-lg shadow-lg" style={{ background: themePrimary }}>
                        יש לך {joinedPoints} נקודות בחשבון ⭐
                    </div>
                )}
            </div>
        )
        : null;

    // Default Fallbacks
    const safeTitle = title || `ברוכים הבאים ל-${studioName}`;
    const safeDesc = description || "הרשמו עכשיו וקבלו הטבות שוות!";

    const FontsImport = (
        <style dangerouslySetInnerHTML={{
            __html: `
            @import url('https://fonts.googleapis.com/css2?family=Assistant:wght@400;700&family=Heebo:wght@400;700;900&family=M+PLUS+Rounded+1c:wght@400;700&family=Rubik:wght@400;700&family=Varela+Round&display=swap');
        `}} />
    );

    const fontStyleTitle = { fontFamily: `"${titleFont}", sans-serif` };
    const fontStyleDesc = { fontFamily: `"${descFont}", sans-serif` };

    const bgStyle = bgImage ? {
        backgroundImage: `url(${bgImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed'
    } : { backgroundColor: themeSecondary };

    const validGallery = galleryImages.filter(Boolean) as string[];

    const SliderComponent = validGallery.length > 0 ? (
        <div className="w-full mt-8 overflow-hidden rounded-2xl border border-white/20 shadow-inner flex shrink-0 h-48 sm:h-64 relative group">
            <div className="flex w-full animate-[slider_12s_infinite]">
                {validGallery.map((img, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={img} alt={`Gallery ${i}`} className="w-full h-full object-cover flex-shrink-0" />
                ))}
            </div>
            {/* Extremely simple pure CSS slider keyframes */}
            <style dangerouslySetInnerHTML={{
                __html: `
                @keyframes slider {
                    0%, 25% { transform: translateX(0); }
                    33%, 58% { transform: translateX(${validGallery.length > 1 ? '100%' : '0'}); }
                    66%, 91% { transform: translateX(${validGallery.length > 2 ? '200%' : '0'}); }
                    100% { transform: translateX(0); }
                }
            `}} />
        </div>
    ) : null;

    // TEMPLATE 1: Modern Centered Card (Upgraded with Glassmorphism)
    if (templateId === 1) {
        return (
            <div className="min-h-full w-full flex items-center justify-center p-4 sm:p-8 relative overflow-hidden" dir="rtl" style={bgStyle}>
                {FontsImport}

                {/* Modern Decorative Orbs (Only if no BG image to prevent clash) */}
                {!bgImage && (
                    <>
                        <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full opacity-30 mix-blend-multiply blur-[80px] z-0 pointer-events-none transition-all duration-1000" style={{ backgroundColor: themePrimary }}></div>
                        <div className="absolute bottom-[-15%] left-[-10%] w-[600px] h-[600px] rounded-full opacity-20 mix-blend-multiply blur-[100px] z-0 pointer-events-none transition-all duration-1000" style={{ backgroundColor: themePrimary }}></div>
                        <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, black 1px, transparent 0)', backgroundSize: '40px 40px' }}></div>
                    </>
                )}

                <div className="w-full max-w-md bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl p-8 sm:p-10 relative z-10 border border-white/40">
                    <div className="text-center mb-10">
                        {logoUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={logoUrl} alt={studioName} className="h-24 mx-auto mb-6 object-contain drop-shadow-sm" />
                        )}
                        <h1 className="text-3xl font-extrabold text-slate-900 mb-3 tracking-tight leading-tight" style={fontStyleTitle}>{safeTitle}</h1>
                        <p className="text-slate-500 text-base whitespace-pre-wrap leading-relaxed font-medium" style={fontStyleDesc}>{safeDesc}</p>
                    </div>

                    {(success || alreadyMember) ? SuccessMessage : RegistrationForm}
                    {SliderComponent}
                </div>
            </div>
        );
    }

    // TEMPLATE 2: Split Screen (Premium Layout)
    if (templateId === 2) {
        return (
            <div className="min-h-full w-full flex flex-col md:flex-row" dir="rtl" style={bgStyle}>
                {FontsImport}

                {/* Branding Side */}
                <div className="md:w-1/2 flex flex-col justify-center items-center p-12 lg:p-20 text-center text-white relative overflow-hidden transition-colors duration-700">
                    {/* Deep dynamic gradient over primary color */}
                    <div className="absolute inset-0 z-0" style={{ backgroundColor: bgImage ? 'rgba(0,0,0,0.6)' : themePrimary }}></div>
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-black/30 mix-blend-overlay z-0"></div>

                    <div className="relative z-10 w-full max-w-md animate-in fade-in slide-in-from-right-8 duration-700">
                        {logoUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={logoUrl} alt={studioName} className="h-32 mb-10 object-contain bg-white/10 rounded-3xl p-6 backdrop-blur-md border border-white/20 mx-auto shadow-2xl" />
                        )}
                        <h1 className="text-4xl lg:text-5xl font-black mb-6 drop-shadow-lg leading-tight tracking-tight" style={fontStyleTitle}>{safeTitle}</h1>
                        <p className="text-lg lg:text-xl opacity-90 whitespace-pre-wrap drop-shadow font-light" style={fontStyleDesc}>{safeDesc}</p>

                        {SliderComponent && <div className="mt-12">{SliderComponent}</div>}
                    </div>
                </div>

                {/* Form Side */}
                <div className="md:w-1/2 flex items-center justify-center p-8 lg:p-20 transition-colors duration-700 relative overflow-hidden" style={{ backgroundColor: themeSecondary }}>
                    <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none"></div>

                    <div className="w-full max-w-sm relative z-10 animate-in fade-in slide-in-from-left-8 duration-700 delay-150">
                        <div className="bg-white/90 backdrop-blur-xl p-8 sm:p-10 rounded-3xl shadow-2xl border border-slate-100 ring-4 ring-slate-50">
                            <div className="mb-8">
                                <h2 className="text-2xl font-bold text-slate-800" style={fontStyleTitle}>מילוי פרטים אישיים 👋</h2>
                                <p className="text-slate-500 text-sm mt-2" style={fontStyleDesc}>הזן את פרטיך להצטרפות מהירה למערכת</p>
                            </div>
                            {(success || alreadyMember) ? SuccessMessage : RegistrationForm}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // TEMPLATE 3: Minimalist High-Fashion Vogue Style
    return (
        <div className="min-h-full w-full flex flex-col items-center justify-center p-6 sm:p-12 transition-colors duration-1000 relative overflow-hidden" dir="rtl" style={bgStyle}>
            {FontsImport}

            {/* Extremely subtle minimalist accents */}
            {!bgImage && (
                <>
                    <div className="absolute top-0 w-full h-1" style={{ backgroundColor: themePrimary }}></div>
                    <div className="absolute bottom-0 left-0 w-32 h-32 rounded-tr-full opacity-5 pointer-events-none" style={{ backgroundColor: themePrimary }}></div>
                </>
            )}

            <div className="w-full max-w-2xl bg-white/70 backdrop-blur-md p-10 sm:p-16 rounded-[40px] border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                <div className="mb-14 text-center">
                    {logoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={logoUrl} alt={studioName} className="h-20 mx-auto mb-10 object-contain drop-shadow-sm opacity-90" />
                    )}
                    <h1 className="text-4xl lg:text-5xl font-black tracking-tighter text-slate-900 mb-6" style={{ color: themePrimary, ...fontStyleTitle }}>
                        {safeTitle}
                    </h1>
                    {description && (
                        <p className="mt-4 text-slate-600 font-medium text-lg lg:text-xl whitespace-pre-wrap leading-relaxed max-w-lg mx-auto opacity-80" style={fontStyleDesc}>
                            {safeDesc}
                        </p>
                    )}
                </div>

                <div className="max-w-md mx-auto">
                    {(success || alreadyMember) ? SuccessMessage : RegistrationForm}
                </div>

                {SliderComponent}

                <div className="text-center mt-20 text-xs text-slate-400 font-mono tracking-[0.2em] uppercase font-bold opacity-60">
                    Powered By BizControl
                </div>
            </div>
        </div>
    );
}
