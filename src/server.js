import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fetch from 'node-fetch';
import admin from 'firebase-admin';

admin.initializeApp({
 credential: admin.credential.applicationDefault()
});

const db = admin.firestore();
const app = express();

app.use(cors());
app.use(express.json());

// STK PUSH
app.post('/stk', async (req,res)=>{
 const {phone,amount} = req.body;

 if(amount < 10) return res.status(400).json({message:'Min 10'});

 const response = await fetch('https://api.lipana.dev/v1/transactions/push-stk',{
  method:'POST',
  headers:{
   'x-api-key':process.env.LIPANA_API_KEY,
   'Content-Type':'application/json'
  },
  body:JSON.stringify({phone,amount})
 });

 const data = await response.json();

 await db.collection('transactions').doc(data.data.transactionId).set({
  phone,amount,status:'pending'
 });

 res.json({message:'STK sent'});
});

// WEBHOOK
app.post('/webhook', express.raw({type:'application/json'}), async (req,res)=>{
 const signature = req.headers['x-lipana-signature'];
 const payload = req.body;

 const expected = crypto.createHmac('sha256', process.env.LIPANA_WEBHOOK_SECRET)
  .update(payload).digest('hex');

 if(!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))){
  return res.status(401).send('Invalid');
 }

 const data = JSON.parse(payload.toString());

 const txn = data.data;

 if(txn.status === 'success'){
  await db.collection('transactions').doc(txn.transactionId).update({status:'success'});

  const userRef = db.collection('users').doc(txn.phone);
  await userRef.set({credits: admin.firestore.FieldValue.increment(10)}, {merge:true});
 }

 res.sendStatus(200);
});

app.listen(3000);
