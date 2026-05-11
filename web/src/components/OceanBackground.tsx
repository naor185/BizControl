"use client";

export default function OceanBackground() {
    return (
        <div className="absolute inset-0 w-full h-full overflow-hidden">

            {/* Deep ocean gradient base */}
            <div className="absolute inset-0" style={{
                background: "linear-gradient(to bottom, #000d1a 0%, #001833 25%, #002855 55%, #001f44 100%)",
            }} />

            {/* Caustic light patches on surface */}
            <div className="absolute inset-0 pointer-events-none" style={{
                background: `
                    radial-gradient(ellipse 70% 30% at 20% 5%,  rgba(0,140,255,0.13) 0%, transparent 70%),
                    radial-gradient(ellipse 50% 25% at 75% 8%,  rgba(0,180,255,0.10) 0%, transparent 60%),
                    radial-gradient(ellipse 40% 20% at 50% 3%,  rgba(0,160,255,0.09) 0%, transparent 50%)
                `,
                animation: "causticPulse 9s ease-in-out infinite alternate",
            }} />

            {/* God rays */}
            <div className="absolute inset-0 pointer-events-none" style={{
                background: `
                    linear-gradient(174deg, rgba(0,130,255,0.07) 0%, transparent 50%),
                    linear-gradient(167deg, rgba(0,150,255,0.05) 0%, transparent 42%),
                    linear-gradient(180deg, rgba(0,120,255,0.06) 0%, transparent 48%)
                `,
                animation: "raysWave 14s ease-in-out infinite alternate",
            }} />

            {/* Whale swimming across */}
            <div style={{
                position: "absolute",
                bottom: "12%",
                left: 0,
                width: "100%",
                height: "100%",
                animation: "whaleSwim 18s ease-in-out infinite",
                pointerEvents: "none",
            }}>
                <img
                    src="/whale.jpg"
                    alt=""
                    style={{
                        position: "absolute",
                        bottom: "10%",
                        left: "10%",
                        width: "clamp(340px, 55vw, 780px)",
                        animation: "whaleBob 6s ease-in-out infinite",
                        filter: "drop-shadow(0 0 40px rgba(0,120,255,0.35)) drop-shadow(0 0 80px rgba(0,80,200,0.20))",
                        opacity: 0.93,
                        borderRadius: "4px",
                    }}
                />
            </div>

            {/* Underwater haze — bottom */}
            <div className="absolute inset-x-0 bottom-0 h-2/5 pointer-events-none" style={{
                background: "linear-gradient(to top, rgba(0,10,30,0.7) 0%, transparent 100%)",
            }} />

            {/* Top darkness */}
            <div className="absolute inset-x-0 top-0 h-24 pointer-events-none" style={{
                background: "linear-gradient(to bottom, rgba(0,5,15,0.6) 0%, transparent 100%)",
            }} />

            {/* Bubble particles via CSS */}
            {Array.from({ length: 18 }).map((_, i) => (
                <div key={i} style={{
                    position: "absolute",
                    bottom: `${Math.random() * 60}%`,
                    left: `${5 + i * 5.2 + Math.random() * 3}%`,
                    width: `${3 + Math.random() * 5}px`,
                    height: `${3 + Math.random() * 5}px`,
                    borderRadius: "50%",
                    background: "rgba(140,200,255,0.45)",
                    animation: `bubbleRise ${5 + Math.random() * 8}s ${Math.random() * 6}s ease-in infinite`,
                    pointerEvents: "none",
                }} />
            ))}

            <style>{`
                @keyframes whaleSwim {
                    0%   { transform: translateX(20%)  translateY(0px)   scaleX(1); }
                    48%  { transform: translateX(-90%) translateY(-18px) scaleX(1); }
                    50%  { transform: translateX(-95%) translateY(-18px) scaleX(-1); opacity: 0; }
                    52%  { transform: translateX(110%) translateY(0px)   scaleX(-1); opacity: 0; }
                    54%  { transform: translateX(105%) translateY(0px)   scaleX(-1); opacity: 1; }
                    100% { transform: translateX(20%)  translateY(0px)   scaleX(1); }
                }
                @keyframes whaleBob {
                    0%   { transform: translateY(0px)   rotate(-1.5deg); }
                    30%  { transform: translateY(-14px) rotate(0.5deg);  }
                    60%  { transform: translateY(-6px)  rotate(-0.8deg); }
                    100% { transform: translateY(0px)   rotate(-1.5deg); }
                }
                @keyframes causticPulse {
                    0%   { opacity: 0.6; transform: scale(1)    translateX(0px);  }
                    50%  { opacity: 1.0; transform: scale(1.05) translateX(10px); }
                    100% { opacity: 0.75; transform: scale(0.97) translateX(-8px); }
                }
                @keyframes raysWave {
                    0%   { opacity: 0.5; transform: rotate(-1.2deg); }
                    50%  { opacity: 0.9; transform: rotate(0.6deg);  }
                    100% { opacity: 0.6; transform: rotate(1.2deg);  }
                }
                @keyframes bubbleRise {
                    0%   { transform: translateY(0)    translateX(0);   opacity: 0.7; }
                    50%  { transform: translateY(-45vh) translateX(8px);  opacity: 0.5; }
                    100% { transform: translateY(-90vh) translateX(-5px); opacity: 0; }
                }
            `}</style>
        </div>
    );
}
