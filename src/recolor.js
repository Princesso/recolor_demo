// Builds Cloudinary delivery URLs that apply the gen_recolor generative AI effect.
// Syntax reference: https://cloudinary.com/documentation/transformation_reference#e_gen_recolor

// gen_recolor uses ( ) ; / , : as syntax, so strip them from prompts.
export function sanitizePrompt(text) {
  return text
    .replace(/[^\p{L}\p{N} -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeHex(value) {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? match[1].toUpperCase() : null;
}

// Returns the e_gen_recolor transformation component, e.g.
// e_gen_recolor:prompt_(sofa;lamp);to-color_2563EB;multiple_true
export function genRecolorParam({ prompts, hex, multiple }) {
  const prompt = prompts.map((p) => encodeURIComponent(p)).join(";");
  // Single prompts don't need parentheses, but they're valid either way.
  let param = `e_gen_recolor:prompt_(${prompt});to-color_${hex}`;
  if (multiple) param += ";multiple_true";
  return param;
}

// Chains f_auto/q_auto after the effect so the recolored result is delivered as
// WebP/AVIF at an optimized quality.
export function buildRecolorUrl({ cloudName, publicId, version, format, ...options }) {
  const path = publicId.split("/").map(encodeURIComponent).join("/");
  return [
    `https://res.cloudinary.com/${cloudName}/image/upload`,
    genRecolorParam(options),
    "f_auto",
    "q_auto",
    `v${version}`,
    `${path}.${format}`,
  ].join("/");
}
