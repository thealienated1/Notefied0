require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { body, validationResult } = require('express-validator');

const app = express();
app.use(express.json());
app.use(cors({ 
  origin: process.env.CORS_ORIGIN === '*' ? true : process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
})); // Allow frontend origin

// Database connection pool
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
  res.status(200).json({ status: 'healthy', service: 'notes-service' });
});

// Middleware to authenticate JWT token
const authMiddleware = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (error) {
    console.error('Token verification error:', error.message);
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Create a new note
app.post('/notes', authMiddleware, [
  body('title').isLength({ min: 1 }).trim(),
  body('content').isLength({ min: 1 }).trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { title, content } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO notes (user_id, title, content) VALUES ($1, $2, $3) RETURNING *',
      [req.userId, title, content]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create note error:', error.message);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// Get all active notes for the user
app.get('/notes', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM notes WHERE user_id = $1 ORDER BY updated_at DESC',
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Fetch notes error:', error.message);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// Get all trashed notes for the user
app.get('/trashed-notes', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM trashed_notes WHERE user_id = $1 ORDER BY trashed_at DESC',
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Fetch trashed notes error:', error.message);
    res.status(500).json({ error: 'Failed to fetch trashed notes' });
  }
});

// Move note to trash, preserving original updated_at
app.delete('/notes/:id', authMiddleware, async (req, res) => {
  const noteId = parseInt(req.params.id, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch the note to move
    const noteResult = await client.query(
      'SELECT * FROM notes WHERE id = $1 AND user_id = $2',
      [noteId, req.userId]
    );
    if (noteResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Note not found or not owned by user' });
    }
    const note = noteResult.rows[0];

    // Insert into trashed_notes, including original_updated_at
    await client.query(
      'INSERT INTO trashed_notes (note_id, user_id, title, content, trashed_at, original_updated_at) VALUES ($1, $2, $3, $4, NOW(), $5)',
      [note.id, note.user_id, note.title, note.content, note.updated_at]
    );

    // Delete from notes
    await client.query(
      'DELETE FROM notes WHERE id = $1 AND user_id = $2',
      [noteId, req.userId]
    );

    await client.query('COMMIT');
    res.status(204).send();
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Move to trash error:', error.message);
    res.status(500).json({ error: 'Failed to move note to trash', details: error.message });
  } finally {
    client.release();
  }
});

// Restore note from trash to notes, using original_updated_at
app.post('/trashed-notes/:id/restore', authMiddleware, async (req, res) => {
  const trashedNoteId = parseInt(req.params.id, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch the trashed note
    const trashedResult = await client.query(
      'SELECT * FROM trashed_notes WHERE id = $1 AND user_id = $2',
      [trashedNoteId, req.userId]
    );
    if (trashedResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Trashed note not found or not owned by user' });
    }
    const trashedNote = trashedResult.rows[0];

    // Insert back into notes, preserving original_updated_at (falls back to NOW() if null)
    const restoredResult = await client.query(
      'INSERT INTO notes (user_id, title, content, updated_at) VALUES ($1, $2, $3, COALESCE($4, NOW())) RETURNING *',
      [trashedNote.user_id, trashedNote.title, trashedNote.content, trashedNote.original_updated_at]
    );

    // Delete from trashed_notes
    await client.query(
      'DELETE FROM trashed_notes WHERE id = $1 AND user_id = $2',
      [trashedNoteId, req.userId]
    );

    await client.query('COMMIT');
    res.status(200).json(restoredResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Restore note error:', error.message);
    res.status(500).json({ error: 'Failed to restore note', details: error.message });
  } finally {
    client.release();
  }
});

// Permanently delete note from trash
app.delete('/trashed-notes/:id', authMiddleware, async (req, res) => {
  const trashedNoteId = parseInt(req.params.id, 10);
  try {
    const result = await pool.query(
      'DELETE FROM trashed_notes WHERE id = $1 AND user_id = $2 RETURNING *',
      [trashedNoteId, req.userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Trashed note not found or not owned by user' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('Permanent delete error:', error.message);
    res.status(500).json({ error: 'Failed to permanently delete note' });
  }
});

// Update an existing note
app.put('/notes/:id', authMiddleware, [
  body('title').isLength({ min: 1 }).trim(),
  body('content').isLength({ min: 1 }).trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const noteId = parseInt(req.params.id, 10);
  const { title, content } = req.body;
  try {
    const result = await pool.query(
      'UPDATE notes SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4 RETURNING *',
      [title, content, noteId, req.userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Note not found or not owned by user' });
    }
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Update note error:', error.message);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Server configuration
const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || '0.0.0.0';

// For development, provide both HTTP and HTTPS
app.listen(PORT, HOST, () => {
  console.log(`Notes Service running on ${HOST}:${PORT} (HTTP)`);
});

