// COOL DUDEZ STUDIO — phone app controller. Vanilla JS, strict-CSP safe (no
// inline handlers). Talks to /api/studio/*; plays the built game in a sandboxed
// iframe on the games origin.
(function () {
  "use strict";

  var sessionId = null;
  var building = false;
  var allowFree = false;
  var isDone = false;
  var currentArtSlot = null; // 'hero' | 'good' | 'bad' when the step offers a custom look
  var arting = false; // a draw/upload request is in flight

  function $(id) { return document.getElementById(id); }
  function show(name) {
    ["gate", "welcome", "wizard", "play", "off"].forEach(function (s) {
      $("s-" + s).classList.toggle("on", s === name);
    });
  }
  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    }).then(function (r) {
      return r.json().catch(function () { return {}; });
    });
  }

  // ---- wizard rendering ----
  function busy(on) {
    $("thinking").classList.toggle("hide", !on);
    $("chips").classList.toggle("hide", on);
    $("art").classList.toggle("hide", on || !currentArtSlot);
    $("freeform").classList.toggle("hide", on || !allowFree);
    $("buildBtn").classList.toggle("hide", on || !isDone);
  }

  function renderStep(step) {
    if (!step) step = { prompt: "Hmm — let's try that again!", chips: [], allowFreeform: true, done: false };
    allowFree = !!step.allowFreeform;
    isDone = !!step.done;
    $("wizErr").textContent = "";
    $("prompt").textContent = step.prompt || "…";

    var chips = $("chips");
    chips.innerHTML = "";
    (step.chips || []).forEach(function (label) {
      var b = document.createElement("button");
      b.className = "chip";
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", function () { sendInput(label); });
      chips.appendChild(b);
    });

    // Custom-art panel: shown only when the step invites a look for a character.
    currentArtSlot = step.artSlot || null;
    $("art").classList.toggle("hide", !currentArtSlot);
    $("drawBox").classList.add("hide");
    $("artPreview").classList.add("hide");
    $("artNext").classList.add("hide");
    $("artNote").textContent = "";
    $("drawInput").value = "";
    $("drawBtn").disabled = false;
    $("uploadBtn").disabled = false;
    $("drawGo").disabled = false;

    $("thinking").classList.add("hide");
    chips.classList.remove("hide");
    $("freeform").classList.toggle("hide", !allowFree);
    $("buildBtn").classList.toggle("hide", !isDone);
    $("freeInput").value = "";
  }

  // ---- custom art (Draw / Upload) ----
  function artBusy(on, label) {
    arting = on;
    $("drawBtn").disabled = on;
    $("uploadBtn").disabled = on;
    $("drawGo").disabled = on;
    $("artNote").textContent = on ? (label || "working…") : "";
  }

  function onArtResult(r) {
    artBusy(false);
    if (r && r.ok && r.img) {
      var pv = $("artPreview");
      pv.src = r.img;
      pv.classList.remove("hide");
      $("artNote").textContent = "Looks great!";
      // Always give a way forward — the wizard step may not have offered any chips.
      $("artNext").classList.remove("hide");
    } else {
      $("artNote").textContent = (r && r.error) || "that didn't work — try again";
    }
  }

  function doDraw() {
    if (!sessionId || arting || !currentArtSlot) return;
    var desc = $("drawInput").value.trim();
    if (!desc) { $("drawInput").focus(); return; }
    artBusy(true, "drawing…");
    api("POST", "/api/studio/session/" + encodeURIComponent(sessionId) + "/draw",
      { slot: currentArtSlot, index: 0, description: desc })
      .then(onArtResult).catch(function () { onArtResult(null); });
  }

  // Read a chosen photo/drawing, downscale to <=512px on a canvas (keeps the upload
  // small; the server re-encodes to a 256² PNG anyway), return a PNG data URL.
  function fileToSprite(file, cb) {
    if (!file) { cb(null); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 512, scale = Math.min(1, max / Math.max(img.width, img.height));
        var cw = Math.max(1, Math.round(img.width * scale)), ch = Math.max(1, Math.round(img.height * scale));
        var cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
        cv.getContext("2d").drawImage(img, 0, 0, cw, ch);
        try { cb(cv.toDataURL("image/png")); } catch (e) { cb(null); }
      };
      img.onerror = function () { cb(null); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  function doUpload(file) {
    if (!sessionId || arting || !currentArtSlot) return;
    artBusy(true, "adding your picture…");
    fileToSprite(file, function (dataUrl) {
      if (!dataUrl) { onArtResult({ error: "couldn't read that picture" }); return; }
      api("POST", "/api/studio/session/" + encodeURIComponent(sessionId) + "/asset",
        { slot: currentArtSlot, index: 0, image: dataUrl })
        .then(onArtResult).catch(function () { onArtResult(null); });
    });
  }

  function sendInput(input) {
    if (!sessionId || building) return;
    busy(true);
    api("POST", "/api/studio/session/" + encodeURIComponent(sessionId) + "/turn", { input: input }).then(function (r) {
      if (r && r.ok) renderStep(r.step);
      else { busy(false); $("wizErr").textContent = (r && r.error) || "oops — tap a choice to try again"; }
    });
  }

  function sendFree() {
    var v = $("freeInput").value.trim();
    if (v) sendInput(v);
  }

  // ---- gate ----
  function submitCode() {
    var code = $("code").value.trim();
    if (!code) return;
    $("gateErr").textContent = "";
    $("codeBtn").disabled = true;
    api("POST", "/api/studio/gate", { code: code }).then(function (r) {
      $("codeBtn").disabled = false;
      if (r && r.ok) show("welcome");
      else $("gateErr").textContent = (r && r.error) || "hmm, that's not it";
    });
  }

  // ---- build ----
  function build() {
    if (!sessionId || building) return;
    building = true;
    $("buildBtn").disabled = true;
    $("buildBtn").textContent = "✨ Building…";
    api("POST", "/api/studio/session/" + encodeURIComponent(sessionId) + "/build").then(function (r) {
      building = false;
      $("buildBtn").disabled = false;
      $("buildBtn").textContent = "✨ Build my game!";
      if (r && r.ok && r.previewUrl) {
        $("gameTitle").textContent = r.title || "Your game";
        $("frame").src = r.previewUrl;
        show("play");
      } else {
        $("wizErr").textContent = (r && r.error) || "couldn't build it — try again";
      }
    });
  }

  // ---- wire up ----
  $("codeBtn").addEventListener("click", submitCode);
  $("code").addEventListener("keydown", function (e) { if (e.key === "Enter") submitCode(); });

  $("startBtn").addEventListener("click", function () {
    $("startBtn").disabled = true;
    api("POST", "/api/studio/session").then(function (r) {
      $("startBtn").disabled = false;
      if (r && r.ok) { sessionId = r.sessionId; show("wizard"); renderStep(r.step); }
      else show("gate");
    });
  });

  $("sendBtn").addEventListener("click", sendFree);
  $("freeInput").addEventListener("keydown", function (e) { if (e.key === "Enter") sendFree(); });
  $("buildBtn").addEventListener("click", build);

  $("drawBtn").addEventListener("click", function () { $("drawBox").classList.toggle("hide"); $("drawInput").focus(); });
  $("drawGo").addEventListener("click", doDraw);
  $("drawInput").addEventListener("keydown", function (e) { if (e.key === "Enter") doDraw(); });
  $("artNext").addEventListener("click", function () { sendInput("That's the look I want — let's keep going!"); });
  $("uploadBtn").addEventListener("click", function () { $("fileInput").click(); });
  $("fileInput").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    if (f) doUpload(f);
    e.target.value = "";
  });

  $("againBtn").addEventListener("click", function () {
    sessionId = null;
    $("frame").src = "about:blank";
    show("welcome");
  });
  $("replayBtn").addEventListener("click", function () {
    var src = $("frame").src;
    $("frame").src = "about:blank";
    setTimeout(function () { $("frame").src = src; }, 40);
  });

  // ---- voice (Web Speech, progressive enhancement) ----
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    var rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    var listening = false;
    var mic = $("micBtn");
    mic.classList.remove("hide");
    rec.addEventListener("result", function (e) {
      var alt = e.results && e.results[0] && e.results[0][0];
      if (alt && alt.transcript) $("freeInput").value = alt.transcript.trim();
    });
    rec.addEventListener("end", function () { listening = false; mic.classList.remove("live"); });
    rec.addEventListener("error", function () { listening = false; mic.classList.remove("live"); });
    mic.addEventListener("click", function () {
      if (listening) { rec.stop(); return; }
      try { rec.start(); listening = true; mic.classList.add("live"); } catch (e) { /* already running */ }
    });
  }

  // ---- init ----
  api("GET", "/api/studio/status").then(function (s) {
    if (!s || !s.enabled) return show("off");
    if (s.gated) return show("welcome");
    show("gate");
    $("code").focus();
  }).catch(function () { show("gate"); });
})();
