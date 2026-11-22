import { Router } from "express";
import { notFoundHandler } from "../middleware/not-found.js";

/** Create the minimal, non-versioned Phase 1 health route. */
export function createHealthRouter() {
  const router = Router();
  router.head("/health", notFoundHandler);
  router.options("/health", notFoundHandler);
  router.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
  return router;
}
