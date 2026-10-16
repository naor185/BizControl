// ויקי's face in a circle — the button by the bell, the guide's window, the "הראו לי" buttons (components/viki/Viki: the
// whole figure). Only blinking here, so a face that stays on the screen doesn't pull the eye.
import Viki from "@/components/viki/Viki";

export default function VikiAvatar({ size = 36, className = "" }: { size?: number; className?: string }) {
    return <Viki crop="head" size={size} still className={className} />;
}
