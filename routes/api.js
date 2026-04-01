const express = require('express');
const router = express.Router();
const { getDb } = require('../db/setup');

// GET /api/leaderboard - top 5 students
router.get('/leaderboard', (req, res) => {
    const db = getDb();
    const top5 = db.prepare('SELECT id, name, nis, points, avatar_color FROM students ORDER BY points DESC LIMIT 5').all();
    db.close();
    res.json(top5);
});

// GET /api/students - for public grade lookup
router.get('/students', (req, res) => {
    const db = getDb();
    const q = req.query.q || '';
    const students = db.prepare(
        `SELECT id, name, nis, class, points, avatar_color FROM students WHERE name LIKE ? OR nis LIKE ? ORDER BY name`
    ).all(`%${q}%`, `%${q}%`);
    db.close();
    res.json(students);
});

// GET /api/assignments - public
router.get('/assignments', (req, res) => {
    const db = getDb();
    const assignments = db.prepare('SELECT * FROM assignments ORDER BY due_date ASC').all();
    db.close();
    res.json(assignments);
});

// GET /api/grades/:studentId
router.get('/grades/:studentId', (req, res) => {
    const db = getDb();
    const grades = db.prepare(`
    SELECT g.score, g.points_awarded, g.graded_at,
           a.title as assignment_title, a.subject, a.due_date
    FROM grades g
    JOIN assignments a ON a.id = g.assignment_id
    WHERE g.student_id = ?
    ORDER BY g.graded_at DESC
  `).all(req.params.studentId);
    db.close();
    res.json(grades);
});

// GET /api/chat - last 50 messages
router.get('/chat', (req, res) => {
    const db = getDb();
    const messages = db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT 50').all().reverse();
    db.close();
    res.json(messages);
});

// GET /api/forum - all posts
router.get('/forum', (req, res) => {
    const db = getDb();
    const posts = db.prepare(`
    SELECT p.*, COUNT(r.id) as reply_count
    FROM forum_posts p
    LEFT JOIN forum_replies r ON r.post_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `).all();
    db.close();
    res.json(posts);
});

// GET /api/forum/:id
router.get('/forum/:id', (req, res) => {
    const db = getDb();
    const post = db.prepare('SELECT * FROM forum_posts WHERE id = ?').get(req.params.id);
    if (!post) { db.close(); return res.status(404).json({ error: 'Not found' }); }
    const replies = db.prepare('SELECT * FROM forum_replies WHERE post_id = ? ORDER BY created_at ASC').all(req.params.id);
    db.close();
    res.json({ post, replies });
});

// POST /api/forum — create post
router.post('/forum', (req, res) => {
    const { title, body, author, category } = req.body;
    if (!title || !body || !author) return res.json({ success: false, message: 'Missing fields.' });
    const db = getDb();
    const result = db.prepare('INSERT INTO forum_posts (title, body, author, category) VALUES (?, ?, ?, ?)')
        .run(title, body, author, category || 'Umum');
    db.close();
    res.json({ success: true, id: result.lastInsertRowid });
});

// POST /api/forum/:id/reply
router.post('/forum/:id/reply', (req, res) => {
    const { body, author } = req.body;
    if (!body || !author) return res.json({ success: false, message: 'Missing fields.' });
    const db = getDb();
    const result = db.prepare('INSERT INTO forum_replies (post_id, body, author) VALUES (?, ?, ?)')
        .run(req.params.id, body, author);
    db.close();
    res.json({ success: true, id: result.lastInsertRowid });
});

// GET /api/gallery - all photos
router.get('/gallery', (req, res) => {
    const db = getDb();
    const images = db.prepare('SELECT * FROM gallery ORDER BY uploaded_at DESC').all();
    db.close();
    res.json(images);
});

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../public/uploads/capsules');
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${uuidv4()}${ext}`);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_MIME.includes(file.mimetype)) {
            return cb(new Error('Hanya gambar (JPG, PNG, WEBP, GIF) yang diizinkan.'));
        }
        cb(null, true);
    }
});

// GET /api/capsules — daftar kapsul dan isinya (jika sudah buka)
router.get('/capsules', (req, res) => {
    const db = getDb();
    const capsules = db.prepare('SELECT * FROM time_capsules ORDER BY created_at DESC').all();

    const now = new Date();
    const result = capsules.map(c => {
        const shouldAutoOpen = !c.is_open && c.unlock_at && new Date(c.unlock_at) <= now;
        if (shouldAutoOpen) {
            c.is_open = 1;
            c.opened_at = c.unlock_at;
            try {
                db.prepare("UPDATE time_capsules SET is_open = 1, opened_at = ? WHERE id = ?").run(c.unlock_at, c.id);
            } catch (e) {}
        }
        
        if (c.is_open) {
            c.entries = db.prepare('SELECT id, author_name, message, image_filename, created_at FROM capsule_entries WHERE capsule_id = ? ORDER BY created_at ASC').all(c.id);
        } else {
            c.entry_count = db.prepare('SELECT COUNT(*) as cnt FROM capsule_entries WHERE capsule_id = ?').get(c.id).cnt || 0;
        }
        return c;
    });

    db.close();
    res.json(result);
});

// POST /api/capsules/:id/entries — submit pesan & foto oleh anggota
router.post('/capsules/:id/entries', (req, res, next) => {
    upload.single('image')(req, res, (err) => {
        if (err) return res.json({ success: false, message: err.message });
        next();
    });
}, (req, res) => {
    const { author_name, message } = req.body;
    if (!author_name || !author_name.trim()) return res.json({ success: false, message: 'Namamu wajib diisi.' });
    if (!message || !message.trim()) return res.json({ success: false, message: 'Pesan/harapan wajib diisi.' });

    const db = getDb();
    const capsule = db.prepare('SELECT id, is_open FROM time_capsules WHERE id = ?').get(req.params.id);
    if (!capsule) { db.close(); return res.json({ success: false, message: 'Kapsul tidak ditemukan.' }); }
    if (capsule.is_open) { db.close(); return res.json({ success: false, message: 'Kapsul sudah terbuka, tidak bisa menambah isi lagi.' }); }

    const filename = req.file ? req.file.filename : null;
    db.prepare('INSERT INTO capsule_entries (capsule_id, author_name, message, image_filename) VALUES (?, ?, ?, ?)')
      .run(capsule.id, author_name.trim().substring(0, 50), message.trim().substring(0, 5000), filename);
    db.close();
    res.json({ success: true });
});

module.exports = router;
