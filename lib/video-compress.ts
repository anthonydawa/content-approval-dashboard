import { MAX_MEDIA_BYTES } from "./media-upload";

// Leave headroom below the Cloudflare request ceiling because recorder output
// can vary slightly from the requested bitrate.
const VIDEO_TARGET_BYTES = 72 * 1024 * 1024;

export async function prepareMediaForUpload(file: File) {
  const isVideo = file.type.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(file.name);
  if (!isVideo || file.size <= MAX_MEDIA_BYTES) return file;
  if (!MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")) {
    throw new Error("This browser cannot compress this video. Please use Chrome or upload a video under 90 MB.");
  }

  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = sourceUrl;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error("This video could not be read.")); });

  const targetBitsPerSecond = Math.max(
    160_000,
    Math.min(2_000_000, Math.floor((VIDEO_TARGET_BYTES * 8) / Math.max(video.duration, 1)) - 96_000),
  );
  const maxWidth = targetBitsPerSecond < 900_000 ? 854 : 1280;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2);
  canvas.height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Video compression is not available in this browser.");

  const stream = canvas.captureStream(30);
  const mediaVideo = video as HTMLVideoElement & { captureStream?: () => MediaStream };
  mediaVideo.captureStream?.().getAudioTracks().forEach((track) => stream.addTrack(track));
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9,opus", videoBitsPerSecond: targetBitsPerSecond, audioBitsPerSecond: 96_000 });
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const finished = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  recorder.start(1000);
  const draw = () => { context.drawImage(video, 0, 0, canvas.width, canvas.height); if (!video.ended) requestAnimationFrame(draw); };
  video.onended = () => recorder.stop();
  await video.play();
  draw();
  await finished;
  URL.revokeObjectURL(sourceUrl);

  const compressed = new File([new Blob(chunks, { type: "video/webm" })], `${file.name.replace(/\.[^.]+$/, "")}-compressed.webm`, { type: "video/webm" });
  if (compressed.size > MAX_MEDIA_BYTES) {
    throw new Error("This video is still above the 90 MB upload limit after compression. Please trim it and try again.");
  }
  return compressed;
}
