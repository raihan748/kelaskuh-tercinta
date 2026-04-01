require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { getDb } = require('../db/setup');
const router = express.Router();

// Ambil dari .env
const SECRET_GATE = process.env.SECRET_GATE || 'KELAS2026';

// ─── Rate Limiter: max 10 percobaan login per 15 menit per IP ─────────────────
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 menit
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Terlalu banyak percobaan login. Coba lagi 15 menit lagi.' },
    skipSuccessfulRequests: true, // hanya hitung yang gagal
});

// ─── Rate Limiter: secret-check ───────────────────────────────────────────────
const secretLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 menit
    max: 15,
    message: { success: false, message: 'Terlalu banyak percobaan. Coba lagi nanti.' },
});

// POST /auth/secret-check — validate secret code gate
router.post('/secret-check', secretLimiter, (req, res) => {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
        return res.json({ success: false, message: 'Kode tidak valid.' });
    }
    if (code.trim() === SECRET_GATE) {
        return res.json({ success: true });
    }
    return res.json({ success: false, message: 'Kode rahasia salah! Coba lagi.' });
});

// POST /auth/login
router.post('/login', loginLimiter, (req, res) => {
    const { username, password, one_time_code } = req.body;

    // Validasi input dasar
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
        return res.json({ success: false, message: 'Username dan password wajib diisi.' });
    }
    if (username.length > 50 || password.length > 128) {
        return res.json({ success: false, message: 'Input tidak valid.' });
    }

    const db = getDb();

    try {
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());

        if (!user) {
            return res.json({ success: false, message: 'Username tidak ditemukan.' });
        }

        // Owner: login langsung dengan password
        if (user.role === 'owner') {
            const valid = bcrypt.compareSync(password, user.password_hash);
            if (!valid) return res.json({ success: false, message: 'Password salah.' });

            req.session.user = {
                id: user.id,
                username: user.username,
                role: user.role,
                is_first_login: user.is_first_login,
            };
            return res.json({ success: true, redirect: '/admin/dashboard' });
        }

        // Admin biasa — harus punya one-time code untuk login pertama
        if (user.is_first_login) {
            if (!one_time_code || typeof one_time_code !== 'string') {
                return res.json({ success: false, message: 'Masukkan kode akses yang diberikan Owner.' });
            }

            const codeRow = db.prepare(`
                SELECT * FROM one_time_codes
                WHERE code = ? AND assigned_to = ? AND used = 0
            `).get(one_time_code.trim(), user.username);

            if (!codeRow) {
                return res.json({ success: false, message: 'Kode akses tidak valid atau sudah digunakan.' });
            }

            // Tandai kode sudah dipakai
            db.prepare('UPDATE one_time_codes SET used = 1 WHERE id = ?').run(codeRow.id);

            req.session.user = {
                id: user.id,
                username: user.username,
                role: user.role,
                is_first_login: 1,
            };
            return res.json({ success: true, redirect: '/set-password.html' });
        }

        // Admin biasa, bukan login pertama — cek password
        const valid = bcrypt.compareSync(password, user.password_hash);
        if (!valid) return res.json({ success: false, message: 'Password salah.' });

        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role,
            is_first_login: 0,
        };
        return res.json({ success: true, redirect: '/admin/dashboard' });

    } finally {
        db.close();
    }
});

// POST /auth/set-password — ganti password wajib pada login pertama
router.post('/set-password', (req, res) => {
    if (!req.session || !req.session.user) {
        return res.json({ success: false, message: 'Sesi tidak valid.' });
    }
    const { password, confirm_password } = req.body;

    if (!password || typeof password !== 'string' || password.length < 8) {
        return res.json({ success: false, message: 'Password minimal 8 karakter.' });
    }
    if (password.length > 128) {
        return res.json({ success: false, message: 'Password terlalu panjang.' });
    }
    if (password !== confirm_password) {
        return res.json({ success: false, message: 'Konfirmasi password tidak cocok.' });
    }

    const db = getDb();
    try {
        const hash = bcrypt.hashSync(password, 10);
        db.prepare(`
            UPDATE users SET password_hash = ?, is_first_login = 0 WHERE id = ?
        `).run(hash, req.session.user.id);

        req.session.user.is_first_login = 0;
        return res.json({ success: true, redirect: '/admin/dashboard' });
    } finally {
        db.close();
    }
});

// GET /auth/logout
router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login.html');
    });
});

// GET /auth/me — info sesi saat ini (dipakai frontend)
router.get('/me', (req, res) => {
    if (req.session && req.session.user) {
        // Hanya kirim data yang diperlukan frontend
        const { id, username, role, is_first_login } = req.session.user;
        return res.json({ user: { id, username, role, is_first_login } });
    }
    return res.json({ user: null });
});

module.exports = router;
