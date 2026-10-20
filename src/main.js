import { buildRecolorUrl, genRecolorParam, normalizeHex, sanitizePrompt } from "./recolor.js";

const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

const PRESET_COLORS = ["#E11D48", "#F97316", "#FACC15", "#16A34A", "#0EA5E9", "#2563EB", "#7C3AED", "#F5F5F4", "#1C1917"];

// Detected tags that describe people rather than recolorable objects.
const IGNORED_TAGS = new Set(["furniture", "girl", "spectacles", "necktie", "man", "woman", "boy", "human-face", "person"]);
const MAX_OBJECTS = 12;

// gen_recolor runs on the first request for a URL and can take tens of seconds.
// Cloudinary answers 423 while a derived asset is still being generated, so we retry with backoff.
const RETRYABLE_STATUS = new Set([423, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 2000;

const $ = (id) => document.getElementById(id);

const state = {
  asset: null, // { publicId, version, format, secureUrl }
  hex: "2563EB",
  controller: null,
  resultObjectUrl: null,
  lastRequest: null,
};

// ---------- Config ----------

if (!cloudName || !uploadPreset) {
  $("config_error").hidden = false;
  $("config_error").textContent =
    "Missing Cloudinary configuration. Copy .env.example to .env, set VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET, then restart the dev server.";
  $("upload_widget").disabled = true;
}

// ---------- Upload ----------

const widget = window.cloudinary?.createUploadWidget(
  {
    cloudName,
    uploadPreset,
    maxFiles: 1,
    multiple: false,
    sources: ["local", "url", "camera"],
    clientAllowedFormats: ["jpg", "jpeg", "png", "webp"],
    maxImageFileSize: 10_000_000,
  },
  (error, result) => {
    if (error) {
      alert(`Upload failed: ${error.statusText ?? error.message ?? "unknown error"}`);
      return;
    }
    if (result?.event === "success") handleUpload(result.info);
  }
);

$("upload_widget").addEventListener("click", () => widget?.open());

function handleUpload(info) {
  const moderation = info.moderation?.[0];
  if (moderation && moderation.status !== "approved") {
    alert("Your image didn't pass moderation. Try a different image.");
    return;
  }

  state.asset = {
    publicId: info.public_id,
    version: info.version,
    format: info.format,
    secureUrl: info.secure_url,
  };

  const ratio = info.width && info.height ? `${info.width} / ${info.height}` : "4 / 3";
  $("orig_frame").style.setProperty("--frame-ratio", ratio);
  $("result_frame").style.setProperty("--frame-ratio", ratio);
  $("orig_img").src = info.secure_url;
  $("orig_url").textContent = info.secure_url;

  renderObjects(detectedObjects(info));

  $("upload_section").hidden = true;
  $("editor").hidden = false;
  updatePreview();
}

// Collect tag names from every object detection model the preset ran (unidet, lvis, ...).
function detectedObjects(info) {
  const models = info.info?.detection?.object_detection?.data ?? {};
  const names = new Set();
  for (const model of Object.values(models)) {
    for (const tag of Object.keys(model?.tags ?? {})) {
      if (!IGNORED_TAGS.has(tag)) names.add(tag);
    }
  }
  return [...names].slice(0, MAX_OBJECTS);
}

function renderObjects(objects) {
  const container = $("object_div");
  container.replaceChildren(
    ...objects.map((name) => {
      const label = document.createElement("label");
      label.className = "chip";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "objects";
      input.value = name;
      input.className = "sr-only";
      label.append(input, name.replaceAll("-", " "));
      return label;
    })
  );
  $("detected_intro").textContent = objects.length
    ? "AI object detection found these objects in your image:"
    : "No objects were detected automatically. Describe the object you want to recolor below.";
}

// ---------- Color picker ----------

const presets = $("presets");
for (const color of PRESET_COLORS) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "preset";
  button.style.backgroundColor = color;
  button.dataset.hex = color.slice(1);
  button.setAttribute("role", "radio");
  button.setAttribute("aria-label", color);
  button.addEventListener("click", () => setColor(button.dataset.hex));
  presets.append(button);
}

function setColor(hex, { fromText = false } = {}) {
  state.hex = hex;
  $("color").value = `#${hex}`;
  if (!fromText) $("hex").value = `#${hex}`;
  $("hex").removeAttribute("aria-invalid");
  $("hex_error").hidden = true;
  for (const button of presets.children) {
    button.setAttribute("aria-checked", String(button.dataset.hex === hex));
  }
  updatePreview();
}

$("color").addEventListener("input", (event) => setColor(normalizeHex(event.target.value)));

$("hex").addEventListener("input", (event) => {
  const hex = normalizeHex(event.target.value);
  if (hex) setColor(hex, { fromText: true });
});

$("hex").addEventListener("blur", (event) => {
  if (normalizeHex(event.target.value)) return;
  event.target.setAttribute("aria-invalid", "true");
  $("hex_error").hidden = false;
});

setColor(state.hex);

// ---------- Transformation preview ----------

function selectedPrompts() {
  const checked = [...document.querySelectorAll('input[name="objects"]:checked')].map((input) =>
    sanitizePrompt(input.value.replaceAll("-", " "))
  );
  const custom = sanitizePrompt($("custom_object").value);
  return [...new Set(custom ? [...checked, custom] : checked)];
}

function currentOptions() {
  return { prompts: selectedPrompts(), hex: state.hex, multiple: $("multiple").checked };
}

function updatePreview() {
  const options = currentOptions();
  $("param_preview").textContent = options.prompts.length
    ? genRecolorParam(options)
    : "Select at least one object to build the gen_recolor transformation.";
}

$("choices").addEventListener("input", updatePreview);
$("choices").addEventListener("change", updatePreview);

// ---------- Recolor request ----------

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });

