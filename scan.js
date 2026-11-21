"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const prefix = "inbox-entry.";
  function read(key) {
    try { return localStorage.getItem(prefix + key) || ""; } catch { return ""; }
  }
  function isPrivateIP(ip) {
    return ip.length === 4 && ip.every(n => /^(0|[1-9]\d{0,2})$/.test(n) && +n < 256) &&
      (ip[0] === "10" || (ip[0] === "192" && ip[1] === "168") ||
        (ip[0] === "172" && +ip[1] >= 16 && +ip[1] <= 31));
  }
  function home(value, defaultPort = 8765) {
    const match = /^(?:http:\/\/)?([a-z0-9.-]+)(?::(\d{1,5}))?\/?$/i.exec(value);
    if (!match) return "";
    const host = match[1].toLowerCase();
    const name = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$/.test(host);
    const port = Number(match[2] || defaultPort);
    if ((!name && !isPrivateIP(host.split("."))) || port < 1 || port > 65535) return "";
    return "http://" + host + ":" + port + "/";
  }
  function showRoot(root, desktop = false) {
    $("remembered").href = root;
    $("knownName").textContent = desktop ? "这台电脑" : "已记住的电脑";
    $("knownAddress").textContent = new URL(root).host;
    $("returning").hidden = false;
    $("setup").hidden = true;
    $("pairAgain").hidden = !desktop;
  }
  function remember(root) {
    try {
      localStorage.setItem(prefix + "last", root);
      localStorage.setItem(prefix + "role", "phone");
    } catch { /* Current page can still open the inbox. */ }
    showRoot(root);
  }
  $("desktop").onclick = () => {
    try { localStorage.setItem(prefix + "role", "desktop"); } catch {}
    showRoot("http://127.0.0.1:8765/", true);
  };
  $("changeComputer").onclick = () => {
    $("returning").hidden = true;
    $("setup").hidden = false;
    $("scan").focus();
  };

  function restore() {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const imported = home(fragment.get("addr") || "");
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    if (imported) remember(imported);
    else if (read("role") === "desktop") showRoot("http://127.0.0.1:8765/", true);
    else {
      const network = read("network") === "hotspot" ? "hotspot" : "home";
      const root = home(read("last")) || home(read(network)) || home(read(network === "home" ? "hotspot" : "home"));
      if (root) showRoot(root);
    }
  }
  restore();
  addEventListener("hashchange", restore);
  addEventListener("pageshow", event => { if (event.persisted) restore(); });
  function notice(text) {
    $("notice").textContent = text;
    $("notice").hidden = !text;
  }
  function decodeCode(input) {
    const raw = input.trim().toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
    const match = /^([0-9A-HJKMNP-TV-Z]{12})(?:\.(\d{1,5}))?$/.exec(raw);
    if (!match) return null;
    let value = 0n;
    for (const ch of match[1]) value = (value << 5n) | BigInt(alphabet.indexOf(ch));
    const ip = value >> 27n;
    const digits = Number(value & ((1n << 27n) - 1n));
    if (ip > 0xffffffffn || digits >= 100000000) return null;
    const address = [24n,16n,8n,0n].map(shift => Number((ip >> shift) & 255n)).join(".");
    const root = home(address + ":" + (match[2] || "8765"));
    return root ? { root, path:"p#manual=" + String(digits).padStart(8,"0") } : null;
  }
  function decodeQR(raw) {
    const parts = /^http:\/\/([a-z0-9.-]+(?::\d{1,5})?)\/p#([a-z0-9_-]{32,128})$/i.exec(raw);
    if (!parts || raw !== raw.trim()) return null;
    const root = home(parts[1], 80);
    return root ? { root, path:"p#" + parts[2] } : null;
  }
  function connect(pair) {
    remember(pair.root);
    $("code").value = "";
    stopCamera();
    location.assign(pair.root + pair.path);
  }
  $("enterCode").onclick = () => {
    stopCamera();
    $("codeForm").hidden = false;
    $("enterCode").setAttribute("aria-expanded","true");
    notice("");
    $("code").focus();
  };
  $("codeForm").onsubmit = event => {
    event.preventDefault();
    const result = decodeCode($("code").value);
    if (result) connect(result);
    else { notice("连接码无效，请核对电脑上显示的完整连接码。"); $("code").focus(); }
  };

  const video = $("video");
  let generation = 0;
  let stream = null;
  let qrLibrary = null;
  function stopCamera() {
    generation++;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    $("camera").hidden = true;
    $("scan").disabled = false;
  }
  function loadQRLibrary() {
    if (!qrLibrary) {
      qrLibrary = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "./vendor/jsqr-1.4.0/jsQR.js";
        script.onload = () => resolve(window.jsQR);
        script.onerror = () => { qrLibrary = null; script.remove(); reject(new Error("decoder")); };
        document.head.append(script);
      });
    }
    return qrLibrary;
  }
  async function pixelReader() {
    const decode = await loadQRLibrary();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", {willReadFrequently:true});
    return () => {
      const scale = Math.min(1, 960 / Math.max(video.videoWidth,video.videoHeight));
      const width = Math.max(1,Math.round(video.videoWidth * scale));
      const height = Math.max(1,Math.round(video.videoHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width; canvas.height = height;
      }
      ctx.drawImage(video,0,0,width,height);
      const frame = ctx.getImageData(0,0,width,height);
      return decode(frame.data,width,height,{inversionAttempts:"dontInvert"})?.data;
    };
  }
  async function startCamera() {
    stopCamera();
    const current = generation;
    $("scan").disabled = true;
    $("camera").hidden = false;
    $("codeForm").hidden = true;
    $("enterCode").setAttribute("aria-expanded","false");
    notice("请将电脑上的二维码放入取景框。");
    try {
      const capture = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
      if (current !== generation) { capture.getTracks().forEach(t => t.stop()); return; }
      stream = capture;
      video.srcObject = stream;
      await video.play();
      let detector = null, reader = null;
      if (typeof BarcodeDetector !== "undefined") {
        try { detector = new BarcodeDetector({formats:["qr_code"]}); } catch {}
      }
      if (!detector) reader = await pixelReader();
      while (current === generation) {
        let raw;
        if (video.readyState >= 2) {
          if (detector) {
            try { raw = (await detector.detect(video))[0]?.rawValue; }
            catch { detector = null; reader = await pixelReader(); }
          } else { raw = reader(); }
          if (raw && current === generation) {
            const result = decodeQR(raw);
            if (result) { connect(result); return; }
            notice("这组二维码不属于本地收件箱，请扫描电脑上的配对二维码。");
          }
        }
        await new Promise(resolve => setTimeout(resolve,160));
      }
    } catch {
      if (current !== generation) return;
      stopCamera();
      notice("相机暂时不可用。可以点「输入连接码」，或用手机自带相机扫描电脑二维码。");
    }
  }
  $("scan").onclick = startCamera;
  $("cancelScan").onclick = () => { stopCamera(); notice(""); };
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopCamera(); });
  addEventListener("pagehide", stopCamera);
})();
