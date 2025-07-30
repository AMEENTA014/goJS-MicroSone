const express = require('express');
const axios = require('axios');
const { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand, DeleteItemCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');

const app = express();
app.use(express.json());

// LocalStack DynamoDB connection
const dynamo = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566', // LocalStack endpoint
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
});
const TABLE = 'Users';

// Create (Register) User
app.post('/users', async (req, res) => {
  const { userId, name, email } = req.body;
  if (!userId || !name || !email) return res.status(400).json({ error: 'Missing fields' });
  try {
    await dynamo.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        userId: { S: userId },
        name: { S: name },
        email: { S: email }
      }
    }));
    res.status(201).json({ message: 'User created!' });
  } catch (err) {
    console.error('DynamoDB Put error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get User by ID, simulate fetch from another service (e.g. orders)
app.get('/users/:id', async (req, res) => {
  try {
    const { Item } = await dynamo.send(new GetItemCommand({
      TableName: TABLE,
      Key: { userId: { S: req.params.id } }
    }));
    if (!Item) return res.status(404).json({ error: 'User not found' });

    // Simulate cross-service call (e.g. fetch user orders from another micro)
    let orders = [];
    try {
      // Replace with your actual order service URL in production
      const r = await axios.get(`http://localhost:4001/orders?user=${req.params.id}`);
      orders = r.data;
    } catch { /* ignore for now, demo only */ }

    res.json({
      user: { userId: Item.userId.S, name: Item.name.S, email: Item.email.S },
      orders
    });
  } catch (err) {
    console.error('DynamoDB Get error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update User
app.put('/users/:id', async (req, res) => {
  const { name, email } = req.body;
  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: TABLE,
      Key: { userId: { S: req.params.id } },
      UpdateExpression: 'SET #n = :n, email = :e',
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: { ':n': { S: name }, ':e': { S: email } }
    }));
    res.json({ message: 'User updated!' });
  } catch (err) {
    console.error('DynamoDB Update error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete User
app.delete('/users/:id', async (req, res) => {
  try {
    await dynamo.send(new DeleteItemCommand({
      TableName: TABLE,
      Key: { userId: { S: req.params.id } }
    }));
    res.json({ message: 'User deleted!' });
  } catch (err) {
    console.error('DynamoDB Delete error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List all users (for admin purposes)
app.get('/users', async (req, res) => {
  try {
    const result = await dynamo.send(new ScanCommand({ TableName: TABLE }));
    const users = (result.Items || []).map(i => ({
      userId: i.userId.S,
      name: i.name.S,
      email: i.email.S
    }));
    res.json(users);
  } catch (err) {
    console.error('DynamoDB Scan error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Server startup ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`User microservice running on port ${PORT}`);

  // On boot, check/create DynamoDB table for the demo (safely ignore error if exists)
  const { DynamoDB } = require('@aws-sdk/client-dynamodb');
  const ddb = new DynamoDB({ region: 'us-east-1', endpoint: 'http://localhost:4566' });
  try {
    await ddb.createTable({
      TableName: TABLE,
      AttributeDefinitions: [{ AttributeName: 'userId', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST'
    });
    console.log('Created DynamoDB table:', TABLE);
  } catch (e) {
    if (e.name !== 'ResourceInUseException') console.error('Table create error', e);
  }
});
