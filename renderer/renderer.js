const $ = (id) => document.getElementById(id);

// masky.ai voice adapter fallback: distinct browser voices per persona.
const VOICE_STYLE = {
  strategist: { pitch: 0.9, rate: 1.05 },
  historian: { pitch: 0.8, rate: 0.95 },
  hypecaster: { pitch: 1.3, rate: 1.2 },
  scout: { pitch: 1.1, rate: 1.0 },
};
// A rendered clip may finish after its scheduled moment; play it anyway if it
// is at most this late, otherwise drop it and log the missed moment.
const CLIP_GRACE_MS = 5000;
// Stream volume while a crew clip is speaking over it.
const DUCK_VOLUME = 0.15;

let maskyPersonas = new Set();
let muted = false;
let viewerDelayMs = 0;
const activeClips = new Set();

// Delay scheduling: everything captured from the stream (labels, transcript,
// commentary, clips) is displayed at capturedAt + viewer delay so it lands on
// the moment the delayed video is showing. Immediate items (viewer chat
// replies, live mode) run at once. The callback receives how late it ran.
function scheduleAt(capturedAt, immediate, fn) {
  if (immediate || !viewerDelayMs || !capturedAt) {
    fn(0);
    return;
  }
  const wait = capturedAt + viewerDelayMs - Date.now();
  if (wait <= 0) {
    fn(-wait);
    return;
  }
  setTimeout(() => fn(0), wait);
}

function speak(persona, line) {
  if (maskyPersonas.has(persona) || muted) return; // configured Masky playback arrives via onAudio
  const u = new SpeechSynthesisUtterance(line);
  const style = VOICE_STYLE[persona] || {};
  u.pitch = style.pitch ?? 1;
  u.rate = style.rate ?? 1;
  speechSynthesis.speak(u);
}

function stopPlayback() {
  speechSynthesis.cancel();
  for (const clip of [...activeClips]) {
    clip.el.pause();
    clip.finish();
  }
}

$("mute").onclick = () => {
  muted = !muted;
  if (muted) stopPlayback();
  $("stream").muted = muted;
  $("mute").textContent = muted ? "Unmute" : "Mute";
  $("mute").setAttribute("aria-pressed", String(muted));
};

function append(el, html, cap = 200) {
  const div = document.createElement("div");
  div.className = "line";
  div.innerHTML = html;
  el.appendChild(div);
  while (el.children.length > cap) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

window.hh.getConfig().then((cfg) => {
  maskyPersonas = new Set(cfg.maskyPersonas || []);
  viewerDelayMs = cfg.viewerDelayMs || 0;
  const delay = viewerDelayMs ? ` · delayed ${Math.round(viewerDelayMs / 1000)}s` : "";
  $("mode").textContent = cfg.mockIngest || !cfg.twitchChannel
    ? "demo mode (mock ingest)"
    : `twitch.tv/${cfg.twitchChannel} · stt: ${cfg.sttProvider}${delay}`;
});

// ---- delayed viewer (hls.js over the local HLS window) ----

let hls = null;
let viewerCountdown = null;

function teardownViewer() {
  if (viewerCountdown) {
    clearInterval(viewerCountdown);
    viewerCountdown = null;
  }
  if (hls) {
    hls.destroy();
    hls = null;
  }
  $("stream").hidden = true;
  $("viewerWait").hidden = true;
  $("frame").hidden = false;
}

window.hh.onViewer(({ url, delayMs }) => {
  teardownViewer();
  viewerDelayMs = delayMs || 0;
  if (!viewerDelayMs) return;
  if (!window.Hls || !Hls.isSupported()) {
    append($("status"), "delayed viewer unavailable: hls.js not loaded (run npm install) — set VIEWER_DELAY_MS=0 for live frames", 100);
    return;
  }
  const video = $("stream");
  $("frame").hidden = true;
  video.hidden = false;
  video.muted = muted;
  const wait = $("viewerWait");
  wait.hidden = false;
  // Hold playback until a full delay window exists, then start at its oldest
  // point; hls.js keeps the position delayMs behind the live edge from there.
  const startAt = Date.now() + viewerDelayMs;
  const tick = () => {
    const left = startAt - Date.now();
    if (left > 0) {
      wait.textContent =
        `buffering ${Math.round(viewerDelayMs / 1000)}s delay window — playback starts in ${Math.ceil(left / 1000)}s`;
      return;
    }
    clearInterval(viewerCountdown);
    viewerCountdown = null;
    wait.hidden = true;
    hls = new Hls({
      liveSyncDuration: viewerDelayMs / 1000,
      liveMaxLatencyDuration: viewerDelayMs / 1000 + 20,
      maxBufferLength: 20,
    });
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) append($("status"), `viewer ${data.type} error: ${esc(data.details)}`, 100);
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    video.play().catch(() => {});
  };
  tick();
  viewerCountdown = setInterval(tick, 1000);
});

