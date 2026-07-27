const session = require("express-session");
const db = require("./db");

class SqliteSessionStore extends session.Store {
  get(sid, cb) {
    try {
      const sess = db.getSession(sid);
      cb(null, sess ? JSON.parse(sess) : null);
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 86400000;
      db.setSession(sid, JSON.stringify(sess), Date.now() + maxAge);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      db.destroySession(sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

module.exports = SqliteSessionStore;
