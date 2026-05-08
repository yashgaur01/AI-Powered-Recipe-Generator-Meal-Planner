const DEFAULT_MODEL_URL = "https://router.huggingface.co/hf-inference/models/nateraw/food";
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";

const KNOWN_INGREDIENTS = [
  "tomato",
  "onion",
  "potato",
  "spinach",
  "chili",
  "carrot",
  "rice",
  "paneer",
  "mushroom",
  "broccoli",
  "chickpeas",
  "garlic",
  "ginger",
  "capsicum",
  "cucumber",
  "cauliflower",
  "peas",
  "tofu",
  "egg",
  "chicken",
];

const LABEL_INGREDIENT_MAP = {
  "bell pepper": "capsicum",
  pepper: "capsicum",
  chilli: "chili",
  coriander: "cilantro",
  aubergine: "eggplant",
  garbanzo: "chickpeas",
  "green onion": "spring onion",
};

function fileNameFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const fileName = pathname.split("/").pop() || "";
    return decodeURIComponent(fileName);
  } catch {
    return "";
  }
}

function normalizeIngredientLabel(label = "") {
  const cleaned = String(label).toLowerCase().replace(/[_-]/g, " ").trim();
  if (!cleaned) return "";

  if (LABEL_INGREDIENT_MAP[cleaned]) return LABEL_INGREDIENT_MAP[cleaned];
  return cleaned;
}

function parseVisionPredictions(payload) {
  if (!Array.isArray(payload)) return [];

  return payload
    .filter((item) => typeof item?.label === "string")
    .filter((item) => Number(item?.score ?? 0) >= 0.12)
    .slice(0, 12)
    .map((item) => ({
      label: normalizeIngredientLabel(item.label),
      score: Number(item.score ?? 0),
    }))
    .filter((item) => item.label.length > 0);
}

function keywordDetect(text = "") {
  const normalized = text.toLowerCase();
  return KNOWN_INGREDIENTS.filter((item) => normalized.includes(item));
}

function buildVisionResponse(predictions, fallbackIngredients, notes) {
  const deduped = [...new Set(predictions.map((item) => item.label))];
  const detectedIngredients = deduped.length ? deduped : fallbackIngredients;
  const confidence = predictions[0]?.score || (deduped.length ? 0.65 : 0.5);

  return {
    detectedIngredients,
    confidence,
    notes,
  };
}

function toDataUri(buffer, mimeType) {
  const safeMime = mimeType || "image/jpeg";
  return `data:${safeMime};base64,${Buffer.from(buffer).toString("base64")}`;
}

function normalizeHfModelUrl(url = "") {
  const raw = String(url || "").trim();
  if (!raw) return DEFAULT_MODEL_URL;
  if (raw.includes("api-inference.huggingface.co/models/")) {
    return raw.replace(
      "https://api-inference.huggingface.co/models/",
      "https://router.huggingface.co/hf-inference/models/"
    );
  }
  return raw;
}

function sanitizeOpenAIIngredients(raw = []) {
  if (!Array.isArray(raw)) return [];

  return [...new Set(
    raw
      .map((item) => normalizeIngredientLabel(item))
      .map((item) => item.replace(/[^\w\s-]/g, "").trim())
      .filter(Boolean)
      .slice(0, 12)
  )];
}

function parseJsonPayload(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function detectWithOpenAI(imageBuffer, mimeType) {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey) return null;

  const imageDataUri = toDataUri(imageBuffer, mimeType);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_VISION_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a food vision parser. Return strict JSON with this shape: {\"ingredients\":[\"...\"],\"confidence\":0.0}. Only include edible ingredients actually visible in the image. Avoid utensils, tableware, logos, brands.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Detect ingredients visible in this image." },
            { type: "image_url", image_url: { url: imageDataUri } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const code = errorBody?.error?.code || "unknown_error";
    const message = errorBody?.error?.message || "OpenAI vision request failed";
    throw new Error(`openai_${response.status}:${code}:${message}`);
  }

  const payload = await response.json();
  const rawContent = payload.choices?.[0]?.message?.content;
  const parsed = parseJsonPayload(rawContent);
  const ingredients = sanitizeOpenAIIngredients(parsed?.ingredients || []);
  const confidence = Math.max(0, Math.min(1, Number(parsed?.confidence ?? 0.72)));

  if (!ingredients.length) return null;
  return {
    predictions: ingredients.map((label) => ({ label, score: confidence })),
    notes: `Detected via OpenAI Vision (${OPENAI_VISION_MODEL}).`,
  };
}

