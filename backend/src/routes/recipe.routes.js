import { Router } from "express";
import { z } from "zod";
import { generateRecipe } from "../services/recipe.service.js";
import { mockDb } from "../data/mockDb.js";
import prisma from "../lib/prisma.js";
import { attachUserIfPresent } from "../middleware/auth.js";

const router = Router();

router.use(attachUserIfPresent);

const generateRecipeSchema = z.object({
  ingredients: z.array(z.string()).default([]),
  diet: z.string().optional(),
  calorieTarget: z.number().optional(),
  cuisine: z.string().optional(),
});

const createRecipeSchema = z.object({
  title: z.string(),
  diet: z.string().default("balanced"),
  cuisine: z.string().default("any"),
  ingredients: z.array(z.string()).default([]),
  steps: z.array(z.string()).default([]),
  nutrition: z.object({
    calories: z.number().default(0),
    protein: z.number().default(0),
    carbs: z.number().default(0),
    fat: z.number().default(0),
  }),
});

function mapRecipeForFrontend(recipeRecord) {
  // Keep a stable response shape for the React UI.
  return {
    id: recipeRecord.id,
    title: recipeRecord.title,
    cuisine: recipeRecord.cuisine,
    diet: undefined, // diet isn't persisted in the current schema
    ingredients: recipeRecord.ingredients ?? [],
    steps: recipeRecord.steps ?? [],
    nutrition: {
      calories: recipeRecord.calories ?? 0,
      protein: recipeRecord.protein ?? 0,
      carbs: recipeRecord.carbs ?? 0,
      fat: recipeRecord.fat ?? 0,
    },
  };
}

async function seedUserRecipesIfEmpty(userId) {
  const existing = await prisma.recipe.count({ where: { userId } });
  if (existing > 0) return;

  await prisma.recipe.createMany({
    data: mockDb.recipes.map((r) => ({
      userId,
      title: r.title,
      cuisine: r.cuisine || null,
      ingredients: r.ingredients || [],
      steps: r.steps || [],
      calories: r.nutrition?.calories ?? null,
      protein: r.nutrition?.protein ?? null,
      carbs: r.nutrition?.carbs ?? null,
      fat: r.nutrition?.fat ?? null,
    })),
    skipDuplicates: false,
  });
}

function filterRecipesInMemory({ items, query, diet, cuisine, maxCalories }) {
  return items.filter((recipe) => {
    const queryMatch =
      !query ||
      recipe.title.toLowerCase().includes(query) ||
      (recipe.ingredients || []).some((item) => item.toLowerCase().includes(query));

    // Diet isn't persisted in the current schema; keep filtering only for mock data.
    const dietMatch = !diet || (recipe.diet ? recipe.diet.toLowerCase() === diet : true);
    const cuisineMatch = !cuisine || (recipe.cuisine ? recipe.cuisine.toLowerCase() === cuisine : true);
    const caloriesMatch = !maxCalories || (recipe.nutrition?.calories || recipe.calories || 0) <= maxCalories;

    return queryMatch && dietMatch && cuisineMatch && caloriesMatch;
  });
}

router.get("/", (req, res) => {
  const query = (req.query.query || "").toString().toLowerCase();
  const diet = (req.query.diet || "").toString().toLowerCase();
  const cuisine = (req.query.cuisine || "").toString().toLowerCase();
  const maxCalories = Number(req.query.maxCalories || 0);

  // If authenticated, return per-user recipes from Postgres; otherwise use in-memory seed recipes.
  if (!req.user?.sub) {
    const filtered = filterRecipesInMemory({
      items: mockDb.recipes,
      query,
      diet,
      cuisine,
      maxCalories,
    });
    return res.json({ items: filtered });
  }

  return seedUserRecipesIfEmpty(req.user.sub)
    .then(() => prisma.recipe.findMany({ where: { userId: req.user.sub } }))
    .then((records) => {
      const filtered = filterRecipesInMemory({
        items: records.map(mapRecipeForFrontend),
        query,
        diet,
        cuisine,
        maxCalories,
      });
      return res.json({ items: filtered });
    })
    .catch(() => {
      // If DB isn't reachable, fall back to the in-memory seed data.
      const filtered = filterRecipesInMemory({
        items: mockDb.recipes,
        query,
        diet,
        cuisine,
        maxCalories,
      });
      return res.json({ items: filtered });
    });
});

router.post("/generate", async (req, res) => {
  const parsed = generateRecipeSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid request body",
      errors: parsed.error.flatten(),
    });
  }

  const recipe = await generateRecipe(parsed.data);
  const generatedRecipe = {
    id: `gen-${Date.now()}`,
    ...recipe,
    diet: parsed.data.diet || "balanced",
    cuisine: parsed.data.cuisine || "any",
  };

  // Persist only when user is authenticated; otherwise keep existing in-memory behavior.
  if (!req.user?.sub) {
    mockDb.recipes.unshift(generatedRecipe);
    return res.json(generatedRecipe);
  }

  try {
    const created = await prisma.recipe.create({
      data: {
        userId: req.user.sub,
        title: generatedRecipe.title,
        cuisine: generatedRecipe.cuisine || null,
        ingredients: generatedRecipe.ingredients || [],
        steps: generatedRecipe.steps || [],
        calories: generatedRecipe.nutrition?.calories ?? null,
        protein: generatedRecipe.nutrition?.protein ?? null,
        carbs: generatedRecipe.nutrition?.carbs ?? null,
        fat: generatedRecipe.nutrition?.fat ?? null,
      },
    });

    return res.json({
      ...generatedRecipe,
      id: created.id,
    });
  } catch (_error) {
    // DB unavailable: still respond with a recipe so the UI keeps working.
    mockDb.recipes.unshift(generatedRecipe);
    return res.json(generatedRecipe);
  }
});

router.post("/", (req, res) => {
  const parsed = createRecipeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid request body",
      errors: parsed.error.flatten(),
    });
  }

  const created = { id: `rec-${Date.now()}`, ...parsed.data };

  if (!req.user?.sub) {
    mockDb.recipes.unshift(created);
    return res.status(201).json(created);
  }

  return prisma.recipe
    .create({
      data: {
        userId: req.user.sub,
        title: created.title,
        cuisine: created.cuisine || null,
        ingredients: created.ingredients || [],
        steps: created.steps || [],
        calories: created.nutrition?.calories ?? null,
        protein: created.nutrition?.protein ?? null,
        carbs: created.nutrition?.carbs ?? null,
        fat: created.nutrition?.fat ?? null,
      },
    })
    .then((dbRecord) => {
      return res.status(201).json({
        ...created,
        id: dbRecord.id,
      });
    })
    .catch(() => {
      mockDb.recipes.unshift(created);
      return res.status(201).json(created);
    });
});

export default router;
