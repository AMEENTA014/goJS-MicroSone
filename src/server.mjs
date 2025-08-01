import express from 'express';
import axios from 'axios';
import process from 'process';
import pg from 'pg';
import 'dotenv/config';


import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  ScanCommand,
  DynamoDB
} from '@aws-sdk/client-dynamodb';

export const app = express();
app.use(express.json());

const TABLE = 'Users';

const usePostgres =  process.env.USE_POSTGRES === 'true';

let pgClient;
let dynamo;
// Initialize DB connections based on environment
async function initDB() {
  if (usePostgres) {
    pgClient = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await pgClient.connect();
    // Create table if doesn't exist
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS users (
        userid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL
      )
    `);
    console.log('Connected to PostgreSQL, ensured users table exists');
  } else {
    dynamo = new DynamoDBClient({
      region: 'us-east-1',
      endpoint: process.env.DYNAMODB_ENDPOINT, // LocalStack endpoint
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
    });

    // Create DynamoDB table if not exists
    const ddb = new DynamoDB({
      region: 'us-east-1',
      endpoint: process.env.DYNAMODB_ENDPOINT
    });
    try {
      await ddb.createTable({
        TableName: TABLE,
        AttributeDefinitions: [{ AttributeName: 'userId', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        BillingMode: 'PAY_PER_REQUEST'
      });
      console.log('Created DynamoDB table:', TABLE);
    } catch (e) {
      if (e.name !== 'ResourceInUseException') {
        console.error('DynamoDB Table create error:', e);
      } else {
        console.log('DynamoDB table already exists:', TABLE);
      }
    }
  }
}

// Create User
app.post('/users', async (req, res) => {
  const { userId, name, email } = req.body;
  if (!userId || !name || !email)
    return res.status(400).json({ error: 'Missing fields' });

  try {
    if (usePostgres) {
      await pgClient.query(
        'INSERT INTO users (userId, name, email) VALUES ($1, $2, $3)',
        [userId, name, email]
      );
    } else {
      await dynamo.send(
        new PutItemCommand({
          TableName: TABLE,
          Item: {
            userId: { S: userId },
            name: { S: name },
            email: { S: email }
          }
        })
      );
    }
    res.status(201).json({ message: 'User created!' });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get User by ID + simulate cross-service order fetch
app.get('/users/:id', async (req, res) => {
  try {
    let user;
    if (usePostgres) {
      const result = await pgClient.query(
        'SELECT * FROM users WHERE userId=$1',
        [req.params.id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
      user = result.rows[0];
    } else {
      const { Item } = await dynamo.send(
        new GetItemCommand({
          TableName: TABLE,
          Key: { userId: { S: req.params.id } }
        })
      );
      if (!Item) return res.status(404).json({ error: 'User not found' });
      user = {
        userId: Item.userId.S,
        name: Item.name.S,
        email: Item.email.S
      };
    }

    // Simulate cross-service call for orders (demo only)
    let orders = [];
    try {
      const r = await axios.get(`http://localhost:4001/orders?user=${req.params.id}`);
      orders = r.data;
    } catch {
      // Ignore in demo
    }

    res.json({ user, orders });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update User
app.put('/users/:id', async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email)
    return res.status(400).json({ error: 'Missing fields' });

  try {
    if (usePostgres) {
      await pgClient.query(
        'UPDATE users SET name=$1, email=$2 WHERE userId=$3',
        [name, email, req.params.id]
      );
    } else {
      await dynamo.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: { userId: { S: req.params.id } },
          UpdateExpression: 'SET #n = :n, email = :e',
          ExpressionAttributeNames: { '#n': 'name' },
          ExpressionAttributeValues: { ':n': { S: name }, ':e': { S: email } }
        })
      );
    }
    res.json({ message: 'User updated!' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete User
app.delete('/users/:id', async (req, res) => {
  try {
    if (usePostgres) {
      await pgClient.query('DELETE FROM users WHERE userId=$1', [req.params.id]);
    } else {
      await dynamo.send(
        new DeleteItemCommand({
          TableName: TABLE,
          Key: { userId: { S: req.params.id } }
        })
      );
    }
    res.json({ message: 'User deleted!' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List all users (admin)
app.get('/users', async (req, res) => {
  try {
    if (usePostgres) {
      const result = await pgClient.query('SELECT * FROM users');
      res.json(result.rows);
    } else {
      const result = await dynamo.send(new ScanCommand({ TableName: TABLE }));
      const users = (result.Items || []).map((i) => ({
        userId: i.userId.S,
        name: i.name.S,
        email: i.email.S
      }));
      res.json(users);
    }
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export app for testing

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  // Only start server if run directly
  const PORT = process.env.PORT || 3000;
  initDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`User microservice running on port ${PORT} (using ${usePostgres ? 'PostgreSQL' : 'DynamoDB'})`);
      });
    })
    .catch((err) => {
      console.error('Error initializing DB:', err);
      process.exit(1);
    });
}
console.log("image stored");