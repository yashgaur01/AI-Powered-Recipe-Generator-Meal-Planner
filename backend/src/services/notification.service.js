import prisma from "../lib/prisma.js";

export async function createUserNotification({ userId, type, title, message, metadata = null }) {
  if (!userId) return null;

  try {
    return await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        metadata,
      },
    });
  } catch (_error) {
    return null;
  }
}

