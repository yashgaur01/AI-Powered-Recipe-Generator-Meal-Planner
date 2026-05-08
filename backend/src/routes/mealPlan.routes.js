import { Router } from "express";
import { z } from "zod";
import { mockDb } from "../data/mockDb.js";
import prisma from "../lib/prisma.js";
import { attachUserIfPresent, requireAuth } from "../middleware/auth.js";
import { createUserNotification } from "../services/notification.service.js";
import { estimateNutritionFromIngredients } from "../services/nutrition.service.js";

const router = Router();
router.use(attachUserIfPresent);

const shoppingListSchema = z.object({
  meals: z
    .array(
      z.object({
        title: z.string(),
        ingredients: z.array(z.string()),
      })
    )
    .default([]),
});

const weeklyPlanSchema = z.object({
  weekStart: z.string(),
  slots: z.record(
    z.object({
      breakfast: z.string().default(""),
      lunch: z.string().default(""),
      dinner: z.string().default(""),
    })
  ),
});

const mealHistoryEntrySchema = z.object({
  recipeId: z.string().optional(),
  title: z.string().min(1),
  mealType: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK"]).default("DINNER"),
  consumedAt: z.string().datetime().optional(),
  calories: z.number().int().nullable().optional(),
  protein: z.number().int().nullable().optional(),
  carbs: z.number().int().nullable().optional(),
  fat: z.number().int().nullable().optional(),
  notes: z.string().max(300).nullable().optional(),
});

const mealHistoryUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  mealType: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK"]).optional(),
  consumedAt: z.string().datetime().optional(),
  calories: z.number().int().nullable().optional(),
  protein: z.number().int().nullable().optional(),
  carbs: z.number().int().nullable().optional(),
  fat: z.number().int().nullable().optional(),
  notes: z.string().max(300).nullable().optional(),
});

const shoppingItemUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  quantity: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  purchased: z.boolean().optional(),
});

function toDaySlotsFromItems(items = []) {
  const dayMap = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const slots = {};
  for (const item of items) {
    const dayName = dayMap[item.dayOfWeek] || "Monday";
    if (!slots[dayName]) slots[dayName] = { breakfast: "", lunch: "", dinner: "" };
    slots[dayName][item.mealType] = item.recipeTitle;
  }
  return slots;
}

function buildNutritionDiff(actual, target) {
  const diff = actual - target;
  const abs = Math.abs(diff);
  const threshold = Math.max(target * 0.1, 10);
  if (abs <= threshold) return "on-track";
  return diff > 0 ? "high" : "low";
}

function nutritionRecommendations({ calories, protein, carbs, fat }) {
  const tips = [];
  if (protein === "low") tips.push("Add high-protein meals like paneer/tofu/chicken and legumes.");
  if (protein === "high") tips.push("Reduce heavy protein portions in one or two meals.");
  if (carbs === "low") tips.push("Add complex carbs such as rice, oats, quinoa, or sweet potato.");
  if (carbs === "high") tips.push("Swap one carb-heavy meal with a balanced low-carb option.");
  if (fat === "low") tips.push("Add healthy fats like nuts, seeds, olive oil, or avocado.");
  if (fat === "high") tips.push("Lower fried/oily ingredients and use lighter cooking methods.");
  if (calories === "low") tips.push("Increase meal portions or add one nutrient-dense snack.");
  if (calories === "high") tips.push("Reduce portion sizes and choose leaner cooking styles.");
  return tips;
}