async function fetchTransformed(url, signal, onAttempt) {
  for (let attempt = 1; ; attempt++) {
    onAttempt(attempt);
    let response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      if (signal.aborted || attempt >= MAX_ATTEMPTS) throw error;
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1), signal);
      continue;
    }

    if (response.ok) return response.blob();

    if (!RETRYABLE_STATUS.has(response.status) || attempt >= MAX_ATTEMPTS) {
      // x-cld-error carries Cloudinary's reason when CORS exposes it.
      const reason = response.headers.get("x-cld-error");
      throw new Error(reason || describeStatus(response.status));
    }
    await sleep(BASE_DELAY_MS * 2 ** (attempt - 1), signal);
  }
}

function describeStatus(status) {
  if (status === 400) return "Cloudinary rejected the transformation. Try a different object description.";
  if (status === 420) return "Generative AI rate limit or quota reached on this Cloudinary account. Wait a moment and try again.";
  if (status === 423) return "The image is still being generated. Try again in a few seconds.";
  if (status === 404) return "The uploaded image could not be found.";
  return `Cloudinary returned HTTP ${status}.`;
}

function setResultState(next) {
  const frame = $("result_frame");
  frame.dataset.state = next;
  frame.setAttribute("aria-busy", String(next === "processing"));
  $("submit_btn").disabled = next === "processing";
}

async function recolor(options) {
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  state.lastRequest = options;

  const url = buildRecolorUrl({ cloudName, ...state.asset, ...options });
  $("result_url").textContent = url;
  $("result_url_details").hidden = false;
  setResultState("processing");

  const started = performance.now();
  const tick = () => {
    $("status_elapsed").textContent = `${Math.round((performance.now() - started) / 1000)}s`;
  };
  tick();
  const timer = setInterval(tick, 1000);

  try {
    const blob = await fetchTransformed(url, controller.signal, (attempt) => {
      $("status_text").textContent =
        attempt === 1 ? "Generating with gen_recolor…" : `Still processing (attempt ${attempt} of ${MAX_ATTEMPTS})…`;
    });
    if (state.controller !== controller) return;

    if (state.resultObjectUrl) URL.revokeObjectURL(state.resultObjectUrl);
    state.resultObjectUrl = URL.createObjectURL(blob);
    const img = $("result_img");
    img.src = state.resultObjectUrl;
    img.alt = `${$("orig_img").alt} with ${options.prompts.join(", ")} recolored to #${options.hex}`;
    await img.decode().catch(() => {});
    setResultState("done");
  } catch (error) {
    if (state.controller !== controller) return;
    if (controller.signal.aborted) {
      setResultState($("result_img").getAttribute("src") ? "done" : "idle");
      return;
    }
    $("error_text").textContent = error.message || "Network error while loading the recolored image.";
    setResultState("error");
  } finally {
    clearInterval(timer);
    if (state.controller === controller) state.controller = null;
  }
}

$("choices").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.asset) return;
  const options = currentOptions();
  if (!options.prompts.length) {
    alert("Select at least one object, or describe one.");
    return;
  }
  recolor(options);
});

$("cancel_btn").addEventListener("click", () => state.controller?.abort());
$("retry_btn").addEventListener("click", () => state.lastRequest && recolor(state.lastRequest));

$("copy_btn").addEventListener("click", async () => {
  await navigator.clipboard?.writeText($("result_url").textContent);
  $("copy_btn").textContent = "Copied";
  setTimeout(() => ($("copy_btn").textContent = "Copy URL"), 1500);
});

// ---------- Reset ----------

$("reset_btn").addEventListener("click", () => {
  state.controller?.abort();
  if (state.resultObjectUrl) URL.revokeObjectURL(state.resultObjectUrl);
  Object.assign(state, { asset: null, controller: null, resultObjectUrl: null, lastRequest: null });

  $("orig_img").removeAttribute("src");
  $("result_img").removeAttribute("src");
  $("result_img").alt = "";
  $("result_url_details").hidden = true;
  $("custom_object").value = "";
  setResultState("idle");

  $("editor").hidden = true;
  $("upload_section").hidden = false;
});
