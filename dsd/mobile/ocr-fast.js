(function () {
  'use strict';

  // Keep OCR on the phone. Only a confirmed recipient/address is sent to DSD.
  const SCAN_DELAY_MS = 750;
  const MAX_OCR_WIDTH = 1150;
  const MIN_CONFIDENCE = 80;

  function create(options) {
    const video = options.video;
    const guide = options.guide;
    let enabled = false;
    let visible = true;
    let busy = false;
    let reviewBlocked = false;
    let worker = null;
    let workerLoading = null;
    let timer = null;
    let candidateKey = '';
    let confirmations = 0;
    let savedKey = '';
    let previousSample = null;

    function status(message) { options.onStatus(message); }
    function metrics(message) { options.onMetric(message); }
    function identity(parsed) {
      return (parsed.name || '').trim().replace(/\s+/g, '') + '|' +
        (parsed.address || '').trim().replace(/\s+/g, '');
    }
    function eligible(parsed, confidence) {
      const address = (parsed.address || '').trim();
      const name = (parsed.name || '').trim();
      return confidence >= MIN_CONFIDENCE &&
        /^[가-힣]{2,5}$/.test(name) &&
        address.length >= 12 &&
        /\d/.test(address) &&
        /(?:시|도|군|구|서울|경기|충북|충남|경북|경남|전북|전남|강원|제주)/.test(address) &&
        /(?:로|길|동|읍|면)\s*\d/.test(address);
    }

    async function prewarm() {
      if (worker) return worker;
      if (!workerLoading) {
        workerLoading = (async function () {
          if (!window.Tesseract) throw new Error('OCR 라이브러리를 불러오지 못했습니다');
          status('한국어 OCR 엔진 준비 중… (첫 실행은 다운로드가 필요합니다)');
          const ready = await Tesseract.createWorker('kor+eng', 1, {
            logger: function (event) {
              if (event.status === 'recognizing text' && busy) {
                metrics('문자 인식 ' + Math.round((event.progress || 0) * 100) + '%');
              }
            }
          });
          await ready.setParameters({
            tessedit_pageseg_mode: Tesseract.PSM ? Tesseract.PSM.SINGLE_BLOCK : '6',
            preserve_interword_spaces: '1'
          });
          worker = ready;
          status('OCR 준비 완료 · 송장을 녹색 테두리에 맞추세요');
          return ready;
        })().catch(function (error) {
          workerLoading = null;
          throw error;
        });
      }
      return workerLoading;
    }

    // The guide is positioned on an object-fit: cover video. Convert its
    // visible CSS rectangle back into native camera coordinates before OCR.
    function cameraCanvas() {
      if (!video.videoWidth || !video.videoHeight) throw new Error('카메라 준비 중');
      const display = video.getBoundingClientRect();
      const target = guide.getBoundingClientRect();
      if (!display.width || !display.height) throw new Error('스캔 화면이 보이지 않습니다');
      const scale = Math.max(display.width / video.videoWidth, display.height / video.videoHeight);
      const overflowX = (video.videoWidth * scale - display.width) / 2;
      const overflowY = (video.videoHeight * scale - display.height) / 2;
      const x0 = Math.max(0, (target.left - display.left + overflowX) / scale);
      const y0 = Math.max(0, (target.top - display.top + overflowY) / scale);
      const x1 = Math.min(video.videoWidth, (target.right - display.left + overflowX) / scale);
      const y1 = Math.min(video.videoHeight, (target.bottom - display.top + overflowY) / scale);
      if (x1 <= x0 || y1 <= y0) throw new Error('스캔 범위를 확인하세요');
      const width = x1 - x0, height = y1 - y0;
      const shrink = Math.min(1, MAX_OCR_WIDTH / width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * shrink));
      canvas.height = Math.max(1, Math.round(height * shrink));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.imageSmoothingQuality = 'high';
      context.drawImage(video, x0, y0, width, height, 0, 0, canvas.width, canvas.height);
      return canvas;
    }

    function stableEnough(canvas) {
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 64;
      sampleCanvas.height = 36;
      const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0, 64, 36);
      const rgba = ctx.getImageData(0, 0, 64, 36).data;
      const pixels = new Uint8Array(64 * 36);
      let edges = 0, movement = 0;
      for (let i = 0; i < pixels.length; i++) {
        const offset = i * 4;
        const value = Math.round((rgba[offset] * 3 + rgba[offset + 1] * 6 + rgba[offset + 2]) / 10);
        pixels[i] = value;
        if (i % 64 !== 0) edges += Math.abs(value - pixels[i - 1]);
        if (previousSample) movement += Math.abs(value - previousSample[i]);
      }
      const edgeScore = edges / (36 * 63);
      const motionScore = previousSample ? movement / pixels.length : 0;
      previousSample = pixels;
      if (edgeScore < 4.5) { status('글자가 흐립니다 · 송장을 가까이 고정하세요'); return false; }
      if (motionScore > 29) { status('움직임 감지 · 잠시 고정하세요'); return false; }
      return true;
    }

    function cancelTimer() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    }
    function schedule(delay) {
      cancelTimer();
      if (!enabled || !visible || reviewBlocked || busy || !video.videoWidth) return;
      timer = setTimeout(autoTick, delay);
    }
    function autoTick() {
      timer = null;
      if (!enabled || !visible || reviewBlocked || busy) return;
      let canvas;
      try {
        canvas = cameraCanvas();
        if (!stableEnough(canvas)) { schedule(SCAN_DELAY_MS); return; }
      } catch (error) {
        status(error.message);
        schedule(SCAN_DELAY_MS);
        return;
      }
      process(canvas, false);
    }

    async function process(canvas, manual) {
      if (busy) { status('이전 송장을 인식하는 중입니다'); return; }
      busy = true;
      cancelTimer();
      options.onBusy(true);
      try {
        const ocr = await prewarm();
        if (!manual && (!enabled || !visible || reviewBlocked)) return;
        const started = performance.now();
        const result = await ocr.recognize(canvas);
        const time = Math.round(performance.now() - started);
        const raw = result.data.text || '';
        const parsed = options.parse(raw);
        const confidence = Number(result.data.confidence) || 0;
        metrics('OCR ' + time + 'ms · 신뢰도 ' + Math.round(confidence) + '%');
        if (manual) {
          reviewBlocked = true;
          options.onReview(parsed, raw, confidence, '결과를 확인하고 주소를 등록하세요');
          return;
        }
        if (!parsed.address) {
          candidateKey = '';
          confirmations = 0;
          status('주소를 찾지 못했습니다 · 송장 주소 부분을 맞추세요');
          return;
        }
        const key = identity(parsed);
        if (key === savedKey) {
          status('등록된 송장입니다 · 다음 송장을 보여주세요 (동일 주소 재등록은 촬영 버튼)');
          return;
        }
        if (!eligible(parsed, confidence)) {
          reviewBlocked = true;
          options.onReview(parsed, raw, confidence, '주소 또는 이름을 확인해 주세요');
          return;
        }
        if (key === candidateKey) confirmations++;
        else { candidateKey = key; confirmations = 1; }
        if (confirmations < 2) {
          status('주소 인식됨 · 같은 결과인지 한 번 더 확인합니다');
          return;
        }
        status('주소 확인 완료 · 배송지 등록 중…');
        const saved = await options.onAutoSave(parsed);
        if (saved) {
          savedKey = key;
          candidateKey = '';
          confirmations = 0;
          status('등록 완료 · 다음 송장을 보여주세요');
        } else {
          reviewBlocked = true;
          options.onReview(parsed, raw, confidence, '이미 등록된 이름과 주소입니다 · 별도 배송인지 확인하세요');
        }
      } catch (error) {
        status('OCR 오류: ' + (error.message || String(error)));
        if (manual) reviewBlocked = false;
      } finally {
        busy = false;
        options.onBusy(false);
        schedule(SCAN_DELAY_MS);
      }
    }

    function manualCapture() {
      if (busy) { status('인식 중입니다 · 잠시 후 촬영하세요'); return; }
      cancelTimer();
      reviewBlocked = true;
      try { process(cameraCanvas(), true); }
      catch (error) { reviewBlocked = false; status(error.message); schedule(SCAN_DELAY_MS); }
    }
    async function recognizePhoto(file) {
      if (busy) { status('인식 중입니다 · 잠시 후 다시 선택하세요'); return; }
      cancelTimer();
      reviewBlocked = true;
      try {
        let image, cleanup = function () {};
        if (window.createImageBitmap) {
          image = await createImageBitmap(file);
          cleanup = function () { image.close(); };
        } else {
          const url = URL.createObjectURL(file);
          cleanup = function () { URL.revokeObjectURL(url); };
          image = await new Promise(function (resolve, reject) {
            const element = new Image();
            element.onload = function () { resolve(element); };
            element.onerror = function () { reject(new Error('사진을 열 수 없습니다')); };
            element.src = url;
          });
        }
        try {
          const width = image.width || image.naturalWidth;
          const height = image.height || image.naturalHeight;
          const ratio = Math.min(1, 1550 / width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(width * ratio);
          canvas.height = Math.round(height * ratio);
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          await process(canvas, true);
        } finally { cleanup(); }
      } catch (error) {
        reviewBlocked = false;
        status('사진 오류: ' + error.message);
        schedule(SCAN_DELAY_MS);
      }
    }

    function setEnabled(value) {
      enabled = Boolean(value);
      previousSample = null;
      if (!enabled) { cancelTimer(); status('자동 스캔 중지 · 촬영 버튼은 사용할 수 있습니다'); }
      else { status('자동 스캔 활성 · 주소를 녹색 테두리에 맞추세요'); schedule(150); }
    }
    function setVisible(value) {
      visible = Boolean(value);
      previousSample = null;
      if (!visible) cancelTimer();
      else schedule(150);
    }
    function resume() {
      reviewBlocked = false;
      candidateKey = '';
      confirmations = 0;
      previousSample = null;
      status('다음 송장을 보여주세요');
      schedule(450);
    }
    function markSaved(parsed) {
      savedKey = identity(parsed);
      resume();
    }
    function dispose() {
      cancelTimer();
      enabled = false;
      if (worker) worker.terminate().catch(function () {});
    }
    return { prewarm, setEnabled, setVisible, manualCapture, recognizePhoto, resume, markSaved, dispose };
  }

  window.DoroFastOCR = { create: create };
})();