function aggregateHistoryByPeriod(items = [], period = "daily") {
  const bucket = new Map();

  for (const item of items) {
    const consumedAt = new Date(item.consumedAt);
    const key =
      period === "weekly"
        ? `${consumedAt.getUTCFullYear()}-W${Math.ceil(
            (Date.UTC(consumedAt.getUTCFullYear(), consumedAt.getUTCMonth(), consumedAt.getUTCDate()) -
              Date.UTC(consumedAt.getUTCFullYear(), 0, 1) +
              86400000) /
              604800000
          )}`
        : consumedAt.toISOString().slice(0, 10);

    if (!bucket.has(key)) {
      bucket.set(key, {
        label: key,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        meals: 0,
      });
    }

    const agg = bucket.get(key);
    agg.calories += Number(item.calories || 0);
    agg.protein += Number(item.protein || 0);
    agg.carbs += Number(item.carbs || 0);
    agg.fat += Number(item.fat || 0);
    agg.meals += 1;
  }

  return [...bucket.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function buildNutritionInsights({ dailyPoints, target }) {
  const last7 = dailyPoints.slice(-7);
  const prev7 = dailyPoints.slice(-14, -7);
  const average = (arr, key) =>
    arr.length ? arr.reduce((sum, item) => sum + Number(item[key] || 0), 0) / arr.length : 0;

  const weeklyAverage = {
    calories: Math.round(average(last7, "calories")),
    protein: Math.round(average(last7, "protein")),
    carbs: Math.round(average(last7, "carbs")),
    fat: Math.round(average(last7, "fat")),
  };

  const thresholdCalories = Math.max(120, Number(target.calories || 2400) * 0.1);
  let onTargetStreakDays = 0;
  for (let i = dailyPoints.length - 1; i >= 0; i -= 1) {
    const point = dailyPoints[i];
    const delta = Math.abs(Number(point.calories || 0) - Number(target.calories || 2400));
    if (delta <= thresholdCalories) onTargetStreakDays += 1;
    else break;
  }

  const last7AvgCalories = average(last7, "calories");
  const prev7AvgCalories = average(prev7, "calories");
  const trendDelta = Math.round(last7AvgCalories - prev7AvgCalories);
  const targetGap = Math.round(last7AvgCalories - Number(target.calories || 2400));
  const trendDirection =
    targetGap > thresholdCalories
      ? "surplus"
      : targetGap < -thresholdCalories
        ? "deficit"
        : "on-track";

  return {
    weeklyAverage,
    onTargetStreakDays,
    deficitSurplusTrend: {
      direction: trendDirection,
      targetGap,
      changeVsPreviousWeek: trendDelta,
    },
  };
}

function scoreRecipeForUser({
  recipe,
  preference,
  macroGap,
  recentRecipeIds = new Set(),
  recipeFrequencyMap = new Map(),
  availableIngredients = new Set(),
  adherenceTrend = { direction: "on-track" },
}) {
  let score = 0;

  const ingredients = (recipe.ingredients || []).map((item) => String(item).toLowerCase());
  const title = String(recipe.title || "").toLowerCase();
  const cuisine = String(recipe.cuisine || "").toLowerCase();
  const dietType = String(preference?.dietType || "").toLowerCase();
  const allergies = (preference?.allergies || []).map((item) => String(item).toLowerCase());
  const dislikedItems = (preference?.dislikedItems || []).map((item) => String(item).toLowerCase());

  for (const blocked of [...allergies, ...dislikedItems]) {
    if (!blocked) continue;
    if (ingredients.some((i) => i.includes(blocked)) || title.includes(blocked)) {
      return -1000;
    }
  }

  if (dietType.includes("vegan")) {
    const hasAnimalProducts = ingredients.some((i) =>
      /(chicken|beef|fish|egg|paneer|cheese|yogurt|milk|mutton|pork)/i.test(i)
    );
    if (!hasAnimalProducts) score += 14;
  } else if (dietType.includes("vegetarian")) {
    const hasMeat = ingredients.some((i) => /(chicken|beef|fish|mutton|pork|turkey)/i.test(i));
    if (!hasMeat) score += 10;
  } else if (dietType.includes("keto")) {
    const carbs = Number(recipe.carbs || 0);
    if (carbs <= 20) score += 10;
  }

  score += Math.max(0, 12 - Math.abs(Number(recipe.protein || 0) - macroGap.proteinNeed));
  score += Math.max(0, 8 - Math.abs(Number(recipe.carbs || 0) - macroGap.carbsNeed));
  score += Math.max(0, 8 - Math.abs(Number(recipe.fat || 0) - macroGap.fatNeed));
  score += Math.max(0, 8 - Math.abs(Number(recipe.calories || 0) - macroGap.caloriesNeed));

  const timesRecentlyUsed = Number(recipeFrequencyMap.get(recipe.id) || 0);
  if (recentRecipeIds.has(recipe.id) || timesRecentlyUsed > 0) {
    score -= 8;
    score -= Math.min(timesRecentlyUsed * 2, 8);
  }

  const availableMatches = ingredients.filter((item) => availableIngredients.has(item)).length;
  score += Math.min(availableMatches * 1.5, 10);

  if (adherenceTrend.direction === "deficit" && Number(recipe.calories || 0) > 450) {
    score += 4;
  }
  if (adherenceTrend.direction === "surplus" && Number(recipe.calories || 0) < 450) {
    score += 4;
  }
  if (adherenceTrend.direction === "deficit" && Number(recipe.protein || 0) > 18) {
    score += 2;
  }

  if (cuisine && cuisine === String(preference?.dietType || "").toLowerCase()) {
    score += 1;
  }

  return {
    score,
    availableMatches,
    timesRecentlyUsed,
  };
}

router.get("/week", (req, res) => {
  const weekStart = (req.query.weekStart || "").toString();
  if (!weekStart) {
    return res.status(400).json({ message: "weekStart query parameter is required" });
  }

  if (!req.user?.sub) {
    return res.json({
      weekStart,
      slots: mockDb.weeklyMealPlans[weekStart] || {},
    });
  }

  return prisma.mealPlan
    .findFirst({
      where: {
        userId: req.user.sub,
        weekStart: new Date(weekStart),
      },
      include: { items: true },
    })
    .then((plan) => {
      if (!plan) return res.json({ weekStart, slots: {} });
      return res.json({ weekStart, slots: toDaySlotsFromItems(plan.items) });
    })
    .catch(() => res.json({ weekStart, slots: mockDb.weeklyMealPlans[weekStart] || {} }));
});

router.get("/nutrition-summary", async (req, res) => {
  const weekStart = (req.query.weekStart || "").toString();
  if (!weekStart) {
    return res.status(400).json({ message: "weekStart query parameter is required" });
  }

  const defaultTargets = { calories: 2400, protein: 140, carbs: 300, fat: 80 };

  let slots = {};
  let recipeIds = [];
  let userTargets = defaultTargets;

  if (req.user?.sub) {
    const [plan, preference] = await Promise.all([
      prisma.mealPlan.findFirst({
        where: { userId: req.user.sub, weekStart: new Date(weekStart) },
        include: { items: true },
      }),
      prisma.userPreference.findUnique({ where: { userId: req.user.sub } }),
    ]);

    slots = plan ? toDaySlotsFromItems(plan.items) : {};
    recipeIds = Object.values(slots).flatMap((daySlots) => [
      daySlots.breakfast,
      daySlots.lunch,
      daySlots.dinner,
    ]).filter(Boolean);

    userTargets = {
      calories: preference?.calorieTarget ?? defaultTargets.calories,
      protein: preference?.proteinTarget ?? defaultTargets.protein,
      carbs: preference?.carbsTarget ?? defaultTargets.carbs,
      fat: preference?.fatTarget ?? defaultTargets.fat,
    };
  } else {
    slots = mockDb.weeklyMealPlans[weekStart] || {};
    recipeIds = Object.values(slots).flatMap((daySlots) => [
      daySlots.breakfast,
      daySlots.lunch,
      daySlots.dinner,
    ]).filter(Boolean);
  }

  let recipeNutrition = [];
  if (req.user?.sub) {
    recipeNutrition = await prisma.recipe.findMany({
      where: { userId: req.user.sub, id: { in: recipeIds } },
      select: { id: true, calories: true, protein: true, carbs: true, fat: true },
    });
  } else {
    recipeNutrition = mockDb.recipes
      .filter((r) => recipeIds.includes(r.id))
      .map((r) => ({
        id: r.id,
        calories: r.nutrition?.calories ?? 0,
        protein: r.nutrition?.protein ?? 0,
        carbs: r.nutrition?.carbs ?? 0,
        fat: r.nutrition?.fat ?? 0,
      }));
  }

  const actual = recipeNutrition.reduce(
    (acc, r) => {
      acc.calories += Number(r.calories || 0);
      acc.protein += Number(r.protein || 0);
      acc.carbs += Number(r.carbs || 0);
      acc.fat += Number(r.fat || 0);
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const status = {
    calories: buildNutritionDiff(actual.calories, userTargets.calories),
    protein: buildNutritionDiff(actual.protein, userTargets.protein),
    carbs: buildNutritionDiff(actual.carbs, userTargets.carbs),
    fat: buildNutritionDiff(actual.fat, userTargets.fat),
  };

  const gap = {
    calories: actual.calories - userTargets.calories,
    protein: actual.protein - userTargets.protein,
    carbs: actual.carbs - userTargets.carbs,
    fat: actual.fat - userTargets.fat,
  };

  return res.json({
    weekStart,
    actual,
    target: userTargets,
    status,
    gap,
    recommendations: nutritionRecommendations(status),
  });
});

router.post("/week", (req, res) => {
  const parsed = weeklyPlanSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid request body",
      errors: parsed.error.flatten(),
    });
  }

  const dayMap = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4,
    Saturday: 5,
    Sunday: 6,
  };

  // Always keep in-memory for unauth users so the UI still behaves.
  if (!req.user?.sub) {
    mockDb.weeklyMealPlans[parsed.data.weekStart] = parsed.data.slots;
    return res.json({ success: true, weekStart: parsed.data.weekStart, persisted: "memory" });
  }

  const userId = req.user.sub;

  // The frontend stores recipe IDs in the planner slots, even though the DB column is named recipeTitle.
  const selectedRecipeIds = Object.entries(parsed.data.slots)
    .flatMap(([, meals]) => Object.values(meals))
    .filter(Boolean);

  return prisma.recipe
    .findMany({
      where: { userId, id: { in: selectedRecipeIds } },
      select: { id: true, ingredients: true },
    })
    .then((recipes) => {
      const recipeIngredientsById = new Map(recipes.map((r) => [r.id, r.ingredients || []]));

      const items = Object.entries(parsed.data.slots).flatMap(([dayName, meals]) =>
        Object.entries(meals)
          .filter(([, recipeId]) => Boolean(recipeId))
          .map(([mealType, recipeId]) => ({
            dayOfWeek: dayMap[dayName] ?? 0,
            mealType,
            recipeTitle: recipeId,
            ingredients: recipeIngredientsById.get(recipeId) || [],
          }))
      );

      return prisma.mealPlan
        .findFirst({
          where: {
            userId,
            weekStart: new Date(parsed.data.weekStart),
          },
        })
        .then((existing) => {
          if (existing) {
            return prisma.mealPlan.update({
              where: { id: existing.id },
              data: {
                items: {
                  deleteMany: {},
                  create: items,
                },
              },
            });
          }
          return prisma.mealPlan.create({
            data: {
              userId,
              weekStart: new Date(parsed.data.weekStart),
              items: { create: items },
            },
          });
        });
    })
    .then(async () => {
      await createUserNotification({
        userId,
        type: "MEAL_PLAN",
        title: "Meal plan updated",
        message: `Your meal plan for week ${parsed.data.weekStart} was saved.`,
        metadata: { weekStart: parsed.data.weekStart },
      });
      return res.json({ success: true, weekStart: parsed.data.weekStart, persisted: "postgres" });
    })
    .catch(() => {
      // Postgres might be down; keep an in-memory copy for a graceful fallback.
      mockDb.weeklyMealPlans[parsed.data.weekStart] = parsed.data.slots;
      return res.json({ success: true, weekStart: parsed.data.weekStart, persisted: "memory" });
    });
});

