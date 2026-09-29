"use client";

// The one on/off switch in BizControl. The circle always stays inside its track — right to left (Hebrew, Arabic) as
// in English: off, it sits at the start of the line (the right, in Hebrew); on, it slides to the end (the left), like
// the phone's own switches in Hebrew. The switches used to push the circle right in every language, so in Hebrew,
// where it starts on the right, it slid out of the track.
// as="span" draws just the switch, inside a whole row that is itself the button.

type Look = {
    checked: boolean;
    size?: "sm" | "md";
    onColor?: string;             // the track's color when on (a Tailwind bg-… class)
};
type Interactive = Look & {
    as?: "button";
    onChange: (next: boolean) => void;
    disabled?: boolean;
    label?: string;               // what it switches, for screen readers — when no visible label points at it
    labelledBy?: string;
    title?: string;
    id?: string;
};
type Drawn = Look & { as: "span" };

const SIZES = {
    sm: { track: "h-5 w-9", knob: "h-4 w-4", on: "translate-x-4 rtl:-translate-x-4" },
    md: { track: "h-7 w-12", knob: "h-6 w-6", on: "translate-x-5 rtl:-translate-x-5" },
};

export function Switch(props: Interactive | Drawn) {
    const { checked, size = "md", onColor = "bg-emerald-500" } = props;
    const s = SIZES[size];
    const track = `relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ${s.track} ${checked ? onColor : "bg-slate-300"}`;
    const knob = <span aria-hidden className={`${s.knob} rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? s.on : "translate-x-0"}`} />;
    if (props.as === "span") return <span aria-hidden className={track}>{knob}</span>;

    const { onChange, disabled, label, labelledBy, title, id } = props;
    return (
        <button type="button" role="switch" aria-checked={checked} aria-label={label} aria-labelledby={labelledBy} title={title} id={id}
            disabled={disabled} onClick={() => onChange(!checked)}
            className={`${track} cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2`}>
            {knob}
        </button>
    );
}
