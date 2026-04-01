const { getDb } = require('../db/setup');

// Deteksi apakah request berasal dari API (bukan browser navigasi biasa)
function isApiRequest(req) {
    return req.xhr ||
        (req.headers['accept'] && req.headers['accept'].includes('application/json')) ||
        req.path.startsWith('/api') ||
        req.path.startsWith('/admin/api');
}

function requireAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        if (isApiRequest(req)) {
            return res.status(401).json({ success: false, message: 'Sesi tidak valid. Silakan login kembali.' });
        }
        return res.redirect('/login.html?error=not_logged_in');
    }
    next();
}

function requireOwner(req, res, next) {
    if (!req.session || !req.session.user) {
        if (isApiRequest(req)) {
            return res.status(401).json({ success: false, message: 'Sesi tidak valid. Silakan login kembali.' });
        }
        return res.redirect('/login.html?error=not_logged_in');
    }
    if (req.session.user.role !== 'owner') {
        if (isApiRequest(req)) {
            return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya Owner yang diizinkan.' });
        }
        return res.redirect('/admin/dashboard?error=forbidden');
    }
    next();
}

function requireNotFirstLogin(req, res, next) {
    if (!req.session || !req.session.user) {
        if (isApiRequest(req)) {
            return res.status(401).json({ success: false, message: 'Sesi tidak valid. Silakan login kembali.' });
        }
        return res.redirect('/login.html?error=not_logged_in');
    }
    if (req.session.user.is_first_login) {
        if (isApiRequest(req)) {
            return res.status(403).json({ success: false, message: 'Wajib ganti password terlebih dahulu.' });
        }
        return res.redirect('/set-password.html');
    }
    next();
}

function logAction(adminUsername, action, target, detail = '') {
    try {
        const db = getDb();
        db.prepare(`
            INSERT INTO admin_logs (admin_username, action, target, detail)
            VALUES (?, ?, ?, ?)
        `).run(adminUsername, action, target, detail);
        db.close();
    } catch (e) {
        console.error('Log action error:', e.message);
    }
}

module.exports = { requireAuth, requireOwner, requireNotFirstLogin, logAction };