export async function recognizeIngredientsFromImage(imageUrl) {
  const fileName = fileNameFromUrl(imageUrl);
  const fallback = keywordDetect(`${imageUrl} ${fileName}`);

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error("Image fetch failed");
    }

    const mimeType = response.headers.get("content-type") || "application/octet-stream";
    const buffer = Buffer.from(await response.arrayBuffer());
    const visionResult = await recognizeIngredientsWithVision(buffer, mimeType, fileName);

    return {
      imageUrl,
      ...visionResult,
    };
  } catch {
    const fallbackResult = await recognizeIngredientsFromFile(`${imageUrl} ${fileName}`);
    return {
      imageUrl,
      ...buildVisionResponse(
        [],
        fallback.length ? fallback : fallbackResult.detectedIngredients,
        "Image URL could not be analyzed via vision model; used keyword-based fallback."
      ),
    };
  }
}

export async function recognizeIngredientsFromFile(fileName = "") {
  const detected = keywordDetect(fileName);
  const fallback = ["tomato", "onion", "spinach"];

  return {
    detectedIngredients: detected.length ? detected : fallback,
    confidence: detected.length ? 0.83 : 0.7,
    notes: detected.length
      ? "Detected using filename keyword matching."
      : "No clear keywords found in filename; used default pantry fallback.",
  };
}

export async function recognizeIngredientsWithVision(buffer, mimeType, fileName = "") {
  const apiKey = process.env.VISION_API_KEY;
  const modelUrl = normalizeHfModelUrl(process.env.VISION_API_URL || DEFAULT_MODEL_URL);
  const fallbackResult = await recognizeIngredientsFromFile(fileName);

  let openAiErrorMessage = "";
  let hfErrorMessage = "";

  try {
    // Prefer OpenAI vision when API key is available.
    let openAiResult = null;
    try {
      openAiResult = await detectWithOpenAI(buffer, mimeType);
    } catch (error) {
      openAiErrorMessage = String(error?.message || "");
    }

    if (openAiResult?.predictions?.length) {
      return buildVisionResponse(
        openAiResult.predictions,
        fallbackResult.detectedIngredients,
        openAiResult.notes
      );
    }

    const headers = {
      "Content-Type": mimeType || "application/octet-stream",
    };

    // Keep API key optional: try real vision inference even when key is absent.
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await fetch(modelUrl, {
      method: "POST",
      headers,
      body: buffer,
    });

    if (!response.ok) {
      const hfText = await response.text().catch(() => "");
      throw new Error(`huggingface_${response.status}:${hfText || "Vision API request failed"}`);
    }

    const payload = await response.json();
    const predictions = parseVisionPredictions(payload);

    return buildVisionResponse(
      predictions,
      fallbackResult.detectedIngredients,
      predictions.length
        ? "Detected via vision model inference."
        : "Vision model returned low-confidence predictions; used keyword fallback."
    );
  } catch (error) {
    hfErrorMessage = String(error?.message || "");
    const issues = [];
    if (openAiErrorMessage.includes("insufficient_quota")) {
      issues.push("OpenAI quota exceeded (check billing/credits).");
    } else if (openAiErrorMessage) {
      issues.push(`OpenAI vision request failed (${openAiErrorMessage}).`);
    }

    if (hfErrorMessage) {
      issues.push(`Hugging Face vision request failed (${hfErrorMessage}).`);
    } else {
      issues.push("Hugging Face vision request failed.");
    }

    return buildVisionResponse(
      [],
      fallbackResult.detectedIngredients,
      `${issues.join(" ")} Used keyword-based fallback.`
    );
  }
}
