const express = require('express');
const router = express.Router();
const { getDb } = require('../db/setup');
const { requireAuth, requireNotFirstLogin, requireOwner, logAction } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ─── Multer: validasi file upload gallery ─────────────────────────────────────
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../public/uploads/gallery');
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
    limits: { fileSize: 5 * 1024 * 1024 }, // max 5MB
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_MIME.includes(file.mimetype)) {
            return cb(new Error('Hanya file gambar (JPG, PNG, WEBP, GIF) yang diizinkan.'));
        }
        cb(null, true);
    },
});

// Semua admin route butuh auth + bukan first login
router.use(requireAuth, requireNotFirstLogin);

// ─── Helper: sanitasi string input ────────────────────────────────────────────
function sanitize(str, maxLen = 255) {
    if (!str || typeof str !== 'string') return '';
    return str.trim().substring(0, maxLen);
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

router.get('/dashboard-stats', (req, res) => {
    const db = getDb();
    const studentCount = db.prepare('SELECT COUNT(*) as cnt FROM students').get().cnt;
    const assignmentCount = db.prepare('SELECT COUNT(*) as cnt FROM assignments').get().cnt;
    const gradeCount = db.prepare('SELECT COUNT(*) as cnt FROM grades').get().cnt;
    const recentLogs = db.prepare('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 5').all();
    db.close();
    res.json({ studentCount, assignmentCount, gradeCount, recentLogs, user: req.session.user });
});

// ─── STUDENTS ─────────────────────────────────────────────────────────────────

router.get('/students', (req, res) => {
    const db = getDb();
    const students = db.prepare('SELECT * FROM students ORDER BY points DESC').all();
    db.close();
    res.json(students);
});

router.post('/students', (req, res) => {
    const name = sanitize(req.body.name, 100);
    const nis = sanitize(req.body.nis, 20);
    const cls = sanitize(req.body.class, 50) || '8B Ahmad bin Hambal';
    const points = parseInt(req.body.points) || 0;

    if (!name) return res.json({ success: false, message: 'Nama siswa wajib diisi.' });
    if (nis && !/^\d+$/.test(nis)) return res.json({ success: false, message: 'NIS harus berupa angka.' });
    if (points < 0 || points > 99999) return res.json({ success: false, message: 'Nilai poin tidak valid.' });

    const db = getDb();
    try {
        const result = db.prepare(
            `INSERT INTO students (name, nis, class, points) VALUES (?, ?, ?, ?)`
        ).run(name, nis, cls, points);
        logAction(req.session.user.username, 'CREATE', `Student: ${name}`, `NIS: ${nis}`);
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (e) {
        res.json({ success: false, message: 'Gagal menambah siswa. NIS mungkin sudah terdaftar.' });
    } finally { db.close(); }
});

router.put('/students/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const name = sanitize(req.body.name, 100);
    const nis = sanitize(req.body.nis, 20);
    const cls = sanitize(req.body.class, 50);
    const points = parseInt(req.body.points) || 0;

    if (!id || isNaN(id)) return res.json({ success: false, message: 'ID tidak valid.' });
    if (!name) return res.json({ success: false, message: 'Nama siswa wajib diisi.' });
    if (nis && !/^\d+$/.test(nis)) return res.json({ success: false, message: 'NIS harus berupa angka.' });
    if (points < 0 || points > 99999) return res.json({ success: false, message: 'Nilai poin tidak valid.' });

    const db = getDb();
    try {
        db.prepare(`UPDATE students SET name=?, nis=?, class=?, points=? WHERE id=?`)
            .run(name, nis, cls, points, id);
        logAction(req.session.user.username, 'EDIT', `Student ID: ${id}`, `${name}, pts: ${points}`);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: 'Gagal mengupdate siswa.' });
    } finally { db.close(); }
});

router.delete('/students/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.json({ success: false, message: 'ID tidak valid.' });
    const db = getDb();
    const student = db.prepare('SELECT name FROM students WHERE id = ?').get(id);
    db.prepare('DELETE FROM students WHERE id = ?').run(id);
    logAction(req.session.user.username, 'DELETE', `Student: ${student ? student.name : id}`);
    db.close();
    res.json({ success: true });
});

