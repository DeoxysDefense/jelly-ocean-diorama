/*
 * Runs in the browser: reads the captured JPEG frames from the local recorder server, encodes them
 * with WebCodecs (H.264, the browser's built-in encoder) at exact timestamps, renders the
 * soundtrack (soundtrack.js) and encodes it as AAC, then writes a standard MP4 with both tracks
 * (hand-built ISO-BMFF: ftyp / mdat / moov). No external tools needed.
 */
window.encodeVideo = async function ({ frames, fps, frameStep = 1, width, height, bitrate, bitrateMode, codec, name, audio = null, audioBitrate = 192000, wavName = null }) {
  // ---------------------------------------------------------------- video
  const vSamples = [];
  let avcC = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => {
      const d = meta && meta.decoderConfig && meta.decoderConfig.description;
      if (d && !avcC) avcC = toBytes(d);
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);
      vSamples.push({ data: buf, key: chunk.type === 'key', ts: chunk.timestamp });
    },
    error: (e) => {
      throw e;
    },
  });
  const outFps = fps / frameStep;
  venc.configure({ codec, width, height, bitrate, bitrateMode, framerate: outFps, avc: { format: 'avc' }, latencyMode: 'quality' });
  const cv = new OffscreenCanvas(width, height);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  let k = 0;
  for (let i = 0; i < frames; i += frameStep, k++) {
    const blob = await (await fetch(`/frame/${i}`)).blob();
    const bmp = await createImageBitmap(blob);
    ctx.drawImage(bmp, 0, 0, width, height);
    bmp.close();
    const vf = new VideoFrame(cv, { timestamp: Math.round((k * 1e6) / outFps), duration: Math.round(1e6 / outFps) });
    venc.encode(vf, { keyFrame: k % Math.round(outFps * 2) === 0 });
    vf.close();
    while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
  }
  await venc.flush();
  venc.close();
  if (!avcC) throw new Error('encoder gave no avcC description');

  // ---------------------------------------------------------------- audio
  let aTrack = null;
  if (audio) {
    const sr = 48000;
    const buffer = await window.renderSoundtrack(audio, sr);
    if (wavName) await fetch(`/out/${wavName}`, { method: 'POST', body: toWav(buffer) });
    const aSamples = [];
    let asc = null;
    const aenc = new AudioEncoder({
      output: (chunk, meta) => {
        const d = meta && meta.decoderConfig && meta.decoderConfig.description;
        if (d && !asc) asc = toBytes(d);
        const buf = new Uint8Array(chunk.byteLength);
        chunk.copyTo(buf);
        aSamples.push({ data: buf });
      },
      error: (e) => {
        throw e;
      },
    });
    aenc.configure({ codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: 2, bitrate: audioBitrate });
    const L = buffer.getChannelData(0),
      R = buffer.getChannelData(1);
    const block = 48000;
    for (let s = 0; s < L.length; s += block) {
      const n = Math.min(block, L.length - s);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(s, s + n), 0);
      data.set(R.subarray(s, s + n), n);
      aenc.encode(new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((s * 1e6) / sr), data }));
    }
    await aenc.flush();
    aenc.close();
    aTrack = { samples: aSamples, asc: asc || new Uint8Array([0x11, 0x90]), sampleRate: sr, channels: 2, bitrate: audioBitrate };
  }

  const mp4 = muxMp4({ samples: vSamples, avcC, width, height, fps: outFps }, aTrack);
  await fetch(`/out/${name}`, { method: 'POST', body: mp4 });
  return { name, bytes: mp4.length, videoSamples: vSamples.length, keys: vSamples.filter((s) => s.key).length, audioFrames: aTrack ? aTrack.samples.length : 0 };
};

function toBytes(d) {
  return d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
}

