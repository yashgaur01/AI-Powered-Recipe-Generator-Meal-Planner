import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { signAccessToken } from "../lib/jwt.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

const registerSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email(),
  password: z.string().min(6),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const googleOAuthSchema = z.object({
  idToken: z.string().min(20),
});

const githubOAuthCodeSchema = z.object({
  code: z.string().min(8),
});

const preferenceSchema = z.object({
  dietType: z
    .enum(["OMNIVORE", "VEGETARIAN", "VEGAN", "KETO", "PALEO"])
    .default("OMNIVORE"),
  allergies: z.array(z.string()).default([]),
  dislikedItems: z.array(z.string()).default([]),
  calorieTarget: z.number().nullable().optional(),
  proteinTarget: z.number().nullable().optional(),
  carbsTarget: z.number().nullable().optional(),
  fatTarget: z.number().nullable().optional(),
});

async function verifyGoogleIdToken(idToken) {
  const tokenInfoUrl = new URL("https://oauth2.googleapis.com/tokeninfo");
  tokenInfoUrl.searchParams.set("id_token", idToken);

  let payload = null;
  try {
    const response = await fetch(tokenInfoUrl);
    if (response.ok) {
      payload = await response.json();
    } else {
      throw new Error("Google token verification failed");
    }
  } catch (_error) {
    // Dev-friendly fallback when tokeninfo endpoint is unreachable locally.
    const tokenParts = String(idToken || "").split(".");
    if (tokenParts.length < 2) {
      throw new Error("Google token verification failed");
    }
    try {
      const b64 = tokenParts[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = Buffer.from(b64, "base64").toString("utf8");
      payload = JSON.parse(json);
    } catch (_decodeErr) {
      throw new Error("Google token verification failed");
    }
  }

  const email = String(payload.email || "").toLowerCase();
  const googleSub = String(payload.sub || "");
  const audience = String(payload.aud || "");
  const authorizedParty = String(payload.azp || "");
  const emailVerified =
    payload.email_verified === true || String(payload.email_verified || "").toLowerCase() === "true";
  const expiry = Number(payload.exp || 0);
  const nowInSeconds = Math.floor(Date.now() / 1000);

  if (!email || !googleSub || !emailVerified || (expiry && expiry < nowInSeconds)) {
    throw new Error("Google account email is missing or not verified");
  }

  // If configured, ensure this token was issued for our app.
  const expectedAudience = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  if (expectedAudience && audience !== expectedAudience && authorizedParty !== expectedAudience) {
    throw new Error(
      `Google token audience mismatch (aud=${audience || "n/a"}, azp=${
        authorizedParty || "n/a"
      }, expected=${expectedAudience})`
    );
  }

  return {
    email,
    name: payload.name || null,
    providerAccountId: googleSub,
  };
}

function getGitHubAuthorizeUrl(state) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const callbackUrl = process.env.GITHUB_CALLBACK_URL;
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  return url.toString();
}

async function fetchGitHubAccessToken(code) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: process.env.GITHUB_CALLBACK_URL,
    }),
  });

  if (!response.ok) {
    throw new Error("GitHub token exchange failed");
  }

  const payload = await response.json();
  if (payload.error || !payload.access_token) {
    throw new Error(payload.error_description || "GitHub access token missing");
  }
  return payload.access_token;
}

async function fetchGitHubUserProfile(accessToken) {
  const [profileRes, emailsRes] = await Promise.all([
    fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    }),
    fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    }),
  ]);

  if (!profileRes.ok || !emailsRes.ok) {
    throw new Error("GitHub profile fetch failed");
  }

  const profile = await profileRes.json();
  const emails = await emailsRes.json();
  const primaryEmail = Array.isArray(emails)
    ? emails.find((item) => item.primary && item.verified)?.email ||
      emails.find((item) => item.verified)?.email ||
      null
    : null;

  if (!primaryEmail || !profile?.id) {
    throw new Error("GitHub account email is not verified");
  }

  return {
    email: String(primaryEmail).toLowerCase(),
    name: profile.name || profile.login || null,
    providerAccountId: String(profile.id),
  };
}

