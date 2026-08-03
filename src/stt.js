const fs = require("fs");

// Speech-to-text for the human's audio. Provider chosen by STT_PROVIDER:
// "deepgram" | "whisper" | "none". Returns transcript text or null.
async function transcribe(wavPath, sttConfig) {
  try {
    if (sttConfig.provider === "deepgram" && sttConfig.deepgramApiKey) {
      const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-2", {
        method: "POST",
        headers: {
          authorization: `Token ${sttConfig.deepgramApiKey}`,
          "content-type": "audio/wav",
        },
        body: fs.readFileSync(wavPath),
      });
      const json = await res.json();
      return json.results?.channels?.[0]?.alternatives?.[0]?.transcript || null;
    }
    if (sttConfig.provider === "whisper" && sttConfig.openaiApiKey) {
      const form = new FormData();
      form.append("model", "whisper-1");
      form.append("file", new Blob([fs.readFileSync(wavPath)], { type: "audio/wav" }), "seg.wav");
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { authorization: `Bearer ${sttConfig.openaiApiKey}` },
        body: form,
      });
      const json = await res.json();
      return json.text || null;
    }
    return null;
  } catch {
    return null;
  } finally {
    fs.rm(wavPath, { force: true }, () => {});
  }
}

module.exports = { transcribe };