// ─── ASSIGNMENTS ──────────────────────────────────────────────────────────────

router.get('/assignments', (req, res) => {
    const db = getDb();
    const assignments = db.prepare('SELECT * FROM assignments ORDER BY created_at DESC').all();
    db.close();
    res.json(assignments);
});

router.post('/assignments', (req, res) => {
    const title = sanitize(req.body.title, 150);
    const subject = sanitize(req.body.subject, 100);
    const description = sanitize(req.body.description, 1000);
    const due_date = sanitize(req.body.due_date, 30);

    if (!title) return res.json({ success: false, message: 'Judul tugas wajib diisi.' });
    if (!subject) return res.json({ success: false, message: 'Mata pelajaran wajib diisi.' });

    const db = getDb();
    try {
        const result = db.prepare(
            `INSERT INTO assignments (title, subject, description, due_date, created_by) VALUES (?, ?, ?, ?, ?)`
        ).run(title, subject, description, due_date, req.session.user.username);
        logAction(req.session.user.username, 'CREATE', `Assignment: ${title}`);
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (e) {
        res.json({ success: false, message: 'Gagal menambah tugas.' });
    } finally { db.close(); }
});

router.put('/assignments/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const title = sanitize(req.body.title, 150);
    const subject = sanitize(req.body.subject, 100);
    const description = sanitize(req.body.description, 1000);
    const due_date = sanitize(req.body.due_date, 30);

    if (!id || isNaN(id)) return res.json({ success: false, message: 'ID tidak valid.' });
    if (!title) return res.json({ success: false, message: 'Judul tugas wajib diisi.' });

    const db = getDb();
    try {
        db.prepare(`UPDATE assignments SET title=?, subject=?, description=?, due_date=? WHERE id=?`)
            .run(title, subject, description, due_date, id);
        logAction(req.session.user.username, 'EDIT', `Assignment ID: ${id}`, title);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: 'Gagal mengupdate tugas.' });
    } finally { db.close(); }
});

router.delete('/assignments/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.json({ success: false, message: 'ID tidak valid.' });
    const db = getDb();
    const a = db.prepare('SELECT title FROM assignments WHERE id = ?').get(id);
    db.prepare('DELETE FROM assignments WHERE id = ?').run(id);
    logAction(req.session.user.username, 'DELETE', `Assignment: ${a ? a.title : id}`);
    db.close();
    res.json({ success: true });
});

// ─── GRADES ───────────────────────────────────────────────────────────────────

function calcPoints(score) {
    if (score >= 90) return 50;
    if (score >= 80) return 35;
    if (score >= 70) return 20;
    if (score >= 60) return 10;
    return 5;
}

router.get('/grades', (req, res) => {
    const db = getDb();
    const grades = db.prepare(`
        SELECT g.*, s.name as student_name, s.nis, a.title as assignment_title, a.subject
        FROM grades g
        JOIN students s ON s.id = g.student_id
        JOIN assignments a ON a.id = g.assignment_id
        ORDER BY g.graded_at DESC
    `).all();
    db.close();
    res.json(grades);
});

router.post('/grades', (req, res) => {
    const student_id = parseInt(req.body.student_id);
    const assignment_id = parseInt(req.body.assignment_id);
    const score = parseFloat(req.body.score);

    if (!student_id || isNaN(student_id)) return res.json({ success: false, message: 'ID siswa tidak valid.' });
    if (!assignment_id || isNaN(assignment_id)) return res.json({ success: false, message: 'ID tugas tidak valid.' });
    if (isNaN(score) || score < 0 || score > 100) return res.json({ success: false, message: 'Nilai harus antara 0 - 100.' });

    const pts = calcPoints(score);
    const db = getDb();
    try {
        db.prepare(`
            INSERT INTO grades (student_id, assignment_id, score, points_awarded, graded_by)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(student_id, assignment_id) DO UPDATE SET
                score=excluded.score,
                points_awarded=excluded.points_awarded,
                graded_by=excluded.graded_by,
                graded_at=datetime('now','localtime')
        `).run(student_id, assignment_id, score, pts, req.session.user.username);

        db.prepare(`
            UPDATE students SET points = (
                SELECT COALESCE(SUM(points_awarded), 0) FROM grades WHERE student_id = ?
            ) WHERE id = ?
        `).run(student_id, student_id);

        const student = db.prepare('SELECT name FROM students WHERE id=?').get(student_id);
        const assign = db.prepare('SELECT title FROM assignments WHERE id=?').get(assignment_id);
        logAction(req.session.user.username, 'GRADE', `${student ? student.name : student_id}`, `${assign ? assign.title : assignment_id}: ${score} -> ${pts} pts`);
        res.json({ success: true, points_awarded: pts });
    } catch (e) {
        res.json({ success: false, message: 'Gagal menyimpan nilai.' });
    } finally { db.close(); }
});

