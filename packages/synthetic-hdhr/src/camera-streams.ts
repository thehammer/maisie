// Camera streaming — transcodes RTSP from go2rtc via ffmpeg into MPEG-TS for Plex.
// Cameras are 4K but we scale to 1080p for Plex direct-play compatibility.

const GO2RTC_RTSP = process.env.GO2RTC_RTSP || "rtsp://go2rtc:8554";

export function streamCamera(streamName: string): Response {
  const rtspUrl = `${GO2RTC_RTSP}/${streamName}`;
  console.log(`[camera] Starting ffmpeg for ${streamName} from ${rtspUrl}`);

  const proc = Bun.spawn([
    "ffmpeg",
    "-hide_banner",
    "-loglevel", "warning",
    "-nostats",
    "-rtsp_transport", "tcp",
    "-fflags", "+genpts+discardcorrupt",
    "-i", rtspUrl,
    "-map", "0:v:0", "-map", "0:a:0?",
    // Transcode video to 1080p H.264 for Plex compatibility
    "-vf", "scale=-2:1080",
    "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
    "-b:v", "4M", "-maxrate", "4M", "-bufsize", "8M",
    "-g", "60", "-keyint_min", "60",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
    "-f", "mpegts",
    "-mpegts_flags", "+resend_headers",
    "-muxdelay", "0",
    "-flush_packets", "1",
    "-metadata", `service_provider=Maisie`,
    "-metadata", `service_name=${streamName}`,
    "pipe:1",
  ], {
    stdout: "pipe",
    stderr: "pipe",
  });

  (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value).trim();
      if (text) console.error(`[camera-ffmpeg] ${text}`);
    }
  })();

  proc.exited.then((code) => {
    console.log(`[camera] ffmpeg exited with code ${code} for ${streamName}`);
  });

  return new Response(proc.stdout, {
    headers: {
      "Content-Type": "video/mp2t",
      "Connection": "keep-alive",
    },
  });
}