function toWav(buffer) {
  const ch = buffer.numberOfChannels,
    sr = buffer.sampleRate,
    n = buffer.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  out.setUint32(4, 36 + n * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, sr, true);
  out.setUint32(28, sr * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  w(36, 'data');
  out.setUint32(40, n * ch * 2, true);
  const chans = [...Array(ch)].map((_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  return new Uint8Array(out.buffer);
}

function muxMp4(video, audio) {
  const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const u16 = (v) => [(v >>> 8) & 255, v & 255];
  const str = (s) => [...s].map((c) => c.charCodeAt(0));
  const cat = (...parts) => {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  const box = (type, ...payload) => {
    const body = cat(...payload.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p))));
    return cat(new Uint8Array([...u32(body.length + 8), ...str(type)]), body);
  };
  const full = (type, version, flags, ...payload) => box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...payload);
  const matrix = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];

  const ftyp = box('ftyp', str('isom'), u32(0x200), str('isom'), str('iso2'), str('avc1'), str('mp41'));
  const vData = video.samples.reduce((a, s) => a + s.data.length, 0);
  const aData = audio ? audio.samples.reduce((a, s) => a + s.data.length, 0) : 0;
  const mdatHeader = new Uint8Array([...u32(vData + aData + 8), ...str('mdat')]);
  const vOffset = ftyp.length + 8;
  const aOffset = vOffset + vData;

  // ---- video track
  const vts = video.fps * 1000;
  const vn = video.samples.length;
  const vDur = vn * 1000;
  const vDurMs = Math.round((vn * 1000) / video.fps);
  const pts = video.samples.map((s) => Math.round((s.ts * vts) / 1e6));
  const offsets = pts.map((p, i) => p - i * 1000);
  const needCtts = offsets.some((o) => o !== 0);
  const keys = [];
  video.samples.forEach((s, i) => s.key && keys.push(i + 1));
  const vStbl = box(
    'stbl',
    full(
      'stsd',
      0,
      0,
      u32(1),
      box('avc1', [0, 0, 0, 0, 0, 0, ...u16(1)], new Array(16).fill(0), u16(video.width), u16(video.height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), new Array(32).fill(0), u16(0x0018), u16(0xffff), box('avcC', video.avcC)),
    ),
    full('stts', 0, 0, u32(1), u32(vn), u32(1000)),
    ...(needCtts ? [full('ctts', 1, 0, u32(vn), ...offsets.flatMap((o) => [...u32(1), ...u32(o >>> 0)]))] : []),
    full('stss', 0, 0, u32(keys.length), ...keys.map(u32)),
    full('stsc', 0, 0, u32(1), u32(1), u32(vn), u32(1)),
    full('stsz', 0, 0, u32(0), u32(vn), ...video.samples.map((s) => u32(s.data.length))),
    full('stco', 0, 0, u32(1), u32(vOffset)),
  );
  const vTrak = box(
    'trak',
    full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(vDurMs), u32(0), u32(0), u16(0), u16(0), u16(0), u16(0), matrix, u32(video.width << 16), u32(video.height << 16)),
    box(
      'mdia',
      full('mdhd', 0, 0, u32(0), u32(0), u32(vts), u32(vDur), u16(0x55c4), u16(0)),
      full('hdlr', 0, 0, u32(0), str('vide'), u32(0), u32(0), u32(0), str('VideoHandler'), [0]),
      box('minf', full('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), vStbl),
    ),
  );

  // ---- audio track (AAC-LC, 1024 samples per frame)
  let aTrak = [];
  let aDurMs = 0;
  if (audio) {
    const an = audio.samples.length;
    const aDur = an * 1024;
    aDurMs = Math.round((aDur * 1000) / audio.sampleRate);
    const desc = (tag, bytes) => [tag, bytes.length, ...bytes];
    const asc = [...audio.asc];
    const decSpecific = desc(0x05, asc);
    const decConfig = desc(0x04, [0x40, 0x15, 0, 0, 0, ...u32(audio.bitrate), ...u32(audio.bitrate), ...decSpecific]);
    const esDesc = desc(0x03, [0, 2, 0, ...decConfig, ...desc(0x06, [0x02])]);
    const aStbl = box(
      'stbl',
      full(
        'stsd',
        0,
        0,
        u32(1),
        box('mp4a', [0, 0, 0, 0, 0, 0, ...u16(1)], new Array(8).fill(0), u16(audio.channels), u16(16), u16(0), u16(0), u32(audio.sampleRate << 16), full('esds', 0, 0, esDesc)),
      ),
      full('stts', 0, 0, u32(1), u32(an), u32(1024)),
      full('stsc', 0, 0, u32(1), u32(1), u32(an), u32(1)),
      full('stsz', 0, 0, u32(0), u32(an), ...audio.samples.map((s) => u32(s.data.length))),
      full('stco', 0, 0, u32(1), u32(aOffset)),
    );
    aTrak = [
      box(
        'trak',
        full('tkhd', 0, 3, u32(0), u32(0), u32(2), u32(0), u32(aDurMs), u32(0), u32(0), u16(0), u16(1), u16(0x0100), u16(0), matrix, u32(0), u32(0)),
        box(
          'mdia',
          full('mdhd', 0, 0, u32(0), u32(0), u32(audio.sampleRate), u32(aDur), u16(0x55c4), u16(0)),
          full('hdlr', 0, 0, u32(0), str('soun'), u32(0), u32(0), u32(0), str('SoundHandler'), [0]),
          box('minf', full('smhd', 0, 0, u16(0), u16(0)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), aStbl),
        ),
      ),
    ];
  }
  const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(Math.max(vDurMs, aDurMs)), u32(0x10000), u16(0x100), u16(0), u32(0), u32(0), matrix, new Array(24).fill(0), u32(audio ? 3 : 2));
  const moov = box('moov', mvhd, vTrak, ...aTrak);
  return cat(ftyp, mdatHeader, ...video.samples.map((s) => s.data), ...(audio ? audio.samples.map((s) => s.data) : []), moov);
}
