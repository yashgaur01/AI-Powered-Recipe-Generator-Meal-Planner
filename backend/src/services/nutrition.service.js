export async function estimateNutritionFromIngredients(ingredients = [], calorieTarget = 600) {
  const apiKey = process.env.NUTRITION_API_KEY;

  if (!apiKey) {
    return {
      calories: calorieTarget,
      protein: Math.round(ingredients.length * 3 + 20),
      carbs: Math.round(ingredients.length * 5 + 35),
      fat: Math.round(ingredients.length * 2 + 12),
      source: "estimated",
    };
  }

  try {
    const query = ingredients.join(", ");
    const response = await fetch("https://api.api-ninjas.com/v1/nutrition?query=" + encodeURIComponent(query), {
      headers: { "X-Api-Key": apiKey },
    });

    if (!response.ok) throw new Error("Nutrition API request failed");
    const items = await response.json();
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Nutrition API returned empty response");
    }

    const totals = items.reduce(
      (acc, item) => {
        acc.calories += Number(item.calories || 0);
        acc.protein += Number(item.protein_g || 0);
        acc.carbs += Number(item.carbohydrates_total_g || 0);
        acc.fat += Number(item.fat_total_g || 0);
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

    return {
      calories: Math.round(totals.calories),
      protein: Math.round(totals.protein),
      carbs: Math.round(totals.carbs),
      fat: Math.round(totals.fat),
      source: "api",
    };
  } catch (_error) {
    return {
      calories: calorieTarget,
      protein: Math.round(ingredients.length * 3 + 20),
      carbs: Math.round(ingredients.length * 5 + 35),
      fat: Math.round(ingredients.length * 2 + 12),
      source: "estimated",
    };
  }
}
