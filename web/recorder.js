/* Perekam suara: rekam dari mikrofon, lalu ubah ke WAV 16 kHz mono (format yang pasti dipahami Gemini). */
(function (root) {
  const TARGET_RATE = 16000;
  let stream = null, recorder = null, chunks = [], mime = '';

  function pickMime() {
    const options = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
    return options.find((m) => root.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
  }

  async function start() {
    if (!navigator.mediaDevices || !root.MediaRecorder) {
      throw new Error('Browser ini belum mendukung rekam suara. Pakai Safari (iPhone) atau Chrome terbaru.');
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mime = pickMime();
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.start();
  }

  function stopTracks() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function stop() {
    return new Promise((resolve) => {
      if (!recorder || recorder.state === 'inactive') { stopTracks(); resolve(null); return; }
      recorder.onstop = () => {
        stopTracks();
        resolve(new Blob(chunks, { type: recorder.mimeType || mime || 'audio/mp4' }));
      };
      recorder.stop();
    });
  }

  function cancel() {
    if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop(); }
    stopTracks();
  }

  function toBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function encodeWav(samples, rate) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  /** Kembalikan { data: base64, mime } siap dikirim ke server. */
  async function toPayload(blob) {
    const raw = await blob.arrayBuffer();
    try {
      const Ctx = root.AudioContext || root.webkitAudioContext;
      const ctx = new Ctx();
      const decoded = await ctx.decodeAudioData(raw.slice(0));
      ctx.close && ctx.close();
      const length = Math.ceil(decoded.duration * TARGET_RATE);
      const off = new OfflineAudioContext(1, length, TARGET_RATE);
      const src = off.createBufferSource();
      src.buffer = decoded;
      src.connect(off.destination);
      src.start();
      const rendered = await off.startRendering();
      return { data: toBase64(encodeWav(rendered.getChannelData(0), TARGET_RATE)), mime: 'audio/wav' };
    } catch (e) {
      // Kalau konversi gagal, kirim apa adanya dengan nama format yang dikenal Gemini.
      const type = (blob.type || '').split(';')[0];
      const mapped = type === 'audio/mp4' ? 'audio/m4a' : (type || 'audio/m4a');
      return { data: toBase64(raw), mime: mapped };
    }
  }

  root.HBRecorder = { start, stop, cancel, toPayload };
})(this);
