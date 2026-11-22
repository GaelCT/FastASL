import { Router } from "express";

/** Create the minimal, non-versioned Phase 1 health route. */
export function createHealthRouter() {
  const router = Router();
  const notFound = (_req, res) => {
    res.status(404).json({ error: "Not found" });
  };
  router.head("/health", notFound);
  router.options("/health", notFound);
  router.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
  return router;
}
