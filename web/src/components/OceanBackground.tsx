"use client";

export default function OceanBackground() {
    return (
        <div className="absolute inset-0 w-full h-full overflow-hidden">
            <video
                autoPlay
                loop
                muted
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
                src="/bg.mp4"
            />
            {/* Dark overlay for readability */}
            <div className="absolute inset-0 bg-black/40" />
        </div>
    );
}
