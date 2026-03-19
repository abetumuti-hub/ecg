// src/server.js

import express from "express";
import cors from "cors";
import crypto from "crypto";
import fetch from "node-fetch";
import admin from "firebase-admin";

// -------------------- INIT --------------------
const app = express();

// IMPORTANT: raw body for webhook
app.use("/webhook", express.raw({ type: "application/json" }));

// normal json for other routes
app.use(express.json());
app.use(cors());

// -------------------- FIREBASE --------------------
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
  ),
});

const db = admin.firestore();

// -------------------- HEALTH CHECK --------------------
app.get("/", (req, res) => {
  res.send("API is running 🚀");
});

// -------------------- STK PUSH --------------------
app.post("/stk", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    // validation
    if (!phone || !amount) {
      return res.status(400).json({ error: "Missing phone or amount" });
    }

    if (amount < 10) {
      return res.status(400).json({ error: "Minimum amount is 10" });
    }

    // call Lipana API
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

    // save transaction
    await db.collection("transactions").doc(txn.transactionId).set({
      transactionId: txn.transactionId,
      checkoutRequestID: txn.checkoutRequestID,
      phone,
      amount,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    return res.json({
      message: "STK push sent to phone",
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

    const payload = req.body; // raw buffer

    // verify signature
    const expectedSignature = crypto
      .createHmac("sha256", process.env.LIPANA_WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");

    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )
    ) {
      return res.status(401).send("Invalid signature");
    }

    // parse JSON AFTER verification
    const data = JSON.parse(payload.toString());

    const event = data.event;
    const txn = data.data;

    console.log("Webhook received:", event, txn.transactionId);

    // update transaction
    const txnRef = db.collection("transactions").doc(txn.transactionId);

    if (event === "payment.success") {
      await txnRef.update({
        status: "success",
        updatedAt: new Date().toISOString(),
      });

      // add credits to user (using phone as ID for now)
      const userRef = db.collection("users").doc(txn.phone);

      await userRef.set(
        {
          credits: admin.firestore.FieldValue.increment(10),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    if (event === "payment.failed") {
      await txnRef.update({
        status: "failed",
        updatedAt: new Date().toISOString(),
      });
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("WEBHOOK ERROR:", err);
    res.status(500).send("Webhook error");
  }
});

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