router.post("/shopping-list", (req, res) => {
  const parsed = shoppingListSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid request body",
      errors: parsed.error.flatten(),
    });
  }

  const ingredientMap = new Map();

  for (const meal of parsed.data.meals) {
    for (const ingredient of meal.ingredients) {
      const key = ingredient.trim().toLowerCase();
      ingredientMap.set(key, (ingredientMap.get(key) || 0) + 1);
    }
  }

  const shoppingList = [...ingredientMap.entries()].map(([name, quantity]) => ({
    name,
    quantity,
    unit: "item",
  }));

  // Persist shopping list when authenticated.
  if (req.user?.sub) {
    prisma.shoppingList
      .create({
        data: {
          userId: req.user.sub,
          title: "Shopping List",
          items: {
            create: shoppingList.map((i) => ({
              name: i.name,
              quantity: i.quantity,
              unit: i.unit,
            })),
          },
        },
      })
      .catch(() => {
        // Ignore persistence errors; still return computed shopping list.
      })
      .finally(async () => {
        await createUserNotification({
          userId: req.user.sub,
          type: "SHOPPING_LIST",
          title: "Shopping list generated",
          message: `Generated ${shoppingList.length} shopping list items from your meals.`,
          metadata: { itemsCount: shoppingList.length },
        });
        return res.json({ items: shoppingList });
      });
    return;
  }

  return res.json({ items: shoppingList });
});

