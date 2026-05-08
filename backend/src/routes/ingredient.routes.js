import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import {
  recognizeIngredientsFromFile,
  recognizeIngredientsFromImage,
  recognizeIngredientsWithVision,
} from "../services/ingredient.service.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const recognizeSchema = z.object({
  imageUrl: z.string().url(),
});

router.post("/recognize", async (req, res) => {
  const parsed = recognizeSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid request body",
      errors: parsed.error.flatten(),
    });
  }

  const result = await recognizeIngredientsFromImage(parsed.data.imageUrl);
  return res.json(result);
});

router.post("/recognize-upload", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Image file is required" });
  }

  const result = await recognizeIngredientsWithVision(
    req.file.buffer,
    req.file.mimetype,
    req.file.originalname
  );
  return res.json({
    fileName: req.file.originalname,
    ...result,
  });
});

export default router;
