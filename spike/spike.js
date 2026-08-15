/* Glimpse Phase 0 spike — iOS Safari diagnostics.
   Throwaway instrument. Nothing here graduates into the app; it exists to
   answer the questions CI cannot answer, on the one device that matters. */
(function () {
  'use strict';

  var REPORT = { env: {}, storage: {}, codecs: {}, clips: [], ffmpeg: {}, events: [] };
  var CLIP_COUNT = 5;
  var CLIP_MS = 1000;
  var GAP_MS = 300;

  var stream = null;
  var audioCtx = null;
  var analyser = null;
  var sampleBuf = null;
  var chosenMime = '';
  var clips = [];
  var ffmpeg = null;
  var ffLog = [];

  function el(id) { return document.getElementById(id); }

  function row(container, key, value, level) {
    var d = document.createElement('div');
    d.className = 'row';
    var dot = level ? '<span class="dot ' + level + '"></span>' : '';
    d.innerHTML = '<div class="k">' + key + '</div><div class="v">' + dot + value + '</div>';
    container.appendChild(d);
    return d;
  }

  function fmtBytes(n) {
    if (n == null || isNaN(n)) return 'unknown';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
  }

  /* ---------- 1 · Environment ---------- */

  function runEnv() {
    var c = el('env');
    var ua = navigator.userAgent;
    var m = ua.match(/OS (\d+)[._](\d+)/);
    var iosVer = m ? m[1] + '.' + m[2] : null;
    var standalone = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

    REPORT.env = {
      ua: ua,
      iosVersion: iosVer,
      standalone: standalone,
      secureContext: window.isSecureContext,
      hasMediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      hasMediaRecorder: typeof window.MediaRecorder !== 'undefined',
      hasStorageManager: !!(navigator.storage && navigator.storage.estimate),
      hasWebShare: !!navigator.share,
      hasWebShareFiles: !!(navigator.canShare && navigator.canShare({
        files: [new File([new Blob(['x'])], 'x.mp4', { type: 'video/mp4' })]
      })),
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      crossOriginIsolated: window.crossOriginIsolated === true,
      screen: window.screen.width + '×' + window.screen.height + ' @' + window.devicePixelRatio + 'x'
    };

    row(c, 'iOS version', iosVer || 'not iOS / unknown', iosVer ? 'pass' : 'info');
    row(c, 'Installed to home screen', standalone ? 'yes' : 'no — running in a tab',
      standalone ? 'pass' : 'warn');
    row(c, 'Secure context', REPORT.env.secureContext ? 'yes' : 'NO — camera will fail',
      REPORT.env.secureContext ? 'pass' : 'fail');
    row(c, 'MediaRecorder', REPORT.env.hasMediaRecorder ? 'available' : 'MISSING',
      REPORT.env.hasMediaRecorder ? 'pass' : 'fail');
    row(c, 'Share files (to Photos)', REPORT.env.hasWebShareFiles ? 'supported' : 'not supported',
      REPORT.env.hasWebShareFiles ? 'pass' : 'warn');
    row(c, 'SharedArrayBuffer', REPORT.env.sharedArrayBuffer ? 'present' : 'absent (expected)', 'info');
    row(c, 'Screen', REPORT.env.screen, 'info');
  }

  /* ---------- 2 · Storage ---------- */

  function runStorage() {
    var c = el('storage');
    c.innerHTML = '';
    if (!navigator.storage || !navigator.storage.estimate) {
      row(c, 'Storage API', 'not available', 'fail');
      REPORT.storage = { available: false };
      return Promise.resolve();
    }
    return Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(null)
    ]).then(function (r) {
      var est = r[0], persisted = r[1];
      REPORT.storage = { quota: est.quota, usage: est.usage, persisted: persisted };
      var gb = est.quota / (1024 * 1024 * 1024);
      row(c, 'Quota', fmtBytes(est.quota) + '  (~' + Math.floor(est.quota / (150 * 1024 * 1024)) + ' × 2-min Glimpse)',
        gb >= 1 ? 'pass' : gb >= 0.2 ? 'warn' : 'fail');
      row(c, 'Currently used', fmtBytes(est.usage), 'info');
      row(c, 'Persistent storage', persisted === null ? 'unknown' : persisted ? 'GRANTED' : 'not granted',
        persisted ? 'pass' : 'warn');
    });
  }

  /* ---------- 3 · Codecs ---------- */

  function runCodecs() {
    var c = el('codecs');
    var candidates = [
      'video/mp4',
      'video/mp4;codecs=avc1',
      'video/mp4;codecs="avc1.42E01E"',
      'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
      'video/mp4;codecs="avc1.4d002a,mp4a.40.2"',
      'video/webm',
      'video/webm;codecs="vp8,opus"',
      'video/webm;codecs="vp9,opus"'
    ];
    if (typeof window.MediaRecorder === 'undefined') {
      row(c, 'MediaRecorder', 'missing', 'fail');
      return;
    }
    var supported = [];
    candidates.forEach(function (mime) {
      var ok = false;
      try { ok = MediaRecorder.isTypeSupported(mime); } catch (e) { ok = false; }
      if (ok) supported.push(mime);
      row(c, mime.replace('video/', ''), ok ? 'supported' : 'no', ok ? 'pass' : 'info');
    });
    REPORT.codecs = { supported: supported };
    // Prefer mp4 with explicit audio codec, then any mp4, then anything.
    chosenMime = supported.filter(function (s) { return s.indexOf('mp4a') > -1; })[0] ||
                 supported.filter(function (s) { return s.indexOf('mp4') > -1; })[0] ||
                 supported[0] || '';
    REPORT.codecs.chosen = chosenMime;
    row(c, 'Will record as', chosenMime || 'NONE — recording impossible',
      chosenMime.indexOf('mp4') > -1 ? 'pass' : chosenMime ? 'warn' : 'fail');
  }

  /* ---------- 4 · Consecutive-clip audio ---------- */

  function sampleRms() {
    if (!analyser) return 0;
    if (analyser.getFloatTimeDomainData) {
      analyser.getFloatTimeDomainData(sampleBuf);
      var s = 0;
      for (var i = 0; i < sampleBuf.length; i++) s += sampleBuf[i] * sampleBuf[i];
      return Math.sqrt(s / sampleBuf.length);
    }
    var b = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(b);
    var t = 0;
    for (var j = 0; j < b.length; j++) { var v = (b[j] - 128) / 128; t += v * v; }
    return Math.sqrt(t / b.length);
  }

  function trackSnapshot() {
    if (!stream) return null;
    var a = stream.getAudioTracks()[0];
    var v = stream.getVideoTracks()[0];
    return {
      audio: a ? { readyState: a.readyState, muted: a.muted, enabled: a.enabled, label: a.label } : null,
      video: v ? { readyState: v.readyState, muted: v.muted, enabled: v.enabled } : null
    };
  }

  function blobDuration(blob) {
    return new Promise(function (res) {
      var v = document.createElement('video');
      var url = URL.createObjectURL(blob);
      var done = false;
      var finish = function (d) { if (done) return; done = true; URL.revokeObjectURL(url); res(d); };
      v.preload = 'metadata';
      v.onloadedmetadata = function () { finish(v.duration); };
      v.onerror = function () { finish(NaN); };
      setTimeout(function () { finish(NaN); }, 3000);
      v.src = url;
    });
  }

  function recordOne(index) {
    return new Promise(function (resolve, reject) {
      var chunks = [];
      var peak = 0;
      var rec;
      try {
        rec = chosenMime ? new MediaRecorder(stream, { mimeType: chosenMime })
                         : new MediaRecorder(stream);
      } catch (e) { reject(e); return; }

      var before = trackSnapshot();
      var rafId;
      var poll = function () { peak = Math.max(peak, sampleRms()); rafId = requestAnimationFrame(poll); };

      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = function (e) { cancelAnimationFrame(rafId); reject(e.error || new Error('recorder error')); };
      rec.onstop = function () {
        cancelAnimationFrame(rafId);
        var blob = new Blob(chunks, { type: chosenMime || 'video/mp4' });
        blobDuration(blob).then(function (dur) {
          resolve({
            index: index, size: blob.size, chunks: chunks.length,
            duration: dur, peakRms: peak,
            before: before, after: trackSnapshot(),
            actualMime: rec.mimeType, blob: blob
          });
        });
      };

      // timeslice → chunks land during recording, not only at stop.
      rec.start(250);
      poll();
      setTimeout(function () { if (rec.state !== 'inactive') rec.stop(); }, CLIP_MS);
    });
  }

  function renderClips() {
    var c = el('clips');
    c.innerHTML = '';
    var silent = 0;
    clips.forEach(function (clip) {
      var quiet = clip.peakRms < 0.005;
      if (quiet) silent++;
      var dur = isFinite(clip.duration) ? clip.duration.toFixed(2) + 's' : 'unreported';
      row(c, 'Clip ' + (clip.index + 1),
        fmtBytes(clip.size) + ' · ' + dur + ' · ' + clip.chunks + ' chunks · peak ' + clip.peakRms.toFixed(4),
        quiet ? 'fail' : 'pass');
    });
    var verdict = silent === 0
      ? 'ALL ' + clips.length + ' CLIPS HAD MIC SIGNAL'
      : silent + ' OF ' + clips.length + ' CLIPS WERE SILENT';
    var d = document.createElement('div');
    d.className = 'row';
    d.innerHTML = '<div class="v big"><span class="dot ' + (silent ? 'fail' : 'pass') + '"></span>' + verdict + '</div>';
    c.appendChild(d);
    REPORT.clips = clips.map(function (x) {
      return {
        index: x.index, size: x.size, chunks: x.chunks, duration: x.duration,
        peakRms: Number(x.peakRms.toFixed(5)), actualMime: x.actualMime,
        before: x.before, after: x.after
      };
    });
    REPORT.silentClips = silent;
  }

  function runRecording() {
    var btn = el('btnRecord');
    var status = el('recStatus');
    btn.disabled = true;
    clips = [];
    el('clips').innerHTML = '';

    status.textContent = 'Requesting camera and microphone…';

    // One getUserMedia call. The stream is then held for every clip — this is
    // precisely the thing the original app appears to get wrong.
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: true
    }).then(function (s) {
      stream = s;
      var v = el('preview');
      v.srcObject = s;
      v.play().catch(function () {});

      s.getTracks().forEach(function (t) {
        t.addEventListener('mute', function () { logEvent('track "' + t.kind + '" MUTED'); });
        t.addEventListener('unmute', function () { logEvent('track "' + t.kind + '" unmuted'); });
        t.addEventListener('ended', function () { logEvent('track "' + t.kind + '" ENDED'); });
      });

      var AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      sampleBuf = new Float32Array(analyser.fftSize);
      audioCtx.createMediaStreamSource(s).connect(analyser);

      var bar = el('meterBar');
      (function meter() {
        bar.style.width = Math.min(100, sampleRms() * 400) + '%';
        requestAnimationFrame(meter);
      })();

      return audioCtx.resume().catch(function () {});
    }).then(function () {
      var seq = Promise.resolve();
      for (var i = 0; i < CLIP_COUNT; i++) {
        (function (n) {
          seq = seq.then(function () {
            status.innerHTML = '<b>Recording clip ' + (n + 1) + ' of ' + CLIP_COUNT + '</b> — make some noise';
            return recordOne(n);
          }).then(function (clip) {
            clips.push(clip);
            renderClips();
            return new Promise(function (r) { setTimeout(r, GAP_MS); });
          });
        })(i);
      }
      return seq;
    }).then(function () {
      status.textContent = 'Done. Camera is still live (that is intentional — test 6 needs it).';
      el('btnConcat').disabled = false;
      btn.textContent = 'Record 5 more clips';
      btn.disabled = false;
      addStopButton();
    }).catch(function (err) {
      status.innerHTML = '<span class="dot fail"></span>Failed: ' + (err && err.name ? err.name + ' — ' : '') + (err && err.message ? err.message : String(err));
      REPORT.recordingError = String(err && err.message || err);
      btn.disabled = false;
    });
  }

  function addStopButton() {
    if (el('btnStop')) return;
    var b = document.createElement('button');
    b.id = 'btnStop';
    b.className = 'ghost';
    b.textContent = 'Stop camera';
    b.onclick = function () {
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      if (audioCtx) audioCtx.close();
      b.disabled = true;
      el('recStatus').textContent = 'Camera stopped.';
    };
    el('btnRecord').parentNode.insertBefore(b, el('recStatus'));
  }

  /* ---------- 5 · ffmpeg concat ---------- */

  function loadFFmpeg() {
    if (ffmpeg) return Promise.resolve();
    if (!window.FFmpegWASM || !window.FFmpegUtil) {
      return Promise.reject(new Error('vendored ffmpeg scripts did not load'));
    }
    ffmpeg = new FFmpegWASM.FFmpeg();
    ffmpeg.on('log', function (e) { ffLog.push(e.message); });
    // Single-threaded core deliberately: GitHub Pages cannot send COOP/COEP,
    // so SharedArrayBuffer is unavailable and the -mt build cannot run.
    // Direct same-origin URLs, not toBlobURL — blob indirection only exists to
    // work around cross-origin CDN loading.
    //
    // Deliberately NOT passing classWorkerURL: the UMD build spawns a *module*
    // worker when it is present, and module workers have no importScripts(), so
    // loading the UMD core fails. Omitting it spawns a classic worker and lets
    // the library resolve ./814.ffmpeg.js relative to ffmpeg.js — which is why
    // that chunk is vendored alongside it.
    var abs = function (p) { return new URL(p, location.href).href; };
    return ffmpeg.load({
      coreURL: abs('./vendor/ffmpeg-core.js'),
      wasmURL: abs('./vendor/ffmpeg-core.wasm')
    });
  }

  function probe(name) {
    var mark = ffLog.length;
    return ffmpeg.exec(['-i', name]).catch(function () {}).then(function () {
      var lines = ffLog.slice(mark).filter(function (l) { return /Stream #|Duration:/.test(l); });
      return lines.join(' | ') || '(no stream info)';
    });
  }

  function runConcat() {
    var btn = el('btnConcat');
    var status = el('ffStatus');
    var results = el('ffResults');
    results.innerHTML = '';
    btn.disabled = true;

    if (!clips.length) { status.textContent = 'Run test 4 first.'; btn.disabled = false; return; }

    var t0 = performance.now();
    status.textContent = 'Loading ffmpeg core (~30 MB, first time only)…';

    loadFFmpeg().then(function () {
      REPORT.ffmpeg.loadMs = Math.round(performance.now() - t0);
      status.textContent = 'Writing clips…';
      var seq = Promise.resolve();
      clips.forEach(function (clip, i) {
        seq = seq.then(function () {
          return clip.blob.arrayBuffer().then(function (ab) {
            return ffmpeg.writeFile('clip' + i + '.mp4', new Uint8Array(ab));
          });
        });
      });
      return seq;
    }).then(function () {
      status.textContent = 'Probing streams…';
      var probes = [];
      var seq = Promise.resolve();
      clips.forEach(function (clip, i) {
        seq = seq.then(function () {
          return probe('clip' + i + '.mp4').then(function (info) { probes.push({ i: i, info: info }); });
        });
      });
      return seq.then(function () { return probes; });
    }).then(function (probes) {
      REPORT.ffmpeg.probes = probes;
      var missingAudio = 0;
      probes.forEach(function (p) {
        var hasAudio = /Audio:/.test(p.info);
        if (!hasAudio) missingAudio++;
        row(results, 'Clip ' + (p.i + 1) + ' streams', p.info, hasAudio ? 'pass' : 'fail');
      });
      REPORT.ffmpeg.clipsMissingAudioTrack = missingAudio;

      var list = clips.map(function (_, i) { return "file 'clip" + i + ".mp4'"; }).join('\n');
      return ffmpeg.writeFile('list.txt', new TextEncoder().encode(list));
    }).then(function () {
      status.textContent = 'Concatenating with -c copy…';
      var t1 = performance.now();
      return ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'out.mp4'])
        .then(function (code) {
          return { ms: Math.round(performance.now() - t1), code: code, mode: 'copy' };
        })
        .catch(function () {
          status.textContent = '-c copy failed, retrying with re-encode…';
          var t2 = performance.now();
          return ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt',
            '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', 'out.mp4'])
            .then(function (code) {
              return { ms: Math.round(performance.now() - t2), code: code, mode: 'reencode' };
            });
        });
    }).then(function (r) {
      REPORT.ffmpeg.concat = r;
      return ffmpeg.readFile('out.mp4').then(function (data) {
        var blob = new Blob([data.buffer], { type: 'video/mp4' });
        REPORT.ffmpeg.outputBytes = blob.size;
        var v = el('output');
        v.src = URL.createObjectURL(blob);
        v.style.display = 'block';
        row(results, 'Concat mode', r.mode === 'copy' ? '-c copy (no re-encode)' : 're-encoded (copy failed)',
          r.mode === 'copy' ? 'pass' : 'warn');
        row(results, 'Concat time', r.ms + ' ms', r.ms < 3000 ? 'pass' : 'warn');
        row(results, 'ffmpeg load time', REPORT.ffmpeg.loadMs + ' ms', 'info');
        row(results, 'Output size', fmtBytes(blob.size), 'info');
        status.textContent = 'Done — play the result below and check the audio.';
        btn.disabled = false;
      });
    }).catch(function (err) {
      REPORT.ffmpeg.error = String(err && err.message || err);
      status.innerHTML = '<span class="dot fail"></span>ffmpeg failed: ' + REPORT.ffmpeg.error;
      var pre = document.createElement('pre');
      pre.textContent = ffLog.slice(-40).join('\n');
      results.appendChild(pre);
      btn.disabled = false;
    });
  }

  /* ---------- 6 · Interruptions ---------- */

  function logEvent(what) {
    var entry = { t: new Date().toISOString().substr(11, 12), what: what };
    REPORT.events.push(entry);
    var c = el('events');
    if (REPORT.events.length === 1) c.innerHTML = '';
    row(c, entry.t, what, 'info');
  }

  function wireEvents() {
    document.addEventListener('visibilitychange', function () {
      logEvent('visibilitychange → ' + document.visibilityState +
        (stream ? ' (audio track: ' + (stream.getAudioTracks()[0] || {}).readyState + ')' : ''));
    });
    window.addEventListener('pagehide', function () { logEvent('pagehide'); });
    window.addEventListener('pageshow', function () { logEvent('pageshow'); });
    window.addEventListener('freeze', function () { logEvent('freeze'); });
    window.addEventListener('resume', function () { logEvent('resume'); });
  }

  /* ---------- Report ---------- */

  function buildReport() {
    return 'GLIMPSE SPIKE RESULTS\n' +
      new Date().toISOString() + '\n\n' +
      JSON.stringify(REPORT, null, 2);
  }

  function copyResults() {
    var text = buildReport();
    var status = el('copyStatus');
    var done = function () { status.innerHTML = '<span class="dot pass"></span>Copied — paste it back into the chat.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallback(text, status); });
    } else {
      fallback(text, status);
    }
  }

  function fallback(text, status) {
    var pre = document.createElement('pre');
    pre.textContent = text;
    pre.style.userSelect = 'text';
    pre.style.webkitUserSelect = 'text';
    status.innerHTML = 'Could not copy automatically — select and copy the text below.';
    status.parentNode.appendChild(pre);
  }

  /* ---------- Boot ---------- */

  window.__report = REPORT; // exposed for the smoke test and for Safari debugging

  runEnv();
  runStorage();
  runCodecs();
  wireEvents();

  el('btnPersist').onclick = function () {
    if (!navigator.storage || !navigator.storage.persist) return;
    navigator.storage.persist().then(function (granted) {
      REPORT.storage.persistRequested = granted;
      runStorage();
      el('btnPersist').textContent = granted ? 'Persistent storage GRANTED' : 'Request denied — try after installing to home screen';
    });
  };
  el('btnRecord').onclick = runRecording;
  el('btnConcat').onclick = runConcat;
  el('btnCopy').onclick = copyResults;
})();
