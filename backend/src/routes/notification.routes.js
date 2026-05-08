import { Router } from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

const markReadSchema = z.object({
  notificationIds: z.array(z.string()).default([]),
});

const broadcastSchema = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
  type: z.string().default("SYSTEM"),
});

router.get("/", requireAuth, async (req, res) => {
  const items = await prisma.notification.findMany({
    where: { userId: req.user.sub },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return res.json({ items });
});

router.patch("/read", requireAuth, async (req, res) => {
  const parsed = markReadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
  }

  if (parsed.data.notificationIds.length === 0) {
    await prisma.notification.updateMany({
      where: { userId: req.user.sub, isRead: false },
      data: { isRead: true },
    });
  } else {
    await prisma.notification.updateMany({
      where: {
        userId: req.user.sub,
        id: { in: parsed.data.notificationIds },
      },
      data: { isRead: true },
    });
  }

  return res.json({ success: true });
});

router.post("/admin/broadcast", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const parsed = broadcastSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
  }

  const users = await prisma.user.findMany({ select: { id: true } });
  if (users.length === 0) return res.json({ success: true, delivered: 0 });

  await prisma.notification.createMany({
    data: users.map((user) => ({
      userId: user.id,
      type: parsed.data.type,
      title: parsed.data.title,
      message: parsed.data.message,
    })),
  });

  return res.json({ success: true, delivered: users.length });
});

export default router;
