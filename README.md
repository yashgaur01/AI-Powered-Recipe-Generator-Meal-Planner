# AI-Powered Recipe Generator & Meal Planner

An intelligent full-stack culinary assistant that generates recipes from preferences and pantry inputs, supports weekly planning, tracks nutrition, and builds actionable shopping lists.

## Highlights

- AI recipe generation with OpenAI and Anthropic fallback support
- Ingredient detection from uploaded images with OpenAI/Hugging Face + safe fallback
- Weekly meal planning with nutrition summaries and goal-aware recommendations
- Shopping list workflow with filters, edit/delete, mark purchased, and restore latest list
- Meal history tracking with analytics, trends, streaks, and comparison insights
- JWT auth, Google/GitHub OAuth flows, and RBAC-ready admin endpoints

## Tech Stack

- Frontend: React + Vite + Tailwind
- Backend: Node.js + Express
- Database: PostgreSQL + Prisma ORM
- Authentication: JWT + OAuth (Google, GitHub)
- AI/ML: OpenAI, Anthropic, Hugging Face Inference, API Ninjas Nutrition API

## Project Structure

- `frontend/` - React client
- `backend/` - Express API, services, and Prisma schema
- `docker-compose.yml` - local PostgreSQL service

## Local Setup

### 1) Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2) Start PostgreSQL

```bash
docker compose up -d db
```

### 3) Configure environment

```bash
cd backend
cp .env.example .env
cd ../frontend
cp .env.example .env
```

### 4) Sync database schema

```bash
cd backend
npx prisma db push --accept-data-loss
npx prisma generate
```

### 5) Run backend

```bash
cd backend
npm run dev
```

### 6) Run frontend

```bash
cd frontend
npm run dev
```

## Environment Variables

### Backend (`backend/.env`)

- `PORT`
- `CLIENT_URL`
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `VISION_API_KEY`
- `VISION_API_URL` (recommended: `https://router.huggingface.co/hf-inference/models/nateraw/food`)
- `NUTRITION_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_CALLBACK_URL`

### Frontend (`frontend/.env`)

- `VITE_API_BASE_URL`
- `VITE_GOOGLE_CLIENT_ID`

## API Overview

### Health

- `GET /api/health`

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `PATCH /api/auth/me/preferences`
- `POST /api/auth/oauth/google`
- `GET /api/auth/oauth/github`
- `GET /api/auth/oauth/github/callback`
- `GET /api/auth/admin/users` (admin)

### Recipes and Ingredients

- `GET /api/recipes`
- `POST /api/recipes`
- `POST /api/recipes/generate`
- `POST /api/ingredients/recognize`
- `POST /api/ingredients/recognize-upload`

### Meal Planning, History, and Analytics

- `GET /api/meal-plans/week`
- `POST /api/meal-plans/week`
- `GET /api/meal-plans/nutrition-summary`
- `POST /api/meal-plans/history`
- `GET /api/meal-plans/history`
- `PATCH /api/meal-plans/history/:historyId`
- `DELETE /api/meal-plans/history/:historyId`
- `GET /api/meal-plans/nutrition-history`
- `GET /api/meal-plans/recommendations`

### Shopping List

- `POST /api/meal-plans/shopping-list`
- `GET /api/meal-plans/shopping-list/latest`
- `PATCH /api/meal-plans/shopping-list/items/:itemId`
- `DELETE /api/meal-plans/shopping-list/items/:itemId`

### Notifications

- `GET /api/notifications`
- `PATCH /api/notifications/read`
- `POST /api/notifications/admin/broadcast` (admin)

## Current Product Capabilities

- Login/register + Google/GitHub OAuth
- Save and manage dietary preferences
- Upload ingredient image and detect ingredients
- Generate AI recipes from ingredients and preferences
- Discover/filter recipes
- Plan weekly meals
- Log consumed meals and edit/delete logs
- View nutrition analytics with trend insights
- Get personalized recommendations with explanation signals
- Generate, load, edit, and complete shopping lists

## Security Notes

- Helmet headers enabled
- Global API rate limiting enabled
- JWT-protected routes
- RBAC middleware for admin routes

## Known Limits

- OpenAI vision requires active credits/quota on the key's project
- Some AI features fallback gracefully when provider APIs are unavailable
- Production deployment manifests are not included yet