router.delete('/grades/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.json({ success: false, message: 'ID tidak valid.' });
    const db = getDb();
    const g = db.prepare('SELECT student_id FROM grades WHERE id = ?').get(id);
    db.prepare('DELETE FROM grades WHERE id = ?').run(id);
    if (g) {
        db.prepare(`UPDATE students SET points = (SELECT COALESCE(SUM(points_awarded),0) FROM grades WHERE student_id=?) WHERE id=?`)
            .run(g.student_id, g.student_id);
    }
    logAction(req.session.user.username, 'DELETE', `Grade ID: ${id}`);
    db.close();
    res.json({ success: true });
});

// ─── FORUM MODERATION ─────────────────────────────────────────────────────────

router.delete('/forum/posts/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.json({ success: false, message: 'ID tidak valid.' });
    const db = getDb();
    const p = db.prepare('SELECT title FROM forum_posts WHERE id=?').get(id);
    db.prepare('DELETE FROM forum_posts WHERE id = ?').run(id);
    logAction(req.session.user.username, 'DELETE', `Forum Post: ${p ? p.title : id}`);
    db.close();
    res.json({ success: true });
});

router.delete('/forum/replies/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.json({ success: false, message: 'ID tidak valid.' });
    const db = getDb();
    db.prepare('DELETE FROM forum_replies WHERE id = ?').run(id);
    logAction(req.session.user.username, 'DELETE', `Forum Reply ID: ${id}`);
    db.close();
    res.json({ success: true });
});

// ─── GALLERY (OWNER ONLY) ─────────────────────────────────────────────────────

router.get('/gallery', requireOwner, (req, res) => {
    const db = getDb();
    const images = db.prepare('SELECT * FROM gallery ORDER BY uploaded_at DESC').all();
    db.close();
    res.json(images);
});

router.post('/gallery', requireOwner, (req, res, next) => {
    upload.single('image')(req, res, (err) => {
        if (err) return res.json({ success: false, message: err.message });
        next();
    });
}, (req, res) => {
    if (!req.file) return res.json({ success: false, message: 'Tidak ada file yang diupload.' });
    const caption = sanitize(req.body.caption, 300);
    const db = getDb();
    const result = db.prepare(
        `INSERT INTO gallery (filename, caption, uploaded_by) VALUES (?, ?, ?)`
    ).run(req.file.filename, caption, req.session.user.username);
    logAction(req.session.user.username, 'UPLOAD', `Gallery: ${req.file.filename}`, caption);
    db.close();
    res.json({ success: true, id: result.lastInsertRowid, filename: req.file.filename });
});

