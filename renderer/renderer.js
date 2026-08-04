const $ = (id) => document.getElementById(id);

// masky.ai voice adapter fallback: distinct browser voices per persona.
const VOICE_STYLE = {
  strategist: { pitch: 0.9, rate: 1.05 },
  historian: { pitch: 0.8, rate: 0.95 },
  hypecaster: { pitch: 1.3, rate: 1.2 },
  scout: { pitch: 1.1, rate: 1.0 },
};
let maskyVoices = false;
let muted = false;
const activeAudio = new Set();

function speak(persona, line) {
  if (maskyVoices || muted) return; // real masky.ai playback arrives via onAudio
  const u = new SpeechSynthesisUtterance(line);
  const style = VOICE_STYLE[persona] || {};
  u.pitch = style.pitch ?? 1;
  u.rate = style.rate ?? 1;
  speechSynthesis.speak(u);
}

function stopPlayback() {
  speechSynthesis.cancel();
  for (const audio of activeAudio) {
    audio.pause();
    audio.currentTime = 0;
  }
  activeAudio.clear();
}

$("mute").onclick = () => {
  muted = !muted;
  if (muted) stopPlayback();
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
  maskyVoices = cfg.maskyVoices;
  $("mode").textContent = cfg.mockIngest || !cfg.twitchChannel
    ? "demo mode (mock ingest)"
    : `twitch.tv/${cfg.twitchChannel} · stt: ${cfg.sttProvider}`;
});

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

window.hh.onFrame((b64) => { $("frame").src = `data:image/jpeg;base64,${b64}`; });

window.hh.onLabels((labels) => {
  $("labels").innerHTML =
    `<div>${esc(labels.scene || "")}</div>` +
    [...(labels.objects || []), ...(labels.events || [])]
      .map((t) => `<span class="tag">${esc(t)}</span>`)
      .join("");
});

window.hh.onTranscript((text) => append($("transcript"), `🎙 ${esc(text)}`));

window.hh.onCommentary((c) => {
  const lookupText = c.lookupResult?.note ||
    (Array.isArray(c.lookupResult?.answers) ? c.lookupResult.answers.join(" ") : "");
  const lookup = lookupText ? `<div class="lookup">↳ ${esc(lookupText)}</div>` : "";
  append($("commentary"), `<span class="who ${esc(c.persona)}">${esc(c.persona)}</span>${esc(c.line)}${lookup}`);
  // Only speak via speechSynthesis if masky is off; audio arrives via onAudio when masky is on.
  if (!maskyVoices) speak(c.persona, c.line);
});

// masky.ai audio: play received URL (replaces speechSynthesis when masky is configured).
window.hh.onAudio((audio) => {
  if (muted || !audio || !audio.audioUrl) return;
  const a = new Audio(audio.audioUrl);
  const cleanup = () => activeAudio.delete(a);
  activeAudio.add(a);
  a.addEventListener("ended", cleanup, { once: true });
  a.addEventListener("error", cleanup, { once: true });
  a.play().catch(cleanup); // autoplay may be blocked — the live URL remains available
});

window.hh.onStatus((msg) => append($("status"), esc(msg), 100));
