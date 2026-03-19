// src/server.js

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();

// 🔥 REQUIRED FOR RENDER
const PORT = process.env.PORT || 10000;

// -------------------- MIDDLEWARE --------------------
app.use(express.json());

app.use(
  cors({
    origin: "*", // later restrict to your Vercel domain
  })
);

// -------------------- HEALTH CHECK --------------------
app.get("/", (req, res) => {
  res.send("API is running 🚀");
});

// -------------------- STK PUSH --------------------
app.post("/stk", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    const response = await fetch(
      "https://api.lipana.dev/v1/transactions/push-stk",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.LIPANA_API_KEY,
        },
        body: JSON.stringify({
          phone,
          amount,
        }),
      }
    );

    const data = await response.json();

    return res.json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "STK failed" });
  }
});

// -------------------- START SERVER --------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