router.delete('/gallery/:id', requireOwner, (req, res) => {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.json({ success: false, message: 'ID tidak valid.' });
    const db = getDb();
    const img = db.prepare('SELECT filename FROM gallery WHERE id = ?').get(id);
    if (img) {
        const filePath = path.join(__dirname, '../public/uploads/gallery', img.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        db.prepare('DELETE FROM gallery WHERE id = ?').run(id);
        logAction(req.session.user.username, 'DELETE', `Gallery: ${img.filename}`);
    }
    db.close();
    res.json({ success: true });
});

// ─── ADMIN LOGS (OWNER ONLY) ─────────────────────────────────────────────────

router.get('/logs', requireOwner, (req, res) => {
    const db = getDb();
    const logs = db.prepare('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 200').all();
    db.close();
    res.json(logs);
});

// ─── ONE-TIME CODE ACCESS MANAGER (OWNER ONLY) ───────────────────────────────

router.get('/access/codes', requireOwner, (req, res) => {
    const db = getDb();
    const codes = db.prepare(`
        SELECT c.*, u.is_first_login FROM one_time_codes c
        LEFT JOIN users u ON u.username = c.assigned_to
        ORDER BY c.created_at DESC
    `).all();
    const admins = db.prepare(`SELECT username, is_first_login FROM users WHERE role='admin'`).all();
    db.close();
    res.json({ codes, admins });
});

router.post('/access/generate', requireOwner, (req, res) => {
    const assigned_to = sanitize(req.body.assigned_to, 50);
    if (!assigned_to) return res.json({ success: false, message: 'assigned_to wajib diisi.' });

    const db = getDb();
    const admin = db.prepare('SELECT id FROM users WHERE username=? AND role=?').get(assigned_to, 'admin');
    if (!admin) { db.close(); return res.json({ success: false, message: 'Admin tidak ditemukan.' }); }

    const code = `AF-${uuidv4().substring(0, 8).toUpperCase()}`;
    db.prepare('INSERT INTO one_time_codes (code, assigned_to) VALUES (?, ?)').run(code, assigned_to);
    logAction(req.session.user.username, 'GENERATE_CODE', `For: ${assigned_to}`, code);
    db.close();
    res.json({ success: true, code });
});

// ─── USERS API (owner only) ───────────────────────────────────────────────────

router.get('/users', requireOwner, (req, res) => {
    const db = getDb();
    const users = db.prepare('SELECT id, username, role, is_first_login, created_at FROM users ORDER BY role DESC, username').all();
    db.close();
    res.json(users);
});

// ─── KAPSUL WAKTU (OWNER ONLY) ───────────────────────────────────────────────

router.get('/capsules', requireOwner, (req, res) => {
    const db = getDb();
    const capsules = db.prepare('SELECT * FROM time_capsules ORDER BY created_at DESC').all();
    db.close();
    res.json(capsules);
});

router.post('/capsules', requireOwner, (req, res) => {
    const title = sanitize(req.body.title, 150);
    const message = sanitize(req.body.message, 5000);
    const unlock_at = req.body.unlock_at ? sanitize(req.body.unlock_at, 30) : null;

    if (!title) return res.json({ success: false, message: 'Judul kapsul wajib diisi.' });
    if (!message) return res.json({ success: false, message: 'Pesan kapsul wajib diisi.' });

    const db = getDb();
    try {
        const result = db.prepare(
            `INSERT INTO time_capsules (title, message, unlock_at, created_by) VALUES (?, ?, ?, ?)`
        ).run(title, message, unlock_at, req.session.user.username);
        logAction(req.session.user.username, 'CREATE', `Kapsul Waktu: ${title}`, unlock_at ? `Dibuka: ${unlock_at}` : 'Manual trigger');
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (e) {
        res.json({ success: false, message: 'Gagal membuat kapsul waktu.' });
    } finally { db.close(); }
});

// Trigger buka kapsul secara manual oleh owner
router.post('/capsules/:id/open', requireOwner, (req, res) => {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.json({ success: false, message: 'ID tidak valid.' });

    const db = getDb();
    const capsule = db.prepare('SELECT * FROM time_capsules WHERE id = ?').get(id);
    if (!capsule) { db.close(); return res.json({ success: false, message: 'Kapsul tidak ditemukan.' }); }
    if (capsule.is_open) { db.close(); return res.json({ success: false, message: 'Kapsul sudah terbuka.' }); }

    db.prepare(`UPDATE time_capsules SET is_open = 1, opened_at = datetime('now','localtime') WHERE id = ?`).run(id);
    logAction(req.session.user.username, 'OPEN_CAPSULE', `Kapsul: ${capsule.title}`);
    db.close();
    res.json({ success: true });
});

router.delete('/capsules/:id', requireOwner, (req, res) => {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.json({ success: false, message: 'ID tidak valid.' });
    const db = getDb();
    const c = db.prepare('SELECT title FROM time_capsules WHERE id = ?').get(id);
    db.prepare('DELETE FROM time_capsules WHERE id = ?').run(id);
    logAction(req.session.user.username, 'DELETE', `Kapsul: ${c ? c.title : id}`);
    db.close();
    res.json({ success: true });
});

module.exports = router;
