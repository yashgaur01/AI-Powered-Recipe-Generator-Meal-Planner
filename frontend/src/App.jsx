import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  buildShoppingList,
  deleteMealHistoryEntry,
  deleteShoppingListItem,
  fetchLatestShoppingList,
  fetchMealHistory,
  fetchMealRecommendations,
  fetchNotifications,
  fetchNutritionHistory,
  fetchNutritionSummary,
  fetchRecipes,
  fetchWeeklyMealPlan,
  generateRecipe,
  getGitHubOAuthStartUrl,
  getMyProfile,
  logConsumedMeal,
  loginWithGoogle,
  markNotificationsRead,
  loginUser,
  recognizeIngredientsFromUpload,
  registerUser,
  saveMyPreferences,
  saveWeeklyMealPlan,
  updateMealHistoryEntry,
  updateShoppingListItem,
} from "./api";
import GlassCard from "./components/GlassCard";
import SectionHeader from "./components/SectionHeader";
import StatCard from "./components/StatCard";
import {
  X,
  Bell,
  BookOpen,
  CalendarDays,
  ChefHat,
  Drumstick,
  Flame,
  LayoutDashboard,
  Leaf,
  LogOut,
  ScanLine,
  Search,
  ShoppingCart,
  Sparkles,
  UtensilsCrossed,
  UserCog,
} from "lucide-react";

const initialMealSlots = {
  Monday: { breakfast: "", lunch: "", dinner: "" },
  Tuesday: { breakfast: "", lunch: "", dinner: "" },
  Wednesday: { breakfast: "", lunch: "", dinner: "" },
  Thursday: { breakfast: "", lunch: "", dinner: "" },
  Friday: { breakfast: "", lunch: "", dinner: "" },
  Saturday: { breakfast: "", lunch: "", dinner: "" },
  Sunday: { breakfast: "", lunch: "", dinner: "" },
};
const plannerDays = Object.keys(initialMealSlots);

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const googleWindow = globalThis;

const DASHBOARD_VIEWS = {
  home: "home",
  preferences: "preferences",
  ingredients: "ingredients",
  discovery: "discovery",
  planner: "planner",
  shopping: "shopping",
};

