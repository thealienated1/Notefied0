require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');
const { body, validationResult } = require('express-validator');

const app = express();
app.use(express.json());
app.use(cors({ 
  origin: process.env.CORS_ORIGIN === '*' ? true : process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'notes_app_db',
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
});

pool.connect((err) => {
  if (err) console.error('Database connection failed:', err.stack);
  else console.log('Connected to database successfully');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', service: 'user-service' });
});

// Registration Endpoint
app.post('/register', [
  body('username').isLength({ min: 3 }).trim().escape(),
  body('password').isLength({ min: 6 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { username, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id',
      [username, hashedPassword]
    );
    res.status(201).json({ id: result.rows[0].id, message: 'User registered successfully' });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(400).json({ error: 'Username already exists or invalid input' });
  }
});

// Login Endpoint
app.post('/login', [
  body('username').isLength({ min: 3 }).trim().escape(),
  body('password').isLength({ min: 6 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (user && await bcrypt.compare(password, user.password)) {
      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
      res.status(200).json({ token });
    } else {
      res.status(401).json({ error: 'Invalid username or password' });
    }
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Server configuration
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// For development, provide both HTTP and HTTPS
app.listen(PORT, HOST, () => {
  console.log(`User Service running on ${HOST}:${PORT} (HTTP)`);
});

