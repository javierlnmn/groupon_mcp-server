import express from "express";
import { DbClient } from "@/db/client";

export function createServer() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/deals", (_req, res) => {
    const db = DbClient.getInstance().connection;
    const deals = db.prepare("SELECT * FROM deals ORDER BY id").all();
    res.json(deals);
  });

  return app;
}