export default function App() {
  const proteinRegex =
    /(chicken|egg|paneer|tofu|lentil|dal|chickpea|beans|soy|fish|turkey|yogurt|cheese|seitan|tempeh|quinoa)/i;

  function dedupeRecipes(items = []) {
    const seen = new Set();
    return items.filter((item) => {
      const keyByContent = `content:${(item?.title || "").toLowerCase()}|${(item?.cuisine || "").toLowerCase()}|${(item?.ingredients || []).join(",").toLowerCase()}`;
      const key = keyByContent;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function normalizeRecipeForDisplay(rawRecipe, selectedDiet, selectedCuisine) {
    const baseIngredients = [...new Set((rawRecipe?.ingredients || []).filter(Boolean))];
    const dietKey = String(selectedDiet || "").toLowerCase();
    const cuisineKey = String(selectedCuisine || "").toLowerCase();
    const hasProtein = baseIngredients.some((item) => proteinRegex.test(item));

    if (dietKey.includes("high-protein") && !hasProtein) {
      if (cuisineKey.includes("indian")) {
        baseIngredients.push("paneer", "moong dal");
      } else {
        baseIngredients.push("chickpeas", "tofu");
      }
    }

    return {
      ...rawRecipe,
      ingredients: [...new Set(baseIngredients)],
    };
  }

  function getDisplayNutrition(recipeItem) {
    const ingredientsCount = (recipeItem?.ingredients || []).length;
    const fallback = {
      calories: Math.max(180, ingredientsCount * 80),
      protein: Math.max(12, ingredientsCount * 4),
      carbs: Math.max(20, ingredientsCount * 6),
      fat: Math.max(6, ingredientsCount * 2),
    };

    return {
      calories:
        Number.isFinite(Number(recipeItem?.nutrition?.calories)) && recipeItem?.nutrition?.calories != null
          ? Number(recipeItem.nutrition.calories)
          : fallback.calories,
      protein:
        Number.isFinite(Number(recipeItem?.nutrition?.protein)) && recipeItem?.nutrition?.protein != null
          ? Number(recipeItem.nutrition.protein)
          : fallback.protein,
      carbs:
        Number.isFinite(Number(recipeItem?.nutrition?.carbs)) && recipeItem?.nutrition?.carbs != null
          ? Number(recipeItem.nutrition.carbs)
          : fallback.carbs,
      fat:
        Number.isFinite(Number(recipeItem?.nutrition?.fat)) && recipeItem?.nutrition?.fat != null
          ? Number(recipeItem.nutrition.fat)
          : fallback.fat,
    };
  }

  const [ingredientInput, setIngredientInput] = useState("tomato,onion,rice");
  const [diet, setDiet] = useState("balanced");
  const [cuisine, setCuisine] = useState("indian");
  const [calorieTarget, setCalorieTarget] = useState(600);
  const [imageFile, setImageFile] = useState(null);

  const [detectedIngredients, setDetectedIngredients] = useState([]);
  const [detectionMeta, setDetectionMeta] = useState(null);
  const [recipe, setRecipe] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [shoppingList, setShoppingList] = useState([]);
  const [latestShoppingListMeta, setLatestShoppingListMeta] = useState(null);
  const [filters, setFilters] = useState({
    query: "",
    diet: "",
    cuisine: "",
    maxCalories: "",
  });
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [token, setToken] = useState(localStorage.getItem("recipe_token") || "");
  const [profile, setProfile] = useState(null);
  const [preferences, setPreferences] = useState({
    dietType: "OMNIVORE",
    allergies: "",
    dislikedItems: "",
    calorieTarget: "",
    proteinTarget: "",
    carbsTarget: "",
    fatTarget: "",
  });
  const [calendarWeekStart, setCalendarWeekStart] = useState("2026-05-04");
  const [mealSlots, setMealSlots] = useState(initialMealSlots);
  const [selectedPlannerDay, setSelectedPlannerDay] = useState("Monday");
  const [nutritionPlanSummary, setNutritionPlanSummary] = useState(null);
  const [savedWeeklyPlan, setSavedWeeklyPlan] = useState(null);
  const [lastGeneratedAt, setLastGeneratedAt] = useState("");
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const [showRecipeIngredientsPopup, setShowRecipeIngredientsPopup] = useState(false);
  const [activeView, setActiveView] = useState(DASHBOARD_VIEWS.home);
  const [nutritionHistory, setNutritionHistory] = useState([]);
  const [nutritionHistoryInsights, setNutritionHistoryInsights] = useState(null);
  const [nutritionHistoryPeriod, setNutritionHistoryPeriod] = useState("daily");
  const [mealHistory, setMealHistory] = useState([]);
  const [recommendedRecipes, setRecommendedRecipes] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [preferencesSaveStatus, setPreferencesSaveStatus] = useState({
    type: "idle",
    message: "",
  });

  const navItems = useMemo(
    () => [
      { id: DASHBOARD_VIEWS.home, label: "Dashboard", icon: LayoutDashboard },
      { id: DASHBOARD_VIEWS.preferences, label: "Dietary Preferences", icon: UserCog },
      { id: DASHBOARD_VIEWS.ingredients, label: "Ingredient Detection", icon: ScanLine },
      { id: DASHBOARD_VIEWS.discovery, label: "Recipes", icon: BookOpen },
      { id: DASHBOARD_VIEWS.planner, label: "Planner & Nutrition", icon: CalendarDays },
      { id: DASHBOARD_VIEWS.shopping, label: "Shopping List", icon: ShoppingCart },
    ],
    []
  );

  function onLogout() {
    setToken("");
    localStorage.removeItem("recipe_token");
    setProfile(null);
    setActiveView(DASHBOARD_VIEWS.home);
    setToast("Signed out");
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthToken = params.get("oauthToken");
    const oauthProvider = params.get("oauthProvider");
    const oauthError = params.get("oauthError");

    if (oauthError) {
      setError("OAuth login failed. Please try again.");
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (oauthToken) {
      setToken(oauthToken);
      localStorage.setItem("recipe_token", oauthToken);
      setToast(`Logged in with ${oauthProvider || "OAuth"}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (!googleWindow.google?.accounts?.id) return;

      googleWindow.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          if (!response?.credential) return;
          await onGoogleLogin(response.credential);
        },
      });

      const googleBtn = document.getElementById("google-signin-btn");
      if (googleBtn) {
        googleBtn.innerHTML = "";
        googleWindow.google.accounts.id.renderButton(googleBtn, {
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "continue_with",
        });
      }
    };

    document.body.appendChild(script);
    return () => {
      if (script.parentNode) script.parentNode.removeChild(script);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token) return;
    onLoadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token) return;
    onLoadRecipes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token) return;
    onLoadWeeklyMealPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, calendarWeekStart]);

  useEffect(() => {
    onLoadNutritionSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, calendarWeekStart, mealSlots, recipes]);

  useEffect(() => {
    if (!token) return;
    onLoadMealHistory();
    onLoadNutritionHistory();
    onLoadRecommendations();
    onLoadNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, calendarWeekStart, nutritionHistoryPeriod]);

  useEffect(() => {
    if (!token || activeView !== DASHBOARD_VIEWS.shopping) return;
    onLoadLatestShoppingList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeView]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!recipes.length) {
      setSelectedRecipeId("");
      return;
    }
    if (!selectedRecipeId || !recipes.some((item) => item.id === selectedRecipeId)) {
      setSelectedRecipeId(recipes[0].id);
    }
  }, [recipes, selectedRecipeId]);


  const parsedIngredients = useMemo(
    () =>
      ingredientInput
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    [ingredientInput]
  );

  async function onRecognizeIngredients() {
    setError("");
    setLoading(true);

    try {
      if (!imageFile) {
        throw new Error("Please upload an ingredient photo");
      }

      const result = await recognizeIngredientsFromUpload(imageFile);
      setDetectedIngredients(result.detectedIngredients || []);
      setDetectionMeta({
        confidence: Number(result.confidence || 0),
        notes: result.notes || "",
        fileName: result.fileName || imageFile?.name || "",
      });

      if (Number(result.confidence || 0) < 0.6) {
        setToast("Low-confidence detection. Try a clearer food image.");
      } else {
        setToast("Ingredients detected successfully");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function onGenerateRecipe() {
    setError("");
    setLoading(true);
    setIsGenerating(true);

    try {
      const allIngredients = [
        ...new Set([...parsedIngredients, ...detectedIngredients]),
      ];

      const result = await generateRecipe({
        ingredients: allIngredients,
        diet,
        cuisine,
        calorieTarget: Number(calorieTarget),
      }, token);
      const normalized = normalizeRecipeForDisplay(result, diet, cuisine);
      setRecipe(normalized);
      setRecipes((prev) => dedupeRecipes([normalized, ...prev]));
      setSelectedRecipeId(normalized.id || "");
      setLastGeneratedAt(new Date().toLocaleTimeString());
      setToast("Smart recipe generated");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setIsGenerating(false);
    }
  }

  async function onSearchRecipes() {
    setError("");
    setLoading(true);
    try {
      const result = await fetchRecipes({
        ...filters,
        maxCalories: filters.maxCalories ? Number(filters.maxCalories) : undefined,
      }, token);
      setRecipes(dedupeRecipes(result.items || []));
      setToast("Recipes loaded");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function onMealSlotChange(day, slotType, recipeId) {
    setMealSlots((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        [slotType]: recipeId,
      },
    }));
  }

  function onResetMealPlan() {
    setMealSlots(initialMealSlots);
    setToast("Planner reset for this week");
  }

  async function onSaveMealPlan() {
    setError("");
    setLoading(true);
    try {
      await saveWeeklyMealPlan({
        weekStart: calendarWeekStart,
        slots: mealSlots,
      }, token);
      await onLoadNutritionSummary();
      setSavedWeeklyPlan({
        weekStart: calendarWeekStart,
        slots: JSON.parse(JSON.stringify(mealSlots)),
        savedAt: new Date().toLocaleString(),
      });
      setToast("Weekly meal plan saved");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitAuth(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const normalizedEmail = authForm.email.trim().toLowerCase();
      const payload = {
        email: normalizedEmail,
        password: authForm.password,
        ...(authMode === "register" ? { name: authForm.name } : {}),
      };

      const result =
        authMode === "register" ? await registerUser(payload) : await loginUser(payload);

      setToken(result.token);
      localStorage.setItem("recipe_token", result.token);
      const userProfile = await getMyProfile(result.token);
      setProfile(userProfile);
      if (userProfile.preference) {
        setPreferences({
          dietType: userProfile.preference.dietType || "OMNIVORE",
          allergies: (userProfile.preference.allergies || []).join(","),
          dislikedItems: (userProfile.preference.dislikedItems || []).join(","),
          calorieTarget: userProfile.preference.calorieTarget ?? "",
          proteinTarget: userProfile.preference.proteinTarget ?? "",
          carbsTarget: userProfile.preference.carbsTarget ?? "",
          fatTarget: userProfile.preference.fatTarget ?? "",
        });
      }
      setToast(authMode === "register" ? "Account created successfully" : "Logged in successfully");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function onGoogleLogin(idToken) {
    setError("");
    setLoading(true);
    try {
      const result = await loginWithGoogle(idToken);
      setToken(result.token);
      localStorage.setItem("recipe_token", result.token);
      const userProfile = await getMyProfile(result.token);
      setProfile(userProfile);
      if (userProfile.preference) {
        setPreferences({
          dietType: userProfile.preference.dietType || "OMNIVORE",
          allergies: (userProfile.preference.allergies || []).join(","),
          dislikedItems: (userProfile.preference.dislikedItems || []).join(","),
          calorieTarget: userProfile.preference.calorieTarget ?? "",
          proteinTarget: userProfile.preference.proteinTarget ?? "",
          carbsTarget: userProfile.preference.carbsTarget ?? "",
          fatTarget: userProfile.preference.fatTarget ?? "",
        });
      }
      setToast("Logged in with Google");
    } catch (err) {
      setError(err.message || "Google login failed");
    } finally {
      setLoading(false);
    }
  }

  async function onLoadMealHistory() {
    if (!token) return;
    try {
      const payload = await fetchMealHistory(token, 40);
      setMealHistory(payload.items || []);
    } catch (_err) {
      setMealHistory([]);
    }
  }

  async function onLoadNutritionHistory() {
    if (!token) return;
    try {
      const payload = await fetchNutritionHistory(token, {
        period: nutritionHistoryPeriod,
        days: 30,
      });
      setNutritionHistory(payload.points || []);
      setNutritionHistoryInsights(payload.insights || null);
    } catch (_err) {
      setNutritionHistory([]);
      setNutritionHistoryInsights(null);
    }
  }

  async function onLoadRecommendations() {
    if (!token) return;
    try {
      const payload = await fetchMealRecommendations(token, calendarWeekStart);
      setRecommendedRecipes(payload.items || []);
    } catch (_err) {
      setRecommendedRecipes([]);
    }
  }

  async function onLoadNotifications() {
    if (!token) return;
    try {
      const payload = await fetchNotifications(token);
      setNotifications(payload.items || []);
    } catch (_err) {
      setNotifications([]);
    }
  }

  async function onMarkNotificationsRead() {
    if (!token || notifications.length === 0) return;
    const unreadIds = notifications.filter((item) => !item.isRead).map((item) => item.id);
    if (unreadIds.length === 0) return;
    try {
      await markNotificationsRead(token, unreadIds);
      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
      setToast("Notifications marked as read");
    } catch (_err) {
      setError("Unable to update notifications right now");
    }
  }

  async function onLogMealFromPlanner(day, slotType) {
    const recipeId = mealSlots?.[day]?.[slotType];
    const selectedRecipe = recipes.find((item) => item.id === recipeId);
    if (!selectedRecipe) {
      setToast("Please select a recipe before logging this meal");
      return;
    }

    const nutrition = getDisplayNutrition(selectedRecipe);

    try {
      await logConsumedMeal(token, {
        recipeId: selectedRecipe.id,
        title: selectedRecipe.title,
        mealType: slotType.toUpperCase(),
        calories: Math.round(Number(nutrition.calories || 0)),
        protein: Math.round(Number(nutrition.protein || 0)),
        carbs: Math.round(Number(nutrition.carbs || 0)),
        fat: Math.round(Number(nutrition.fat || 0)),
      });
      setToast(`${slotType} logged to meal history`);
      await onLoadMealHistory();
      await onLoadNutritionHistory();
      await onLoadNotifications();
    } catch (_err) {
      setError("Unable to log meal right now");
    }
  }

  async function onLoadProfile() {
    if (!token) return;
    setError("");
    setLoading(true);
    try {
      const userProfile = await getMyProfile(token);
      setProfile(userProfile);
      setToast("Profile loaded");
    } catch (err) {
      if (
        String(err.message || "").toLowerCase().includes("invalid or expired token") ||
        String(err.message || "").toLowerCase().includes("authentication required")
      ) {
        localStorage.removeItem("recipe_token");
        setToken("");
        setProfile(null);
        setError("Session expired. Please sign in again.");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function onSavePreferences() {
    if (!token) {
      setError("Please login first to save profile preferences");
      setPreferencesSaveStatus({
        type: "error",
        message: "Please login first to save preferences.",
      });
      return;
    }

    setError("");
    setLoading(true);
    setPreferencesSaveStatus({
      type: "saving",
      message: "Saving preferences...",
    });
    try {
      await saveMyPreferences(token, {
        dietType: preferences.dietType,
        allergies: preferences.allergies
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        dislikedItems: preferences.dislikedItems
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        calorieTarget: preferences.calorieTarget ? Number(preferences.calorieTarget) : null,
        proteinTarget: preferences.proteinTarget ? Number(preferences.proteinTarget) : null,
        carbsTarget: preferences.carbsTarget ? Number(preferences.carbsTarget) : null,
        fatTarget: preferences.fatTarget ? Number(preferences.fatTarget) : null,
      });
      await onLoadProfile();
      setToast("Preferences saved");
      setPreferencesSaveStatus({
        type: "success",
        message: `Preferences saved at ${new Date().toLocaleTimeString()}`,
      });
    } catch (err) {
      setError(err.message);
      setPreferencesSaveStatus({
        type: "error",
        message: err.message || "Unable to save preferences right now.",
      });
    } finally {
      setLoading(false);
    }
  }

  function onApplyGoalPreset(preset) {
    setPreferences((prev) => ({
      ...prev,
      calorieTarget: String(preset.calorieTarget),
      proteinTarget: String(preset.proteinTarget),
      carbsTarget: String(preset.carbsTarget),
      fatTarget: String(preset.fatTarget),
    }));
    setToast(`${preset.label} preset applied`);
  }

  const nutritionSummary = useMemo(() => {
    const selectedRecipeIds = Object.values(mealSlots).flatMap((daySlots) => [
      daySlots.breakfast,
      daySlots.lunch,
      daySlots.dinner,
    ]);

    return selectedRecipeIds.reduce(
      (acc, recipeId) => {
        const selectedRecipe = recipes.find((item) => item.id === recipeId);
        if (!selectedRecipe?.nutrition) return acc;
        acc.calories += selectedRecipe.nutrition.calories || 0;
        acc.protein += selectedRecipe.nutrition.protein || 0;
        acc.carbs += selectedRecipe.nutrition.carbs || 0;
        acc.fat += selectedRecipe.nutrition.fat || 0;
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );
  }, [mealSlots, recipes]);
  const plannedMealCount = useMemo(
    () =>
      Object.values(mealSlots).flatMap((daySlots) => [daySlots.breakfast, daySlots.lunch, daySlots.dinner]).filter(Boolean)
        .length,
    [mealSlots]
  );
  const nutritionHistoryChart = useMemo(() => {
    const points = (nutritionHistory || []).slice(-10);
    const maxCalories = Math.max(...points.map((point) => Number(point.calories || 0)), 1);
    return {
      points,
      maxCalories,
    };
  }, [nutritionHistory]);

  const selectedRecipeDetails = useMemo(
    () => recipes.find((item) => item.id === selectedRecipeId) || null,
    [recipes, selectedRecipeId]
  );
  const recipeCardNutrition = useMemo(
    () => (recipe ? getDisplayNutrition(recipe) : null),
    [recipe]
  );
  const macroTargetsFilled = ["calorieTarget", "proteinTarget", "carbsTarget", "fatTarget"].filter(
    (key) => String(preferences[key] || "").trim() !== ""
  ).length;
  const profileSignalsCount =
    macroTargetsFilled +
    (String(preferences.allergies || "").trim() ? 1 : 0) +
    (String(preferences.dislikedItems || "").trim() ? 1 : 0);

  async function onBuildShoppingList() {
    setError("");
    setLoading(true);

    try {
      const selectedRecipeIds = Object.values(mealSlots).flatMap((daySlots) => [
        daySlots.breakfast,
        daySlots.lunch,
        daySlots.dinner,
      ]);

      const meals = selectedRecipeIds
        .filter(Boolean)
        .map((recipeId) => recipes.find((r) => r.id === recipeId))
        .filter(Boolean)
        .map((r) => ({ title: r.title, ingredients: r.ingredients || [] }));

      if (meals.length === 0) {
        // Fallback to the last generated recipe for convenience.
        if (recipe?.ingredients?.length) {
          meals.push({ title: recipe.title, ingredients: recipe.ingredients || [] });
        } else {
          setShoppingList([]);
          setToast("Select meals from the planner first");
          return;
        }
      }

      const result = await buildShoppingList(meals, token);
      setShoppingList(result.items || []);
      setLatestShoppingListMeta({
        id: "",
        title: "Shopping List",
        createdAt: new Date().toISOString(),
      });
      if (token) {
        await onLoadLatestShoppingList();
      }
      setToast("Shopping list generated");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function onLoadLatestShoppingList() {
    if (!token) return;
    try {
      const payload = await fetchLatestShoppingList(token);
      setShoppingList(payload.items || []);
      if (payload?.id) {
        setLatestShoppingListMeta({
          id: payload.id || "",
          title: payload.title || "Shopping List",
          createdAt: payload.createdAt || "",
        });
      } else {
        setLatestShoppingListMeta(null);
      }
    } catch (_err) {
      setLatestShoppingListMeta(null);
    }
  }

  async function onToggleShoppingItemPurchased(item) {
    if (!token || !item?.id) return;
    try {
      const updated = await updateShoppingListItem(token, item.id, {
        purchased: !Boolean(item.purchased),
      });
      setShoppingList((prev) =>
        prev.map((entry) => (entry.id === updated.id ? { ...entry, purchased: updated.purchased } : entry))
      );
    } catch (_err) {
      setError("Unable to update shopping item");
    }
  }

  async function onEditShoppingItem(item) {
    if (!token || !item?.id) return;
    const nextName = window.prompt("Item name", item.name || "");
    if (nextName == null) return;
    const quantityRaw = window.prompt("Quantity", String(item.quantity ?? 1));
    if (quantityRaw == null) return;
    const unit = window.prompt("Unit", item.unit || "item");
    if (unit == null) return;

    const parsedQuantity = Number(quantityRaw);
    try {
      const updated = await updateShoppingListItem(token, item.id, {
        name: nextName.trim() || item.name,
        quantity: Number.isFinite(parsedQuantity) ? parsedQuantity : item.quantity,
        unit: unit.trim() || "item",
      });
      setShoppingList((prev) =>
        prev.map((entry) =>
          entry.id === updated.id
            ? {
                ...entry,
                name: updated.name,
                quantity: updated.quantity,
                unit: updated.unit,
              }
            : entry
        )
      );
      setToast("Shopping item updated");
    } catch (_err) {
      setError("Unable to edit shopping item");
    }
  }

  async function onDeleteShoppingItem(item) {
    if (!token || !item?.id) return;
    const confirmed = window.confirm(`Delete "${item.name}" from shopping list?`);
    if (!confirmed) return;
    try {
      await deleteShoppingListItem(token, item.id);
      setShoppingList((prev) => prev.filter((entry) => entry.id !== item.id));
      setToast("Shopping item removed");
    } catch (_err) {
      setError("Unable to delete shopping item");
    }
  }

  async function onEditMealHistory(entry) {
    if (!token || !entry?.id) return;
    const title = window.prompt("Meal title", entry.title || "");
    if (title == null) return;
    const calories = window.prompt("Calories", String(entry.calories ?? 0));
    if (calories == null) return;
    const protein = window.prompt("Protein (g)", String(entry.protein ?? 0));
    if (protein == null) return;
    const carbs = window.prompt("Carbs (g)", String(entry.carbs ?? 0));
    if (carbs == null) return;
    const fat = window.prompt("Fat (g)", String(entry.fat ?? 0));
    if (fat == null) return;

    try {
      const updated = await updateMealHistoryEntry(token, entry.id, {
        title: title.trim() || entry.title,
        calories: Number(calories),
        protein: Number(protein),
        carbs: Number(carbs),
        fat: Number(fat),
      });
      setMealHistory((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      await onLoadNutritionHistory();
      setToast("Meal history updated");
    } catch (_err) {
      setError("Unable to update meal history");
    }
  }

  async function onDeleteMealHistory(entry) {
    if (!token || !entry?.id) return;
    const confirmed = window.confirm(`Delete meal log "${entry.title}"?`);
    if (!confirmed) return;
    try {
      await deleteMealHistoryEntry(token, entry.id);
      setMealHistory((prev) => prev.filter((item) => item.id !== entry.id));
      await onLoadNutritionHistory();
      setToast("Meal log deleted");
    } catch (_err) {
      setError("Unable to delete meal log");
    }
  }

  async function onLoadRecipes() {
    if (!token) return;
    setError("");
    setLoading(true);
    try {
      const result = await fetchRecipes({}, token);
      setRecipes(dedupeRecipes(result.items || []));
    } catch (err) {
      try {
        const fallback = await fetchRecipes({});
        setRecipes(dedupeRecipes(fallback.items || []));
        setToast("Loaded fallback recipes");
      } catch (_fallbackErr) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function onLoadWeeklyMealPlan() {
    if (!token) return;
    setError("");
    setLoading(true);
    try {
      const result = await fetchWeeklyMealPlan(calendarWeekStart, token);
      const slots = result?.slots || {};

      setMealSlots((prev) => ({
        ...prev,
        ...Object.fromEntries(
          Object.keys(initialMealSlots).map((day) => [
            day,
            {
              breakfast: slots[day]?.breakfast || "",
              lunch: slots[day]?.lunch || "",
              dinner: slots[day]?.dinner || "",
            },
          ])
        ),
      }));
      setSavedWeeklyPlan({
        weekStart: calendarWeekStart,
        slots: Object.fromEntries(
          Object.keys(initialMealSlots).map((day) => [
            day,
            {
              breakfast: slots[day]?.breakfast || "",
              lunch: slots[day]?.lunch || "",
              dinner: slots[day]?.dinner || "",
            },
          ])
        ),
        savedAt: "",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function onLoadNutritionSummary() {
    try {
      const summary = await fetchNutritionSummary(calendarWeekStart, token);
      setNutritionPlanSummary(summary);
    } catch (_err) {
      // Keep UI usable even if summary endpoint is temporarily unavailable.
      setNutritionPlanSummary(null);
    }
  }

  const accountAuthPanel = (
    <GlassCard className="w-full max-w-md self-center p-6 shadow-[0_20px_80px_rgba(37,99,235,0.15)]">
      <SectionHeader
        title="Account"
        subtitle={profile ? `Signed in as ${profile.email}` : "Sign in to continue to your meal planner"}
      />
      <div className="mb-4 inline-flex rounded-full border border-blue-100 bg-blue-50 p-1">
        {["login", "signup"].map((mode) => (
          <button
            key={mode}
            onClick={() => setAuthMode(mode === "signup" ? "register" : "login")}
            className={`rounded-full px-4 py-1.5 text-sm capitalize transition ${
              authMode === (mode === "signup" ? "register" : "login")
                ? "bg-gradient-to-r from-blue-500 to-blue-700 text-white"
                : "text-slate-600 hover:text-blue-700"
            }`}
          >
            {mode === "signup" ? "SignUp" : "Login"}
          </button>
        ))}
      </div>
      <form onSubmit={onSubmitAuth} className="grid gap-3">
        {authMode === "register" ? (
          <input
            className="premium-input"
            placeholder="Full Name"
            value={authForm.name}
            onChange={(e) => setAuthForm((prev) => ({ ...prev, name: e.target.value }))}
          />
        ) : null}
        <input
          className="premium-input"
          placeholder="Email Address"
          type="email"
          value={authForm.email}
          onChange={(e) => setAuthForm((prev) => ({ ...prev, email: e.target.value }))}
          required
        />
        <input
          className="premium-input"
          placeholder="Password"
          type="password"
          value={authForm.password}
          onChange={(e) => setAuthForm((prev) => ({ ...prev, password: e.target.value }))}
          required
        />
        <button
          className="rounded-xl bg-gradient-to-r from-blue-500 to-blue-700 px-4 py-3 text-sm font-semibold text-white transition hover:scale-[1.02]"
          type="submit"
          disabled={loading}
        >
          {authMode === "register" ? "Create account" : "Login"}
        </button>
      </form>
      <div className="mt-3">
        {GOOGLE_CLIENT_ID ? (
          <div className="space-y-2">
            <div id="google-signin-btn" className="min-h-10" />
            <a
              href={getGitHubOAuthStartUrl()}
              className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Continue with GitHub
            </a>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">
              Set <code>VITE_GOOGLE_CLIENT_ID</code> in frontend env to enable Google Sign-In.
            </p>
            <a
              href={getGitHubOAuthStartUrl()}
              className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Continue with GitHub
            </a>
          </div>
        )}
      </div>
    </GlassCard>
  );

  if (!token) {
    return (
      <main className="relative min-h-screen overflow-x-hidden bg-gradient-to-br from-white via-blue-50 to-blue-100 px-4 pb-16 pt-10 text-slate-800 md:px-8">
        <div className="pointer-events-none absolute -left-24 top-12 h-64 w-64 rounded-full bg-blue-200/50 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 top-36 h-72 w-72 rounded-full bg-sky-200/50 blur-3xl" />
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-6">
          <motion.header
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative w-full overflow-hidden rounded-[24px] border border-blue-100 bg-white p-10 text-center shadow-[0_30px_120px_rgba(37,99,235,0.12)]"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-blue-100/60 via-white/20 to-sky-100/60" />
            <div className="relative z-10">
              <h1 className="mx-auto max-w-4xl text-balance text-4xl font-semibold leading-tight text-blue-900 md:text-6xl">
                Welcome to AI Recipe Planner
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-pretty text-slate-600">
                Sign in first to access personalized recipes, nutrition optimization, and meal planning.
              </p>
            </div>
          </motion.header>
          {accountAuthPanel}
        </div>
      </main>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-gradient-to-br from-white via-slate-50 to-blue-50 text-slate-800">
      <div className="pointer-events-none absolute -left-24 top-12 h-64 w-64 rounded-full bg-blue-200/45 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-36 h-72 w-72 rounded-full bg-sky-200/50 blur-3xl" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1600px]">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-blue-100 bg-white/95 py-6 pl-4 pr-3 backdrop-blur md:flex">
          <div className="mb-6 px-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">AI Recipe Planner</p>
            <p className="mt-1 truncate text-sm text-slate-600" title={profile?.email || ""}>
              {profile?.email || "Signed in"}
            </p>
          </div>
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto pr-1">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveView(id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                  activeView === id
                    ? "bg-blue-600 text-white shadow-md shadow-blue-500/25"
                    : "text-slate-700 hover:bg-blue-50"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 opacity-90" />
                <span className="leading-snug">{label}</span>
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={onLogout}
            className="mt-4 flex items-center gap-2 rounded-xl border border-blue-100 px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-blue-50"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        </aside>

        <main className="min-w-0 flex-1 px-4 pb-24 pt-4 md:px-8 md:pb-16 md:pt-8">
          <div className="mb-4 md:hidden">
            <div className="sticky top-0 z-20 -mx-4 rounded-b-2xl border-b border-blue-100 bg-white/95 px-3 py-3 shadow-sm backdrop-blur">
              <p className="mb-2 px-1 text-xs font-semibold text-blue-700">Menu</p>
              <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {navItems.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveView(id)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      activeView === id ? "bg-blue-600 text-white" : "border border-blue-200 bg-white text-slate-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-blue-100 py-2 text-xs font-medium text-slate-600"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {activeView === DASHBOARD_VIEWS.home ? (
              <>
                <motion.header
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="relative overflow-hidden rounded-[28px] border border-blue-100 bg-white p-8 shadow-[0_24px_80px_-32px_rgba(37,99,235,0.25)]"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-50/90 via-white to-sky-50/80" />
                  <div className="relative z-10 text-center">
                    <p className="mx-auto mb-3 inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-4 py-1 text-xs font-medium tracking-wide text-blue-800">
                      <Sparkles className="mr-2 h-3.5 w-3.5 text-blue-600" />
                      AI Culinary Copilot
                    </p>
                    <h1 className="mx-auto max-w-4xl text-balance text-4xl font-semibold leading-tight text-blue-950 md:text-6xl">
                      Plan smarter meals with premium AI recipe intelligence
                    </h1>
                    <p className="mx-auto mt-4 max-w-2xl text-pretty text-slate-600">
                      Upload ingredients, generate adaptive recipes, optimize nutrition, and turn your week into a
                      streamlined meal system.
                    </p>
                    <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveView(DASHBOARD_VIEWS.discovery);
                          onGenerateRecipe();
                        }}
                        disabled={isGenerating}
                        className="rounded-full bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:scale-[1.03] hover:shadow-lg hover:shadow-blue-500/25 disabled:opacity-60"
                      >
                        {isGenerating ? "Crafting..." : "Generate Recipe"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveView(DASHBOARD_VIEWS.discovery);
                          onSearchRecipes();
                        }}
                        disabled={loading}
                        className="rounded-full border border-blue-200 bg-white px-6 py-3 text-sm font-semibold text-blue-900 transition hover:scale-[1.03] hover:bg-blue-50 disabled:opacity-60"
                      >
                        Discover Recipes
                      </button>
                    </div>
                  </div>
                </motion.header>

                <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <StatCard label="Saved Recipes" value={recipes.length} accent="from-blue-800 to-blue-500" />
                  <StatCard label="Detected Items" value={detectedIngredients.length} accent="from-sky-700 to-blue-500" />
                  <StatCard label="Planned Calories" value={`${nutritionSummary.calories} kcal`} accent="from-blue-900 to-blue-600" />
                  <StatCard label="Shopping Items" value={shoppingList.length} accent="from-indigo-700 to-blue-500" />
                </section>
                <GlassCard>
                  <SectionHeader
                    title="Notifications"
                    subtitle="Recent updates from meal planning, history logs, and shopping list generation"
                    action={
                      <button
                        type="button"
                        onClick={onMarkNotificationsRead}
                        className="rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-50"
                      >
                        Mark all read
                      </button>
                    }
                  />
                  {notifications.length ? (
                    <div className="space-y-2">
                      {notifications.slice(0, 6).map((item) => (
                        <div key={item.id} className="rounded-xl border border-blue-100 bg-white p-3">
                          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                            <Bell className="h-4 w-4 text-blue-600" />
                            {item.title}
                            {!item.isRead ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700">NEW</span> : null}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">{item.message}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600">No notifications yet.</p>
                  )}
                </GlassCard>
              </>
            ) : null}

            {activeView === DASHBOARD_VIEWS.preferences ? (
              <GlassCard>
                <SectionHeader
                  title="Dietary Preferences"
                  subtitle="Personalize recommendations and optimize nutrition goals"
                />
                <div className="grid gap-4 lg:grid-cols-[1.8fr_1fr]">
                  <div className="space-y-4 rounded-2xl border border-blue-100 bg-white/90 p-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="md:col-span-1">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Diet Type</p>
                        <select
                          className="premium-input"
                          value={preferences.dietType}
                          onChange={(e) => setPreferences((prev) => ({ ...prev, dietType: e.target.value }))}
                        >
                          {["OMNIVORE", "VEGETARIAN", "VEGAN", "KETO", "PALEO"].map((dietType) => (
                            <option key={dietType} value={dietType}>
                              {dietType}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="md:col-span-1">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Allergies</p>
                        <input
                          className="premium-input"
                          placeholder="e.g. peanuts, shellfish"
                          value={preferences.allergies}
                          onChange={(e) => setPreferences((prev) => ({ ...prev, allergies: e.target.value }))}
                        />
                      </div>
                      <div className="md:col-span-1">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Disliked Items</p>
                        <input
                          className="premium-input"
                          placeholder="e.g. mushrooms, olives"
                          value={preferences.dislikedItems}
                          onChange={(e) => setPreferences((prev) => ({ ...prev, dislikedItems: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">Macro Targets</p>
                      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <input
                          className="premium-input"
                          placeholder="Calories (kcal)"
                          type="number"
                          value={preferences.calorieTarget}
                          onChange={(e) => setPreferences((prev) => ({ ...prev, calorieTarget: e.target.value }))}
                        />
                        <input
                          className="premium-input"
                          placeholder="Protein (g)"
                          type="number"
                          value={preferences.proteinTarget}
                          onChange={(e) => setPreferences((prev) => ({ ...prev, proteinTarget: e.target.value }))}
                        />
                        <input
                          className="premium-input"
                          placeholder="Carbs (g)"
                          type="number"
                          value={preferences.carbsTarget}
                          onChange={(e) => setPreferences((prev) => ({ ...prev, carbsTarget: e.target.value }))}
                        />
                        <input
                          className="premium-input"
                          placeholder="Fat (g)"
                          type="number"
                          value={preferences.fatTarget}
                          onChange={(e) => setPreferences((prev) => ({ ...prev, fatTarget: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-2xl border border-blue-100 bg-white/95 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Goal Presets</p>
                    {[
                      { label: "Balanced", calorieTarget: 2200, proteinTarget: 120, carbsTarget: 260, fatTarget: 70 },
                      { label: "Muscle Gain", calorieTarget: 2800, proteinTarget: 170, carbsTarget: 320, fatTarget: 85 },
                      { label: "Fat Loss", calorieTarget: 1800, proteinTarget: 140, carbsTarget: 160, fatTarget: 55 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => onApplyGoalPreset(preset)}
                        className="w-full rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-left text-xs font-semibold text-blue-800 transition hover:bg-blue-100"
                      >
                        {preset.label}
                      </button>
                    ))}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Profile Strength</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{profileSignalsCount}/6 signals configured</p>
                      <p className="mt-1 text-xs text-slate-600">
                        Add allergies/dislikes and macro targets for better recommendations.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-slate-600">
                      These preferences directly influence recipe ranking, nutrition suggestions, and meal recommendations.
                    </p>
                  </div>
                  <div className="flex flex-col items-end">
                    <button
                      className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:scale-[1.02] disabled:opacity-50"
                      onClick={onSavePreferences}
                      disabled={loading || !token}
                    >
                      {preferencesSaveStatus.type === "saving" ? "Saving..." : "Save Preferences"}
                    </button>
                    {preferencesSaveStatus.type !== "idle" ? (
                      <p
                        className={`mt-1 text-xs font-medium ${
                          preferencesSaveStatus.type === "success"
                            ? "text-emerald-700"
                            : preferencesSaveStatus.type === "error"
                              ? "text-rose-700"
                              : "text-blue-700"
                        }`}
                      >
                        {preferencesSaveStatus.message}
                      </p>
                    ) : null}
                  </div>
                </div>
              </GlassCard>
            ) : null}

            {activeView === DASHBOARD_VIEWS.ingredients ? (
              <GlassCard>
                <SectionHeader title="Ingredient Detection" subtitle="Upload pantry photos and detect ingredients with AI vision" />
                <input
                  className="premium-input"
                  placeholder="Ingredients (comma separated)"
                  value={ingredientInput}
                  onChange={(e) => setIngredientInput(e.target.value)}
                />
                <div className="mt-3 rounded-2xl border border-dashed border-blue-200 bg-blue-50/60 p-4">
                  <input
                    className="w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-white"
                    type="file"
                    accept="image/*"
                    onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                  />
                </div>
                <button
                  className="mt-4 rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:scale-[1.02] disabled:opacity-50"
                  onClick={onRecognizeIngredients}
                  disabled={loading || !imageFile}
                >
                  {loading ? "Detecting..." : "Detect Ingredients"}
                </button>
                <div className="mt-4 flex flex-wrap gap-2">
                  {detectedIngredients.length ? (
                    detectedIngredients.map((item) => (
                      <span key={item} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-900">
                        {item}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-slate-600">No detected ingredients yet.</p>
                  )}
                </div>
                {detectionMeta ? (
                  <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/80 p-3 text-xs text-slate-700">
                    <p>
                      Confidence:{" "}
                      <span className="font-semibold text-blue-700">{Math.round(detectionMeta.confidence * 100)}%</span>
                    </p>
                    {detectionMeta.fileName ? <p className="mt-1 text-slate-600">File: {detectionMeta.fileName}</p> : null}
                    {detectionMeta.notes ? <p className="mt-1 text-slate-600">{detectionMeta.notes}</p> : null}
                  </div>
                ) : null}
              </GlassCard>
            ) : null}

            {activeView === DASHBOARD_VIEWS.discovery ? (
              <>
                <GlassCard>
                  <SectionHeader title="Recipe Preferences" subtitle="Tune cuisine, diet, and calories to generate personalized meals" />
                  <div className="grid gap-3 md:max-w-xl">
                    <select className="premium-input" value={diet} onChange={(e) => setDiet(e.target.value)}>
                      {["balanced", "high-protein", "vegetarian", "vegan", "keto"].map((dietOption) => (
                        <option key={dietOption} value={dietOption}>
                          {dietOption}
                        </option>
                      ))}
                    </select>
                    <select className="premium-input" value={cuisine} onChange={(e) => setCuisine(e.target.value)}>
                      {["indian", "italian", "mediterranean", "mexican", "asian"].map((cuisineOption) => (
                        <option key={cuisineOption} value={cuisineOption}>
                          {cuisineOption}
                        </option>
                      ))}
                    </select>
                    <input
                      className="premium-input"
                      placeholder="Calorie Target"
                      type="number"
                      value={calorieTarget}
                      onChange={(e) => setCalorieTarget(e.target.value)}
                    />
                    <button
                      className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:scale-[1.02] disabled:opacity-50"
                      type="button"
                      onClick={onGenerateRecipe}
                      disabled={isGenerating}
                    >
                      {isGenerating ? "Generating..." : "Generate Smart Recipe"}
                    </button>
                  </div>
                </GlassCard>

                {recipe ? (
                  <GlassCard>
                    <SectionHeader
                      title={recipe.title}
                      subtitle={lastGeneratedAt ? `AI-generated result with nutrition estimate - Last generated at ${lastGeneratedAt}` : "AI-generated result with nutrition estimate"}
                      action={
                        <button
                          type="button"
                          className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-900 transition hover:bg-blue-50"
                          onClick={async () => {
                            await onBuildShoppingList();
                            setActiveView(DASHBOARD_VIEWS.shopping);
                          }}
                          disabled={loading}
                        >
                          Create Shopping List
                        </button>
                      }
                    />
                    <div className="grid gap-3 md:grid-cols-4">
                      <StatCard label="Calories" value={`${recipeCardNutrition?.calories ?? 0} kcal`} accent="from-blue-900 to-blue-600" />
                      <StatCard label="Protein" value={`${recipeCardNutrition?.protein ?? 0} g`} accent="from-sky-800 to-blue-600" />
                      <StatCard label="Carbs" value={`${recipeCardNutrition?.carbs ?? 0} g`} accent="from-blue-800 to-sky-500" />
                      <StatCard label="Fat" value={`${recipeCardNutrition?.fat ?? 0} g`} accent="from-indigo-800 to-blue-600" />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(recipe.ingredients || []).map((item) => (
                        <span key={item} className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs text-blue-950">
                          {item}
                        </span>
                      ))}
                    </div>
                  </GlassCard>
                ) : (
                  <p className="text-sm text-slate-600">Your latest recipe will appear here after you generate one.</p>
                )}
              </>
            ) : null}

            {activeView === DASHBOARD_VIEWS.discovery ? (
              <GlassCard>
                <SectionHeader
                  title="Recipe Discovery"
                  subtitle="Filter by intent and discover your recipe library"
                  action={
                    <button
                      type="button"
                      className="inline-flex items-center rounded-full bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:scale-[1.03]"
                      onClick={onSearchRecipes}
                      disabled={loading}
                    >
                      <Search className="mr-2 h-4 w-4" /> Search
                    </button>
                  }
                />
                <div className="grid gap-3 md:grid-cols-4">
                  <input
                    className="premium-input"
                    placeholder="Search ingredient/title"
                    value={filters.query}
                    onChange={(e) => setFilters((prev) => ({ ...prev, query: e.target.value }))}
                  />
                  <div className="relative">
                    <Leaf className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-400" />
                    <input
                      className="premium-input premium-input-icon"
                      placeholder="Diet"
                      value={filters.diet}
                      onChange={(e) => setFilters((prev) => ({ ...prev, diet: e.target.value }))}
                    />
                  </div>
                  <div className="relative">
                    <UtensilsCrossed className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-400" />
                    <input
                      className="premium-input premium-input-icon"
                      placeholder="Cuisine"
                      value={filters.cuisine}
                      onChange={(e) => setFilters((prev) => ({ ...prev, cuisine: e.target.value }))}
                    />
                  </div>
                  <div className="relative">
                    <Flame className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-400" />
                    <input
                      className="premium-input premium-input-icon"
                      placeholder="Max calories"
                      type="number"
                      value={filters.maxCalories}
                      onChange={(e) => setFilters((prev) => ({ ...prev, maxCalories: e.target.value }))}
                    />
                  </div>
                </div>
                {recipes.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-600">No recipes yet. Try searching or generating one first 🍽️</p>
                ) : (
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {recipes.map((item) => (
                      <motion.article
                        whileHover={{ y: -2, scale: 1.01 }}
                        key={item.id}
                        onClick={() => {
                          setSelectedRecipeId(item.id);
                          setShowRecipeIngredientsPopup(true);
                        }}
                        className={`cursor-pointer rounded-2xl border bg-white p-4 shadow-sm transition ${
                          selectedRecipeId === item.id
                            ? "border-blue-500 ring-2 ring-blue-200"
                            : "border-blue-100 hover:border-blue-300"
                        }`}
                      >
                        <p className="font-medium text-slate-900">{item.title}</p>
                        <p className="mt-1 text-sm text-slate-600">{getDisplayNutrition(item).calories} kcal</p>
                      </motion.article>
                    ))}
                  </div>
                )}
              </GlassCard>
            ) : null}

            {activeView === DASHBOARD_VIEWS.planner ? (
              <>
                <GlassCard>
                <SectionHeader
                  title="Interactive Weekly Planner"
                  subtitle="Plan meals for one day at a time using the day selector"
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-900 transition hover:bg-blue-50"
                        onClick={onResetMealPlan}
                        disabled={loading}
                      >
                        Reset Week
                      </button>
                      <button
                        type="button"
                        className="rounded-full bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:scale-[1.03]"
                        onClick={onSaveMealPlan}
                        disabled={loading}
                      >
                        Save Weekly Plan
                      </button>
                    </div>
                  }
                />
                <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-3">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Week Start Date
                  </label>
                  <input
                    className="premium-input max-w-xs"
                    type="date"
                    value={calendarWeekStart}
                    onChange={(e) => setCalendarWeekStart(e.target.value)}
                  />
                  <p className="mt-2 text-xs text-slate-600">
                    Tip: select recipes first in Recipe Library, then assign meals for your chosen day.
                  </p>
                </div>
                <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-3">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Choose Day
                  </label>
                  <select
                    className="premium-input max-w-xs"
                    value={selectedPlannerDay}
                    onChange={(e) => setSelectedPlannerDay(e.target.value)}
                  >
                    {plannerDays.map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-4 md:grid-cols-1 xl:grid-cols-1">
                  <motion.article
                    whileHover={{ y: -3 }}
                    key={selectedPlannerDay}
                    className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm"
                  >
                    <p className="mb-3 text-base font-semibold text-blue-900">{selectedPlannerDay}</p>
                    {["breakfast", "lunch", "dinner"].map((slotType) => (
                      <label className="mb-3 block text-xs font-medium uppercase tracking-wide text-slate-600" key={slotType}>
                        {slotType}
                        <select
                          className="premium-input mt-1 h-11"
                          value={mealSlots[selectedPlannerDay]?.[slotType] || ""}
                          onChange={(e) => onMealSlotChange(selectedPlannerDay, slotType, e.target.value)}
                        >
                          <option value="">Select a recipe</option>
                          {recipes.map((recipeOption) => (
                            <option key={recipeOption.id} value={recipeOption.id}>
                              {recipeOption.title}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="mt-2 rounded-lg border border-blue-200 bg-white px-3 py-1 text-[11px] font-semibold text-blue-800 hover:bg-blue-50"
                          onClick={() => onLogMealFromPlanner(selectedPlannerDay, slotType)}
                        >
                          Log {slotType}
                        </button>
                      </label>
                    ))}
                  </motion.article>
                </div>
                </GlassCard>
                <GlassCard>
                  <SectionHeader title="Nutrition Tracker" subtitle="Live nutrition totals from your planned meals" />
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="space-y-2 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span>Calories</span>
                        <Flame className="h-4 w-4 text-blue-600" />
                      </div>
                      <p className="text-xl font-bold text-blue-800">{nutritionSummary.calories} kcal</p>
                      <p className="text-xs text-slate-600">Target: {nutritionPlanSummary?.target?.calories ?? 2400} kcal</p>
                      <div className="h-2 rounded-full bg-blue-100">
                        <div
                          style={{
                            width: `${Math.min((nutritionSummary.calories / (nutritionPlanSummary?.target?.calories || 2400)) * 100, 100)}%`,
                          }}
                          className="h-2 rounded-full bg-blue-600"
                        />
                      </div>
                    </div>
                    <div className="space-y-2 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span>Protein</span>
                        <Drumstick className="h-4 w-4 text-blue-600" />
                      </div>
                      <p className="text-xl font-bold text-blue-800">{nutritionSummary.protein} g</p>
                      <p className="text-xs text-slate-600">Target: {nutritionPlanSummary?.target?.protein ?? 140} g</p>
                      <div className="h-2 rounded-full bg-blue-100">
                        <div
                          style={{
                            width: `${Math.min((nutritionSummary.protein / (nutritionPlanSummary?.target?.protein || 140)) * 100, 100)}%`,
                          }}
                          className="h-2 rounded-full bg-sky-600"
                        />
                      </div>
                    </div>
                    <div className="space-y-2 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span>Carbs</span>
                        <ChefHat className="h-4 w-4 text-blue-600" />
                      </div>
                      <p className="text-xl font-bold text-blue-800">{nutritionSummary.carbs} g</p>
                      <p className="text-xs text-slate-600">Target: {nutritionPlanSummary?.target?.carbs ?? 300} g</p>
                      <div className="h-2 rounded-full bg-blue-100">
                        <div
                          style={{
                            width: `${Math.min((nutritionSummary.carbs / (nutritionPlanSummary?.target?.carbs || 300)) * 100, 100)}%`,
                          }}
                          className="h-2 rounded-full bg-indigo-600"
                        />
                      </div>
                    </div>
                    <div className="space-y-2 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span>Fat</span>
                        <Sparkles className="h-4 w-4 text-blue-600" />
                      </div>
                      <p className="text-xl font-bold text-blue-800">{nutritionSummary.fat} g</p>
                      <p className="text-xs text-slate-600">Target: {nutritionPlanSummary?.target?.fat ?? 80} g</p>
                      <div className="h-2 rounded-full bg-blue-100">
                        <div
                          style={{
                            width: `${Math.min((nutritionSummary.fat / (nutritionPlanSummary?.target?.fat || 80)) * 100, 100)}%`,
                          }}
                          className="h-2 rounded-full bg-blue-700"
                        />
                      </div>
                    </div>
                  </div>
                  {nutritionPlanSummary?.recommendations?.length ? (
                    <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
                      <p className="mb-2 text-sm font-semibold text-blue-900">Optimization Suggestions</p>
                      <ul className="space-y-1 text-xs text-slate-700">
                        {nutritionPlanSummary.recommendations.map((tip) => (
                          <li key={tip}>- {tip}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-blue-800">Nutrition is on track with your current targets.</p>
                  )}
                </GlassCard>
                <GlassCard>
                  <SectionHeader
                    title="Nutrition History Analytics"
                    subtitle="Track intake trends from logged meals over time"
                    action={
                      <select
                        className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-xs text-slate-700"
                        value={nutritionHistoryPeriod}
                        onChange={(e) => setNutritionHistoryPeriod(e.target.value)}
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                      </select>
                    }
                  />
                  {nutritionHistoryInsights ? (
                    <div className="mb-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border border-blue-100 bg-white p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Weekly Avg</p>
                        <p className="mt-1 text-sm font-semibold text-blue-900">
                          {nutritionHistoryInsights.weeklyAverage?.calories || 0} kcal/day
                        </p>
                        <p className="text-xs text-slate-600">
                          P {nutritionHistoryInsights.weeklyAverage?.protein || 0}g | C {nutritionHistoryInsights.weeklyAverage?.carbs || 0}g | F {nutritionHistoryInsights.weeklyAverage?.fat || 0}g
                        </p>
                      </div>
                      <div className="rounded-xl border border-blue-100 bg-white p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">On-Target Streak</p>
                        <p className="mt-1 text-sm font-semibold text-blue-900">
                          {nutritionHistoryInsights.onTargetStreakDays || 0} days
                        </p>
                        <p className="text-xs text-slate-600">Consecutive days near your calorie target.</p>
                      </div>
                      <div className="rounded-xl border border-blue-100 bg-white p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Deficit/Surplus Trend</p>
                        <p className="mt-1 text-sm font-semibold text-blue-900">
                          {nutritionHistoryInsights.deficitSurplusTrend?.direction || "on-track"}
                        </p>
                        <p className="text-xs text-slate-600">
                          Gap: {nutritionHistoryInsights.deficitSurplusTrend?.targetGap || 0} kcal • Weekly change: {nutritionHistoryInsights.deficitSurplusTrend?.changeVsPreviousWeek || 0} kcal
                        </p>
                      </div>
                    </div>
                  ) : null}
                  {nutritionHistoryChart.points.length ? (
                    <div className="mb-4 rounded-2xl border border-blue-100 bg-white p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Calorie Trend</p>
                      <div className="flex items-end gap-2 overflow-x-auto">
                        {nutritionHistoryChart.points.map((point) => (
                          <div key={`chart-${point.label}`} className="flex min-w-[42px] flex-col items-center gap-1">
                            <div className="relative h-28 w-7 rounded-md bg-blue-50">
                              <div
                                className="absolute bottom-0 w-7 rounded-md bg-gradient-to-t from-blue-600 to-sky-400"
                                style={{
                                  height: `${Math.max(
                                    8,
                                    (Number(point.calories || 0) / nutritionHistoryChart.maxCalories) * 100
                                  )}%`,
                                }}
                              />
                            </div>
                            <p className="text-[10px] text-slate-500">{String(point.label).slice(-5)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {nutritionHistory.length ? (
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {nutritionHistory.slice(-9).map((point) => (
                        <div key={point.label} className="rounded-xl border border-blue-100 bg-white p-3">
                          <p className="text-xs font-semibold text-blue-800">{point.label}</p>
                          <p className="mt-1 text-xs text-slate-600">Calories: {Math.round(point.calories || 0)} kcal</p>
                          <p className="text-xs text-slate-600">Protein: {Math.round(point.protein || 0)} g</p>
                          <p className="text-xs text-slate-600">Carbs: {Math.round(point.carbs || 0)} g</p>
                          <p className="text-xs text-slate-600">Fat: {Math.round(point.fat || 0)} g</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600">No logged meal history yet. Use the “Log meal” buttons above.</p>
                  )}
                </GlassCard>
                <GlassCard>
                  <SectionHeader
                    title="Personalized Recommendations"
                    subtitle="Suggestions ranked by dietary preferences, macro targets, and recent meal history"
                  />
                  {recommendedRecipes.length ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {recommendedRecipes.slice(0, 6).map((item) => (
                        <div key={item.id} className="rounded-xl border border-blue-100 bg-white p-3">
                          <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                          <p className="mt-1 text-xs text-slate-600">{item.reason}</p>
                          <p className="mt-1 text-xs text-blue-800">
                            {item.nutrition?.calories || 0} kcal | {item.nutrition?.protein || 0}g protein
                          </p>
                          {item.signals ? (
                            <p className="mt-1 text-[11px] text-slate-500">
                              Trend: {item.signals.adherenceTrend} • Inventory matches: {item.signals.availableIngredientMatches}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600">Recommendations will appear after loading your recipes and targets.</p>
                  )}
                </GlassCard>
                <GlassCard>
                  <SectionHeader title="Recent Meal Logs" subtitle="Most recent consumed meals captured in PostgreSQL history" />
                  {mealHistory.length ? (
                    <div className="space-y-2">
                      {mealHistory.slice(0, 8).map((entry) => (
                        <div key={entry.id} className="rounded-xl border border-blue-100 bg-white p-3">
                          <p className="text-sm font-semibold text-slate-900">{entry.title}</p>
                          <p className="text-xs text-slate-600">
                            {entry.mealType} • {new Date(entry.consumedAt).toLocaleString()}
                          </p>
                          <p className="mt-1 text-xs text-blue-800">
                            {entry.calories || 0} kcal | P {entry.protein || 0}g | C {entry.carbs || 0}g | F {entry.fat || 0}g
                          </p>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => onEditMealHistory(entry)}
                              className="rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-800 hover:bg-blue-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteMealHistory(entry)}
                              className="rounded-md border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600">No meals logged yet.</p>
                  )}
                </GlassCard>
                {savedWeeklyPlan ? (
                  <GlassCard>
                    <SectionHeader
                      title="Saved Weekly Plan"
                      subtitle={`Week start: ${savedWeeklyPlan.weekStart}${savedWeeklyPlan.savedAt ? ` - Saved at ${savedWeeklyPlan.savedAt}` : ""}`}
                    />
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {plannerDays.map((day) => {
                        const dayPlan = savedWeeklyPlan.slots?.[day] || {};
                        const breakfastTitle = recipes.find((item) => item.id === dayPlan.breakfast)?.title || dayPlan.breakfast || "Not set";
                        const lunchTitle = recipes.find((item) => item.id === dayPlan.lunch)?.title || dayPlan.lunch || "Not set";
                        const dinnerTitle = recipes.find((item) => item.id === dayPlan.dinner)?.title || dayPlan.dinner || "Not set";
                        return (
                          <div key={day} className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
                            <p className="mb-2 text-sm font-semibold text-blue-900">{day}</p>
                            <p className="text-xs text-slate-700"><span className="font-medium">Breakfast:</span> {breakfastTitle}</p>
                            <p className="mt-1 text-xs text-slate-700"><span className="font-medium">Lunch:</span> {lunchTitle}</p>
                            <p className="mt-1 text-xs text-slate-700"><span className="font-medium">Dinner:</span> {dinnerTitle}</p>
                          </div>
                        );
                      })}
                    </div>
                  </GlassCard>
                ) : null}
              </>
            ) : null}

            {activeView === DASHBOARD_VIEWS.shopping ? (
              <GlassCard>
                <SectionHeader
                  title="Shopping List"
                  subtitle="Auto-generated from your selected recipes"
                  action={
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={onLoadLatestShoppingList}
                        className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-800 transition hover:bg-blue-50"
                        disabled={loading || !token}
                      >
                        Load Latest
                      </button>
                      <button
                        type="button"
                        onClick={onBuildShoppingList}
                        className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-3 py-2 text-xs font-semibold text-white transition hover:scale-[1.02] disabled:opacity-60"
                        disabled={loading}
                      >
                        Generate from Planner
                      </button>
                    </div>
                  }
                />
                <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs text-slate-700">
                  <p>
                    Planned meals this week: <span className="font-semibold text-blue-900">{plannedMealCount}</span>
                  </p>
                  {latestShoppingListMeta?.createdAt ? (
                    <p className="mt-1 text-slate-600">
                      Latest saved list: {new Date(latestShoppingListMeta.createdAt).toLocaleString()}
                    </p>
                  ) : null}
                </div>
                {shoppingList.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-blue-200 bg-white p-5 text-sm text-slate-600">
                    <p className="font-medium text-slate-800">No shopping list items yet.</p>
                    <p className="mt-1">
                      Add recipes to planner slots, then click <span className="font-semibold text-blue-700">Generate from Planner</span>.
                    </p>
                    <p className="mt-1">You can also click <span className="font-semibold text-blue-700">Load Latest</span> to restore your last saved list.</p>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-3">
                    {shoppingList.map((item) => (
                      <div key={item.id || item.name} className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
                        <p className={`font-medium ${item.purchased ? "text-slate-400 line-through" : "text-slate-900"}`}>
                          {item.name}
                        </p>
                        <p className="text-sm text-slate-600">
                          {item.quantity} {item.unit}
                        </p>
                        {item.id ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => onToggleShoppingItemPurchased(item)}
                              className="rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-800 hover:bg-blue-50"
                            >
                              {item.purchased ? "Unmark" : "Mark purchased"}
                            </button>
                            <button
                              type="button"
                              onClick={() => onEditShoppingItem(item)}
                              className="rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-800 hover:bg-blue-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteShoppingItem(item)}
                              className="rounded-md border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>
            ) : null}
          </div>
        </main>
      </div>
      {error ? (
        <div className="fixed bottom-5 right-5 rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm text-rose-700 shadow-lg">
          {error}
        </div>
      ) : null}
      {toast ? (
        <div className="fixed bottom-5 left-5 rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm text-blue-900 shadow-lg">
          {toast}
        </div>
      ) : null}
      {showRecipeIngredientsPopup && selectedRecipeDetails ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 px-4" onClick={() => setShowRecipeIngredientsPopup(false)}>
          <div
            className="w-full max-w-lg rounded-2xl border border-blue-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-blue-900">{selectedRecipeDetails.title}</p>
                <p className="text-xs text-slate-600">Ingredients</p>
              </div>
              <button
                type="button"
                onClick={() => setShowRecipeIngredientsPopup(false)}
                className="rounded-full border border-blue-200 p-1 text-slate-600 transition hover:bg-blue-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto pr-1">
              {(selectedRecipeDetails.ingredients || []).length ? (
                (selectedRecipeDetails.ingredients || []).map((ingredient) => (
                  <span
                    key={`${selectedRecipeDetails.id}-${ingredient}`}
                    className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-slate-700"
                  >
                    {ingredient}
                  </span>
                ))
              ) : (
                <p className="text-xs text-slate-600">No ingredient list available for this recipe yet.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
