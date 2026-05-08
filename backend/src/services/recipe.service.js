import { estimateNutritionFromIngredients } from "./nutrition.service.js";

function uniqueIngredients(items = []) {
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}

function enrichIngredientsForDiet({ ingredients, diet, cuisine }) {
  const current = uniqueIngredients(ingredients);
  const dietKey = String(diet || "").toLowerCase();
  const cuisineKey = String(cuisine || "").toLowerCase();

  const hasProteinSource = current.some((item) =>
    /(chicken|egg|paneer|tofu|lentil|chickpea|beans|soy|fish|turkey|yogurt|cheese|seitan|tempeh|quinoa)/i.test(item)
  );

  if (dietKey.includes("high-protein") && !hasProteinSource) {
    if (cuisineKey.includes("indian")) {
      current.push("paneer", "moong dal");
    } else {
      current.push("chicken breast", "chickpeas");
    }
  }

  return uniqueIngredients(current);
}

function applyCuisineSignatureIngredients({ ingredients, cuisine, diet }) {
  const current = uniqueIngredients(ingredients);
  const cuisineKey = String(cuisine || "").toLowerCase();
  const dietKey = String(diet || "").toLowerCase();
  const isPlantForward = /(vegetarian|vegan)/i.test(dietKey);

  const signatureByCuisine = {
    indian: ["garam masala", "turmeric", "ginger"],
    mexican: ["black beans", "corn", "lime"],
    italian: ["basil", "oregano", "olive oil"],
    mediterranean: ["olive oil", "lemon", "cucumber"],
    asian: ["soy sauce", "sesame oil", "spring onion"],
  };

  const cuisineProteinByCuisine = {
    indian: isPlantForward ? ["paneer", "moong dal"] : ["chicken breast", "lentils"],
    mexican: isPlantForward ? ["black beans", "tofu"] : ["chicken breast", "black beans"],
    italian: isPlantForward ? ["cannellini beans", "tofu"] : ["chicken breast", "cannellini beans"],
    mediterranean: isPlantForward ? ["chickpeas", "feta"] : ["chicken breast", "chickpeas"],
    asian: isPlantForward ? ["tofu", "edamame"] : ["chicken breast", "edamame"],
  };

  const signatures =
    signatureByCuisine[cuisineKey] ||
    (cuisineKey.includes("indian")
      ? signatureByCuisine.indian
      : cuisineKey.includes("mexican")
      ? signatureByCuisine.mexican
      : cuisineKey.includes("italian")
      ? signatureByCuisine.italian
      : cuisineKey.includes("mediterranean")
      ? signatureByCuisine.mediterranean
      : cuisineKey.includes("asian")
      ? signatureByCuisine.asian
      : []);

  const proteinAnchors =
    cuisineProteinByCuisine[cuisineKey] ||
    (cuisineKey.includes("indian")
      ? cuisineProteinByCuisine.indian
      : cuisineKey.includes("mexican")
      ? cuisineProteinByCuisine.mexican
      : cuisineKey.includes("italian")
      ? cuisineProteinByCuisine.italian
      : cuisineKey.includes("mediterranean")
      ? cuisineProteinByCuisine.mediterranean
      : cuisineKey.includes("asian")
      ? cuisineProteinByCuisine.asian
      : []);

  current.push(...signatures);

  if (dietKey.includes("high-protein")) {
    current.push(...proteinAnchors);
  }

  return uniqueIngredients(current);
}

function applyCalorieTargetToIngredients({ ingredients, calorieTarget, diet, cuisine }) {
  const current = uniqueIngredients(ingredients);
  const target = Number.isFinite(Number(calorieTarget)) ? Number(calorieTarget) : 600;
  const dietKey = String(diet || "").toLowerCase();
  const cuisineKey = String(cuisine || "").toLowerCase();

  const isPlantForward = /(vegetarian|vegan|plant)/i.test(dietKey);
  const isIndian = cuisineKey.includes("indian");
  const isKeto = cuisineKey.includes("keto") || dietKey.includes("keto");

  const carbKeywords = /(rice|bread|pasta|noodle|potato|quinoa|oats)/i;

  if (target <= 500) {
    // Make low-calorie recipes visibly lighter instead of returning the same list.
    const light = current.filter((item) => !carbKeywords.test(item));
    if (!light.length) {
      light.push("cauliflower rice");
    } else if (!light.some((item) => /cauliflower/i.test(item))) {
      light.push("cauliflower rice");
    }
    if (!light.some((item) => /leafy greens|spinach|lettuce|cucumber/i.test(item))) {
      light.push("leafy greens");
    }
    return uniqueIngredients(light);
  }

  if (target >= 850) {
    if (isKeto) {
      current.push("avocado", "olive oil");
    } else if (isPlantForward) {
      current.push(isIndian ? "paneer" : "tofu", "quinoa", "olive oil");
    } else {
      current.push(isIndian ? "paneer" : "chicken breast", "quinoa", "olive oil");
    }
    return uniqueIngredients(current);
  }

  // Medium band still gets a small shift so nearby targets are not identical.
  if (!current.some((item) => /protein/i.test(item)) && target >= 650) {
    current.push(isPlantForward ? "chickpeas" : "chicken breast");
  }

  return uniqueIngredients(current);
}

