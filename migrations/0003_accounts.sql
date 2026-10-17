ALTER TABLE users ADD COLUMN username TEXT;
CREATE UNIQUE INDEX user_username ON users(username) WHERE username IS NOT NULL;
CREATE TABLE login_limits(key TEXT PRIMARY KEY,window INTEGER NOT NULL,attempts INTEGER NOT NULL);
CREATE TABLE setup_lock(id INTEGER PRIMARY KEY CHECK(id=1),created_at TEXT NOT NULL);
CREATE TABLE backups(id TEXT PRIMARY KEY,object_key TEXT NOT NULL,sha256 TEXT NOT NULL,created_at TEXT NOT NULL,actor_id TEXT REFERENCES users(id));