// ---- controls ----

$("start").onclick = async () => {
  $("start").disabled = true;
  try {
    await window.hh.start();
    $("stop").disabled = false;
  } catch {
    $("start").disabled = false;
    $("stop").disabled = true;
  }
};
$("stop").onclick = async () => {
  await window.hh.stop();
  teardownViewer();
  stopPlayback();
  $("start").disabled = false;
  $("stop").disabled = true;
};
$("setGoal").onclick = () => {
  const goal = $("goal").value.trim();
  if (goal) window.hh.setGoal(goal);
};
const sendSay = () => {
  const text = $("sayBox").value.trim();
  if (text) {
    window.hh.say(text);
    $("sayBox").value = "";
  }
};
$("sayBtn").onclick = sendSay;
$("sayBox").addEventListener("keydown", (e) => { if (e.key === "Enter") sendSay(); });

// ---- pipeline events ----

window.hh.onFrame((b64) => { $("frame").src = `data:image/jpeg;base64,${b64}`; });

window.hh.onLabels((labels) => {
  scheduleAt(labels.capturedAt, false, () => {
    $("labels").innerHTML =
      `<div>${esc(labels.scene || "")}</div>` +
      [...(labels.objects || []), ...(labels.events || [])]
        .map((t) => `<span class="tag">${esc(t)}</span>`)
        .join("");
  });
});

window.hh.onTranscript((t) => {
  scheduleAt(t.capturedAt, t.immediate, () =>
    append($("transcript"), `🎙 ${esc(t.text)}`));
});

window.hh.onCommentary((c) => {
  scheduleAt(c.capturedAt, c.immediate, () => {
    const lookupText = c.lookupResult?.note ||
      (Array.isArray(c.lookupResult?.answers) ? c.lookupResult.answers.join(" ") : "");
    const lookup = lookupText ? `<div class="lookup">↳ ${esc(lookupText)}</div>` : "";
    append($("commentary"), `<span class="who ${esc(c.persona)}">${esc(c.persona)}</span>${esc(c.line)}${lookup}`);
    // Personas without a Masky avatar retain the browser voice fallback.
    if (!maskyPersonas.has(c.persona)) speak(c.persona, c.line);
  });
});

// masky.ai clips: scheduled onto their captured moment, queued so voices never
// overlap, ducking the stream audio while one plays.
let clipChain = Promise.resolve();

function playClip(audio, lateBy) {
  if (muted) return;
  if (lateBy > CLIP_GRACE_MS) {
    append($("status"), `⏱ missed moment: ${esc(audio.persona)} clip arrived ${Math.round(lateBy / 1000)}s late — dropped`, 100);
    return;
  }
  clipChain = clipChain.then(() => new Promise((resolve) => {
    if (muted) {
      resolve();
      return;
    }
    const video = $("stream");
    const streamVolume = video.volume;
    video.volume = Math.min(streamVolume, DUCK_VOLUME);
    const el = new Audio(audio.audioUrl);
    let finished = false;
    const clip = {
      el,
      finish() {
        if (finished) return;
        finished = true;
        activeClips.delete(clip);
        video.volume = streamVolume;
        resolve();
      },
    };
    activeClips.add(clip);
    el.addEventListener("ended", clip.finish, { once: true });
    el.addEventListener("error", clip.finish, { once: true });
    el.play().catch(clip.finish); // autoplay may be blocked — the live URL remains available
  }));
}

window.hh.onAudio((audio) => {
  if (!audio || !audio.audioUrl) return;
  scheduleAt(audio.capturedAt, audio.immediate, (lateBy) => playClip(audio, lateBy));
});

window.hh.onStatus((msg) => append($("status"), esc(msg), 100));
