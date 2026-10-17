ALTER TABLE users ADD COLUMN username TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX user_username ON users(username) WHERE username IS NOT NULL;
--> statement-breakpoint
CREATE TABLE login_limits(key TEXT PRIMARY KEY,window INTEGER NOT NULL,attempts INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE setup_lock(id INTEGER PRIMARY KEY CHECK(id=1),created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE backups(id TEXT PRIMARY KEY,object_key TEXT NOT NULL,sha256 TEXT NOT NULL,created_at TEXT NOT NULL,actor_id TEXT REFERENCES users(id));
