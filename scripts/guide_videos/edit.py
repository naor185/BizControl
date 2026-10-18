"""The edit: each step's frames, from its first card to its last, into a phone video (H.264 .mp4 that iPhones play,
starting fast on the web) and its cover picture (the title card). Where ויקי spoke while it was recorded (record.py
say()), her sentences go on the video's sound, each at the moment it was cued.

The browser sends a frame only when the screen changes, so the frames come at uneven times. They're laid out at a
steady 30 per second — each one the latest frame captured by then — so the video is exactly as long as the recording
and her voice falls where it was cued (a list of frames with their own durations came out seconds too long or short)."""
import json, math, os, shutil, subprocess, sys, pathlib
import imageio_ffmpeg

FPS = 30
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

    # a steady 30 frames a second: frame i shows what the screen showed at start + i/30
    steady = REC / f"steady_{name}"
    shutil.rmtree(steady, ignore_errors=True)
    steady.mkdir()
    j = 0
    for i in range(math.ceil((meta["end"] - meta["start"]) * FPS)):
        at = meta["start"] + i / FPS
        while j + 1 < len(frames) and frames[j + 1][0] <= at:
            j += 1
        src, dst = fdir / frames[j][1], steady / f"s{i:06d}.jpg"
        try:
            os.link(src, dst)                     # the same picture, no copy
        except OSError:
            shutil.copyfile(src, dst)
    out = DEST / f"guide-{name}.mp4"

    # her sentences: each clip delayed to its cue, mixed into one track as long as the video
    cues = meta.get("voice") or []
    voice_in, voice_map = [], ["-an"]
    if cues:
        vdir = pathlib.Path(meta["voice_dir"])
        chains = []
        for k, (t, clip) in enumerate(cues, start=1):
            voice_in += ["-i", str(vdir / f"{clip}.mp3")]
            ms = max(int((t - meta["start"]) * 1000), 0)
            chains.append(f"[{k}:a]aformat=sample_rates=44100:channel_layouts=mono,adelay={ms}:all=1[a{k}]")
        mix = "".join(f"[a{k}]" for k in range(1, len(cues) + 1))
        graph = ";".join(chains) + f";{mix}amix=inputs={len(cues)}:normalize=0:dropout_transition=0,apad[aout]"
        voice_map = ["-filter_complex", graph, "-map", "0:v", "-map", "[aout]", "-c:a", "aac", "-b:a", "96k", "-shortest"]

    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-framerate", str(FPS), "-i", str(steady / "s%06d.jpg"),
                    *voice_in, "-vf", "scale=720:-2:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow",
                    "-crf", "25", "-movflags", "+faststart", *voice_map, str(out)], check=True)
    shutil.rmtree(steady, ignore_errors=True)
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-ss", "1.2", "-i", str(out), "-frames:v", "1",
                    "-vf", "scale=360:-2", "-q:v", "4", str(DEST / f"guide-{name}.jpg")], check=True)
    print(name, f"{out.stat().st_size / 1e6:.2f} MB", f"{meta['end'] - meta['start']:.1f}s",
          f"{len(cues)} sentences" if cues else "no voice", flush=True)