router.get("/shopping-list/latest", async (req, res) => {
  if (!req.user?.sub) {
    return res.json({ id: null, title: "Shopping List", items: [] });
  }

  try {
    const latest = await prisma.shoppingList.findFirst({
      where: { userId: req.user.sub },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });

    if (!latest) {
      return res.json({ id: null, title: "Shopping List", items: [] });
    }

    return res.json({
      id: latest.id,
      title: latest.title,
      createdAt: latest.createdAt,
      items: latest.items.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity ?? 1,
        unit: item.unit || "item",
        purchased: item.purchased,
      })),
    });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to load latest shopping list" });
  }
});

router.patch("/shopping-list/items/:itemId", requireAuth, async (req, res) => {
  const parsed = shoppingItemUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
  }

  const { itemId } = req.params;
  const existing = await prisma.shoppingListItem.findFirst({
    where: {
      id: itemId,
      shoppingList: { userId: req.user.sub },
    },
  });
  if (!existing) return res.status(404).json({ message: "Shopping list item not found" });

  const updated = await prisma.shoppingListItem.update({
    where: { id: itemId },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.quantity !== undefined ? { quantity: parsed.data.quantity } : {}),
      ...(parsed.data.unit !== undefined ? { unit: parsed.data.unit } : {}),
      ...(parsed.data.purchased !== undefined ? { purchased: parsed.data.purchased } : {}),
    },
  });
  return res.json(updated);
});