async function generateRecipeWithOpenAI({ ingredients, diet, cuisine, calorieTarget }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "You are a culinary assistant. Return strict JSON with keys: title, servings, ingredients, steps, notes.",
        },
        {
          role: "user",
          content: `Create a ${diet} ${cuisine} recipe with ingredients: ${ingredients.join(
            ", "
          )}. Target around ${calorieTarget} calories.`,
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) throw new Error("OpenAI generation failed");
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  return JSON.parse(content);
}

async function generateRecipeWithClaude({ ingredients, diet, cuisine, calorieTarget }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 900,
      temperature: 0.7,
      system:
        "You are a culinary assistant. Return strict JSON with keys: title, servings, ingredients, steps, notes.",
      messages: [
        {
          role: "user",
          content: `Create a ${diet} ${cuisine} recipe with ingredients: ${ingredients.join(
            ", "
          )}. Target around ${calorieTarget} calories. Return only valid JSON.`,
        },
      ],
    }),
  });

  if (!response.ok) throw new Error("Claude generation failed");
  const payload = await response.json();
  const text = payload?.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Claude generation response missing text");
  return JSON.parse(text);
}

export async function generateRecipe(input) {
  const {
    ingredients = [],
    diet = "balanced",
    calorieTarget = 600,
    cuisine = "any",
  } = input;

  const recipeIngredients = ingredients.length
    ? ingredients
    : ["chickpeas", "spinach", "rice"];
  const dietAwareIngredients = enrichIngredientsForDiet({
    ingredients: recipeIngredients,
    diet,
    cuisine,
  });
  const cuisineAwareIngredients = applyCuisineSignatureIngredients({
    ingredients: dietAwareIngredients,
    cuisine,
    diet,
  });
  const targetAwareIngredients = applyCalorieTargetToIngredients({
    ingredients: cuisineAwareIngredients,
    calorieTarget,
    diet,
    cuisine,
  });

  let generated = {
    title: `${diet} ${cuisine} Bowl`,
    servings: 2,
    ingredients: targetAwareIngredients,
    steps: [
      "Prep all ingredients and wash vegetables.",
      "Cook base grains and saute vegetables with spices.",
      "Add protein source and simmer for 8-10 minutes.",
      "Serve hot and garnish with herbs.",
    ],
    notes: "Fallback recipe response. Configure OPENAI_API_KEY or ANTHROPIC_API_KEY for LLM generation.",
  };
  let llmSucceeded = false;

  if (process.env.OPENAI_API_KEY) {
    try {
      generated = await generateRecipeWithOpenAI({
        ingredients: targetAwareIngredients,
        diet,
        cuisine,
        calorieTarget,
      });
      llmSucceeded = true;
    } catch (_error) {
      generated.notes = "OpenAI call failed, trying fallback providers.";
    }
  }

  if (!llmSucceeded && process.env.ANTHROPIC_API_KEY) {
    try {
      generated = await generateRecipeWithClaude({
        ingredients: targetAwareIngredients,
        diet,
        cuisine,
        calorieTarget,
      });
      llmSucceeded = true;
    } catch (_error) {
      generated.notes = "Claude call failed, fallback recipe used.";
    }
  }

  const finalIngredients = applyCalorieTargetToIngredients({
    ingredients: applyCuisineSignatureIngredients({
      ingredients: enrichIngredientsForDiet({
        ingredients: generated.ingredients || targetAwareIngredients,
        diet,
        cuisine,
      }),
      cuisine,
      diet,
    }),
    calorieTarget,
    diet,
    cuisine,
  });
  const nutrition = await estimateNutritionFromIngredients(finalIngredients, calorieTarget);

  return {
    ...generated,
    ingredients: finalIngredients,
    nutrition: {
      calories: nutrition.calories,
      protein: nutrition.protein,
      carbs: nutrition.carbs,
      fat: nutrition.fat,
    },
  };
}
