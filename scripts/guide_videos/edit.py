"""The edit: each step's frames, from its first card to its last, into a phone video (H.264 .mp4 that iPhones play,
starting fast on the web) and its cover picture (the title card)."""
import json, subprocess, sys, pathlib
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
REC = pathlib.Path(sys.argv[1])
DEST = pathlib.Path(sys.argv[2]); DEST.mkdir(parents=True, exist_ok=True)
for meta_file in sorted(REC.glob("*.json")):
    name = meta_file.stem
    meta = json.loads(meta_file.read_text())
    frames = [(t, f) for t, f in meta["list"] if meta["start"] - 0.05 <= t <= meta["end"] + 0.05]
    if not frames:
        print(name, "no frames"); continue
    fdir = pathlib.Path(meta["frames"])
    lines = ["ffconcat version 1.0"]
    for i, (t, f) in enumerate(frames):
        nxt = frames[i + 1][0] if i + 1 < len(frames) else meta["end"]
        lines += [f"file '{(fdir / f).resolve().as_posix()}'", f"duration {max(nxt - t, 0.02):.3f}"]
    lines.append(f"file '{(fdir / frames[-1][1]).resolve().as_posix()}'")
    lst = REC / f"{name}.ffconcat"
    lst.write_text("\n".join(lines), encoding="utf-8")
    out = DEST / f"guide-{name}.mp4"
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-safe", "0", "-f", "concat", "-i", str(lst),
                    "-vf", "fps=30,scale=720:-2:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow",
                    "-crf", "25", "-movflags", "+faststart", "-an", str(out)], check=True)
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-ss", "1.2", "-i", str(out), "-frames:v", "1",
                    "-vf", "scale=360:-2", "-q:v", "4", str(DEST / f"guide-{name}.jpg")], check=True)
    print(name, f"{out.stat().st_size / 1e6:.2f} MB", f"{meta['end'] - meta['start']:.1f}s", flush=True)