router.delete("/shopping-list/items/:itemId", requireAuth, async (req, res) => {
  const { itemId } = req.params;
  const existing = await prisma.shoppingListItem.findFirst({
    where: {
      id: itemId,
      shoppingList: { userId: req.user.sub },
    },
  });
  if (!existing) return res.status(404).json({ message: "Shopping list item not found" });

  await prisma.shoppingListItem.delete({ where: { id: itemId } });
  return res.json({ success: true });
});

router.post("/history", requireAuth, async (req, res) => {
  const parsed = mealHistoryEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
  }

  const meal = await prisma.mealHistory.create({
    data: {
      userId: req.user.sub,
      recipeId: parsed.data.recipeId || null,
      title: parsed.data.title,
      mealType: parsed.data.mealType,
      consumedAt: parsed.data.consumedAt ? new Date(parsed.data.consumedAt) : new Date(),
      calories: parsed.data.calories ?? null,
      protein: parsed.data.protein ?? null,
      carbs: parsed.data.carbs ?? null,
      fat: parsed.data.fat ?? null,
      notes: parsed.data.notes ?? null,
    },
  });

  await createUserNotification({
    userId: req.user.sub,
    type: "MEAL_LOG",
    title: "Meal logged",
    message: `${parsed.data.title} logged to your nutrition history.`,
    metadata: { mealType: parsed.data.mealType },
  });

  return res.status(201).json(meal);
});

router.get("/history", requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 30), 200);
  const items = await prisma.mealHistory.findMany({
    where: { userId: req.user.sub },
    orderBy: { consumedAt: "desc" },
    take: limit,
  });
  return res.json({ items });
});