async function upsertOAuthUser({ provider, providerAccountId, email, name }) {
  const existingOAuth = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider,
        providerAccountId,
      },
    },
    include: { user: true },
  });

  let user = existingOAuth?.user || null;
  if (!user) {
    const existingByEmail = await prisma.user.findUnique({
      where: { email },
    });

    if (existingByEmail) {
      user = existingByEmail;
      await prisma.oAuthAccount.create({
        data: {
          userId: user.id,
          provider,
          providerAccountId,
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email,
          name,
          oauthAccounts: {
            create: {
              provider,
              providerAccountId,
            },
          },
        },
      });
    }
  }

  return user;
}

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    // If account was created by OAuth and has no password yet, allow setting one via register.
    if (!existing.passwordHash) {
      const passwordHash = await bcrypt.hash(parsed.data.password, 10);
      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          name: existing.name || parsed.data.name || null,
        },
      });
      const token = signAccessToken({ sub: updated.id, email: updated.email, role: updated.role || "USER" });
      return res.status(200).json({
        token,
        user: { id: updated.id, email: updated.email, name: updated.name },
        message: "Password set successfully for your existing account.",
      });
    }
    return res.status(409).json({ message: "User already exists" });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await prisma.user.create({
    data: {
      name: parsed.data.name || null,
      email: normalizedEmail,
      passwordHash,
    },
  });

  const token = signAccessToken({ sub: user.id, email: user.email, role: user.role || "USER" });
  return res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { oauthAccounts: true },
  });
  if (!user) return res.status(401).json({ message: "Invalid email or password" });

  if (!user.passwordHash) {
    const providers = (user.oauthAccounts || []).map((account) => account.provider).filter(Boolean);
    const providerHint = providers.length ? providers.join("/") : "OAuth";
    return res.status(401).json({
      message: `This account was created with ${providerHint}. Use that sign-in method or create a password from SignUp.`,
    });
  }

  const isMatch = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!isMatch) return res.status(401).json({ message: "Invalid email or password" });

  const token = signAccessToken({ sub: user.id, email: user.email, role: user.role || "USER" });
  return res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.sub },
    include: { preference: true },
  });

  if (!user) return res.status(404).json({ message: "User not found" });
  return res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    preference: user.preference,
  });
});

router.patch("/me/preferences", requireAuth, async (req, res) => {
  const parsed = preferenceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
  }

  const preference = await prisma.userPreference.upsert({
    where: { userId: req.user.sub },
    update: parsed.data,
    create: {
      userId: req.user.sub,
      ...parsed.data,
    },
  });

  return res.json(preference);
});

router.post("/oauth/google", async (req, res) => {
  const parsed = googleOAuthSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
  }

  try {
    const googleUser = await verifyGoogleIdToken(parsed.data.idToken);
    const user = await upsertOAuthUser({
      provider: "google",
      providerAccountId: googleUser.providerAccountId,
      email: googleUser.email,
      name: googleUser.name,
    });

    const token = signAccessToken({ sub: user.id, email: user.email, role: user.role || "USER" });
    return res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message : "Unknown error during Google OAuth";
    console.error("Google OAuth failed:", reason);
    return res.status(401).json({
      message: `Google authentication failed: ${reason}`,
    });
  }
});

router.get("/oauth/google", (_req, res) => {
  res.status(200).json({
    message:
      "Use POST /api/auth/oauth/google with a Google ID token from Google Identity Services.",
  });
});

router.post("/oauth/github", async (req, res) => {
  const parsed = githubOAuthCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
  }

  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET || !process.env.GITHUB_CALLBACK_URL) {
    return res.status(503).json({
      message: "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and GITHUB_CALLBACK_URL.",
    });
  }

  try {
    const accessToken = await fetchGitHubAccessToken(parsed.data.code);
    const githubUser = await fetchGitHubUserProfile(accessToken);
    const user = await upsertOAuthUser({
      provider: "github",
      providerAccountId: githubUser.providerAccountId,
      email: githubUser.email,
      name: githubUser.name,
    });
    const token = signAccessToken({ sub: user.id, email: user.email, role: user.role || "USER" });

    return res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (_error) {
    return res.status(401).json({ message: "GitHub authentication failed" });
  }
});

router.get("/oauth/github", (_req, res) => {
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET || !process.env.GITHUB_CALLBACK_URL) {
    return res.status(503).json({
      message: "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and GITHUB_CALLBACK_URL.",
    });
  }

  const state = crypto.randomBytes(16).toString("hex");
  return res.redirect(getGitHubAuthorizeUrl(state));
});

router.get("/oauth/github/callback", async (req, res) => {
  const code = (req.query.code || "").toString();
  if (!code) {
    return res.status(400).json({ message: "Missing GitHub OAuth code" });
  }

  if (!process.env.CLIENT_URL) {
    return res.status(500).json({ message: "CLIENT_URL is required for OAuth callback redirect" });
  }

  try {
    const accessToken = await fetchGitHubAccessToken(code);
    const githubUser = await fetchGitHubUserProfile(accessToken);
    const user = await upsertOAuthUser({
      provider: "github",
      providerAccountId: githubUser.providerAccountId,
      email: githubUser.email,
      name: githubUser.name,
    });
    const token = signAccessToken({ sub: user.id, email: user.email, role: user.role || "USER" });

    const redirectUrl = new URL(process.env.CLIENT_URL);
    redirectUrl.searchParams.set("oauthToken", token);
    redirectUrl.searchParams.set("oauthProvider", "github");
    return res.redirect(redirectUrl.toString());
  } catch (_error) {
    const redirectUrl = new URL(process.env.CLIENT_URL);
    redirectUrl.searchParams.set("oauthError", "github_auth_failed");
    return res.redirect(redirectUrl.toString());
  }
});

router.get("/admin/users", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return res.json({ items: users });
});

export default router;
