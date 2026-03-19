// src/server.js

import express from "express";
import cors from "cors";
import crypto from "crypto";
import fetch from "node-fetch";
import admin from "firebase-admin";

const app = express();

// -------------------- CORS (FIXED) --------------------
app.use(
  cors({
    origin: [
      "https://ecg-frontend-three.vercel.app",
      "http://localhost:5173"
    ],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

// -------------------- BODY PARSING --------------------
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// -------------------- FIREBASE --------------------
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
  ),
});

const db = admin.firestore();

// -------------------- HEALTH --------------------
app.get("/", (req, res) => {
  res.send("API is running 🚀");
});

// -------------------- STK PUSH --------------------
app.post("/stk", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ error: "Missing phone or amount" });
    }

    if (amount < 10) {
      return res.status(400).json({ error: "Minimum amount is 10" });
    }

    const response = await fetch(
      "https://api.lipana.dev/v1/transactions/push-stk",
      {
        method: "POST",
        headers: {
          "x-api-key": process.env.LIPANA_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone, amount }),
      }
    );

    const data = await response.json();

    if (!data.success) {
      return res.status(400).json(data);
    }

    const txn = data.data;

    await db.collection("transactions").doc(txn.transactionId).set({
      transactionId: txn.transactionId,
      checkoutRequestID: txn.checkoutRequestID,
      phone,
      amount,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    res.json({
      message: "STK push sent",
      transactionId: txn.transactionId,
    });
  } catch (err) {
    console.error("STK ERROR:", err);
    res.status(500).json({ error: "STK failed" });
  }
});

// -------------------- WEBHOOK --------------------
app.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-lipana-signature"];

    if (!signature) {
      return res.status(401).send("Missing signature");
    }

    const payload = req.body;

    const expected = crypto
      .createHmac("sha256", process.env.LIPANA_WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");

    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      )
    ) {
      return res.status(401).send("Invalid signature");
    }

    const data = JSON.parse(payload.toString());
    const txn = data.data;

    const txnRef = db.collection("transactions").doc(txn.transactionId);

    if (txn.status === "success") {
      await txnRef.update({ status: "success" });

      await db
        .collection("users")
        .doc(txn.phone)
        .set(
          {
            credits: admin.firestore.FieldValue.increment(10),
          },
          { merge: true }
        );
    } else {
      await txnRef.update({ status: "failed" });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("WEBHOOK ERROR:", err);
    res.status(500).send("Webhook error");
  }
});

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