router.patch("/history/:historyId", requireAuth, async (req, res) => {
  const parsed = mealHistoryUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
  }

  const { historyId } = req.params;
  const existing = await prisma.mealHistory.findFirst({
    where: { id: historyId, userId: req.user.sub },
  });
  if (!existing) return res.status(404).json({ message: "Meal history entry not found" });

  const updated = await prisma.mealHistory.update({
    where: { id: historyId },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.mealType !== undefined ? { mealType: parsed.data.mealType } : {}),
      ...(parsed.data.consumedAt !== undefined ? { consumedAt: new Date(parsed.data.consumedAt) } : {}),
      ...(parsed.data.calories !== undefined ? { calories: parsed.data.calories } : {}),
      ...(parsed.data.protein !== undefined ? { protein: parsed.data.protein } : {}),
      ...(parsed.data.carbs !== undefined ? { carbs: parsed.data.carbs } : {}),
      ...(parsed.data.fat !== undefined ? { fat: parsed.data.fat } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
    },
  });
  return res.json(updated);
});

router.delete("/history/:historyId", requireAuth, async (req, res) => {
  const { historyId } = req.params;
  const existing = await prisma.mealHistory.findFirst({
    where: { id: historyId, userId: req.user.sub },
  });
  if (!existing) return res.status(404).json({ message: "Meal history entry not found" });

  await prisma.mealHistory.delete({ where: { id: historyId } });
  return res.json({ success: true });
});

router.get("/nutrition-history", requireAuth, async (req, res) => {
  const period = String(req.query.period || "daily").toLowerCase() === "weekly" ? "weekly" : "daily";
  const daysBack = Math.min(Math.max(Number(req.query.days || 30), 1), 180);
  const since = new Date();
  since.setDate(since.getDate() - daysBack);

  const [items, preference] = await Promise.all([
    prisma.mealHistory.findMany({
      where: {
        userId: req.user.sub,
        consumedAt: { gte: since },
      },
      orderBy: { consumedAt: "asc" },
      select: {
        consumedAt: true,
        calories: true,
        protein: true,
        carbs: true,
        fat: true,
      },
    }),
    prisma.userPreference.findUnique({ where: { userId: req.user.sub } }),
  ]);

  const aggregates = aggregateHistoryByPeriod(items, period);
  const dailyAggregates = aggregateHistoryByPeriod(items, "daily");
  const target = {
    calories: preference?.calorieTarget ?? 2400,
    protein: preference?.proteinTarget ?? 140,
    carbs: preference?.carbsTarget ?? 300,
    fat: preference?.fatTarget ?? 80,
  };
  const insights = buildNutritionInsights({
    dailyPoints: dailyAggregates,
    target,
  });

  return res.json({
    period,
    daysBack,
    target,
    points: aggregates,
    insights,
  });
});

