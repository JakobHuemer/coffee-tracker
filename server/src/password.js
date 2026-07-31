// Shared password bounds: any non-empty string up to 72 characters. There is no
// complexity/minimum rule by design (see the register handler in routes/auth.js);
// the upper bound only exists because bcrypt ignores everything past 72 bytes.
// Used by both the self-service change (routes/auth.js) and the admin reset
// (routes/admin.js) so the two can never drift.
function isValidPassword(password) {
  return typeof password === 'string' && password.length > 0 && password.length <= 72;
}

module.exports = { isValidPassword };
