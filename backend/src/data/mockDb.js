export const mockDb = {
  recipes: [],
  weeklyMealPlans: {},
};

const seedRecipes = [
  {
    id: "seed-1",
    title: "Mediterranean Chickpea Bowl",
    cuisine: "mediterranean",
    diet: "vegetarian",
    ingredients: ["chickpeas", "quinoa", "cucumber", "tomato", "olive oil"],
    steps: ["Cook quinoa", "Mix vegetables", "Add chickpeas and dressing"],
    nutrition: { calories: 520, protein: 21, carbs: 62, fat: 18 },
  },
  {
    id: "seed-2",
    title: "High Protein Paneer Stir Fry",
    cuisine: "indian",
    diet: "balanced",
    ingredients: ["paneer", "bell pepper", "onion", "spinach", "spices"],
    steps: ["Saute onions", "Cook paneer with spices", "Add vegetables and serve"],
    nutrition: { calories: 610, protein: 35, carbs: 34, fat: 34 },
  },
  {
    id: "seed-3",
    title: "Keto Zucchini Noodle Bowl",
    cuisine: "fusion",
    diet: "keto",
    ingredients: ["zucchini", "mushroom", "garlic", "olive oil", "tofu"],
    steps: ["Spiralize zucchini", "Saute mushrooms", "Combine and season"],
    nutrition: { calories: 430, protein: 24, carbs: 18, fat: 27 },
  },
];

if (mockDb.recipes.length === 0) {
  mockDb.recipes.push(...seedRecipes);
}
