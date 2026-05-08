const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Request failed");
  }
  return response.json();
}

export async function generateRecipe(payload, token) {
  return apiRequest("/recipes/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
}

export async function recognizeIngredients(imageUrl) {
  return apiRequest("/ingredients/recognize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl }),
  });
}

export async function recognizeIngredientsFromUpload(file) {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch(`${API_BASE_URL}/ingredients/recognize-upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Ingredient recognition from upload failed");
  }

  return response.json();
}

export async function buildShoppingList(meals, token) {
  return apiRequest("/meal-plans/shopping-list", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ meals }),
  });
}

export async function fetchLatestShoppingList(token) {
  return apiRequest("/meal-plans/shopping-list/latest", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export async function updateShoppingListItem(token, itemId, payload) {
  return apiRequest(`/meal-plans/shopping-list/items/${itemId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function deleteShoppingListItem(token, itemId) {
  return apiRequest(`/meal-plans/shopping-list/items/${itemId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function fetchRecipes(filters = {}, token) {
  const params = new URLSearchParams();
  if (filters.query) params.set("query", filters.query);
  if (filters.diet) params.set("diet", filters.diet);
  if (filters.cuisine) params.set("cuisine", filters.cuisine);
  if (filters.maxCalories) params.set("maxCalories", String(filters.maxCalories));

  return apiRequest(`/recipes?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export async function saveWeeklyMealPlan(payload, token) {
  return apiRequest("/meal-plans/week", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchWeeklyMealPlan(weekStart, token) {
  const qs = new URLSearchParams({ weekStart }).toString();
  return apiRequest(`/meal-plans/week?${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export async function fetchNutritionSummary(weekStart, token) {
  const qs = new URLSearchParams({ weekStart }).toString();
  return apiRequest(`/meal-plans/nutrition-summary?${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export async function registerUser(payload) {
  return apiRequest("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function loginUser(payload) {
  return apiRequest("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function loginWithGoogle(idToken) {
  return apiRequest("/auth/oauth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
}

export function getGitHubOAuthStartUrl() {
  return `${API_BASE_URL}/auth/oauth/github`;
}

export async function loginWithGitHubCode(code) {
  return apiRequest("/auth/oauth/github", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

export async function getMyProfile(token) {
  return apiRequest("/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function saveMyPreferences(token, payload) {
  return apiRequest("/auth/me/preferences", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function logConsumedMeal(token, payload) {
  return apiRequest("/meal-plans/history", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchMealHistory(token, limit = 30) {
  const qs = new URLSearchParams({ limit: String(limit) }).toString();
  return apiRequest(`/meal-plans/history?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function updateMealHistoryEntry(token, historyId, payload) {
  return apiRequest(`/meal-plans/history/${historyId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function deleteMealHistoryEntry(token, historyId) {
  return apiRequest(`/meal-plans/history/${historyId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function fetchNutritionHistory(token, options = {}) {
  const params = new URLSearchParams({
    period: options.period || "daily",
    days: String(options.days || 30),
  }).toString();
  return apiRequest(`/meal-plans/nutrition-history?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function fetchMealRecommendations(token, weekStart) {
  const qs = new URLSearchParams({ weekStart }).toString();
  return apiRequest(`/meal-plans/recommendations?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function fetchNotifications(token) {
  return apiRequest("/notifications", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function markNotificationsRead(token, notificationIds = []) {
  return apiRequest("/notifications/read", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ notificationIds }),
  });
}