router.get("/recommendations", requireAuth, async (req, res) => {
  const weekStart = (req.query.weekStart || "").toString();
  if (!weekStart) {
    return res.status(400).json({ message: "weekStart query parameter is required" });
  }

  const [preference, plan, recentMeals, recipes, recentMealLogs, latestShoppingList] = await Promise.all([
    prisma.userPreference.findUnique({ where: { userId: req.user.sub } }),
    prisma.mealPlan.findFirst({
      where: { userId: req.user.sub, weekStart: new Date(weekStart) },
      include: { items: true },
    }),
    prisma.mealHistory.findMany({
      where: { userId: req.user.sub },
      orderBy: { consumedAt: "desc" },
      take: 20,
      select: { recipeId: true },
    }),
    prisma.recipe.findMany({
      where: { userId: req.user.sub },
      take: 200,
      orderBy: { createdAt: "desc" },
    }),
    prisma.mealHistory.findMany({
      where: { userId: req.user.sub },
      orderBy: { consumedAt: "desc" },
      take: 40,
      select: { recipeId: true, calories: true },
    }),
    prisma.shoppingList.findFirst({
      where: { userId: req.user.sub },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const defaults = { calories: 2400, protein: 140, carbs: 300, fat: 80 };
  const target = {
    calories: preference?.calorieTarget ?? defaults.calories,
    protein: preference?.proteinTarget ?? defaults.protein,
    carbs: preference?.carbsTarget ?? defaults.carbs,
    fat: preference?.fatTarget ?? defaults.fat,
  };

  const plannedNutrition = (plan?.items || []).reduce(
    (acc, item) => {
      const recipe = recipes.find((r) => r.id === item.recipeTitle);
      acc.calories += Number(recipe?.calories || 0);
      acc.protein += Number(recipe?.protein || 0);
      acc.carbs += Number(recipe?.carbs || 0);
      acc.fat += Number(recipe?.fat || 0);
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const macroGap = {
    caloriesNeed: Math.max(0, target.calories - plannedNutrition.calories),
    proteinNeed: Math.max(0, target.protein - plannedNutrition.protein),
    carbsNeed: Math.max(0, target.carbs - plannedNutrition.carbs),
    fatNeed: Math.max(0, target.fat - plannedNutrition.fat),
  };

  const recentRecipeIds = new Set(recentMeals.map((meal) => meal.recipeId).filter(Boolean));
  const recipeFrequencyMap = recentMealLogs.reduce((map, entry) => {
    if (!entry.recipeId) return map;
    map.set(entry.recipeId, Number(map.get(entry.recipeId) || 0) + 1);
    return map;
  }, new Map());

  const availableIngredients = new Set(
    (latestShoppingList?.items || [])
      .filter((item) => Boolean(item.purchased))
      .map((item) => String(item.name || "").toLowerCase().trim())
      .filter(Boolean)
  );

  const targetCalories = Number(target.calories || 2400);
  const recentAvgCalories =
    recentMealLogs.length > 0
      ? recentMealLogs.reduce((sum, entry) => sum + Number(entry.calories || 0), 0) / recentMealLogs.length
      : targetCalories;
  const adherenceTrend =
    recentAvgCalories > targetCalories * 1.1
      ? { direction: "surplus" }
      : recentAvgCalories < targetCalories * 0.9
        ? { direction: "deficit" }
        : { direction: "on-track" };

  const ranked = recipes
    .map((recipe) => ({
      recipe,
      scoreData: scoreRecipeForUser({
        recipe,
        preference,
        macroGap,
        recentRecipeIds,
        recipeFrequencyMap,
        availableIngredients,
        adherenceTrend,
      }),
    }))
    .filter((item) => item.scoreData.score > -999)
    .sort((a, b) => b.scoreData.score - a.scoreData.score)
    .slice(0, 8);

  const rankedWithNutrition = await Promise.all(
    ranked.map(async (item) => {
      const storedNutrition = {
        calories: Number(item.recipe.calories || 0),
        protein: Number(item.recipe.protein || 0),
        carbs: Number(item.recipe.carbs || 0),
        fat: Number(item.recipe.fat || 0),
      };
      const missingNutrition = Object.values(storedNutrition).some((value) => !Number.isFinite(value) || value <= 0);

      let nutrition = storedNutrition;
      let nutritionSource = "stored";

      if (missingNutrition) {
        const estimated = await estimateNutritionFromIngredients(
          item.recipe.ingredients || [],
          Math.max(350, Math.round((target.calories || 2100) / 3))
        );
        nutrition = {
          calories: Number(estimated.calories || 0),
          protein: Number(estimated.protein || 0),
          carbs: Number(estimated.carbs || 0),
          fat: Number(estimated.fat || 0),
        };
        nutritionSource = estimated.source || "estimated";
      }

      return {
        id: item.recipe.id,
        title: item.recipe.title,
        cuisine: item.recipe.cuisine,
        ingredients: item.recipe.ingredients,
        nutrition,
        nutritionSource,
        score: Number(item.scoreData.score.toFixed(2)),
        reason:
          item.scoreData.availableMatches > 0
            ? `Strong fit with ${item.scoreData.availableMatches} available ingredients and macro alignment.`
            : item.scoreData.timesRecentlyUsed > 0
              ? "Nutritionally relevant, but slightly deprioritized to avoid repetition."
              : "Matches your macro targets and dietary preferences.",
        signals: {
          availableIngredientMatches: item.scoreData.availableMatches,
          recentFrequencyPenalty: item.scoreData.timesRecentlyUsed,
          adherenceTrend: adherenceTrend.direction,
        },
      };
    })
  );

  return res.json({
    weekStart,
    target,
    plannedNutrition,
    macroGap,
    adherenceTrend,
    availableIngredientsCount: availableIngredients.size,
    items: rankedWithNutrition,
  });
});

export default router;
