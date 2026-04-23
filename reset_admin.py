import sqlite3
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')

conn = sqlite3.connect('safeinspect.db')
cursor = conn.cursor()

cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
if cursor.fetchone():
    hashed_password = pwd_context.hash('admin123')
    cursor.execute("SELECT id FROM users WHERE username='admin'")
    if cursor.fetchone():
        cursor.execute("UPDATE users SET password=?, role='admin', status='active' WHERE username='admin'", (hashed_password,))
    else:
        cursor.execute("INSERT INTO users (username, password, role, status) VALUES ('admin', ?, 'admin', 'active')", (hashed_password,))
    conn.commit()
    print('SUCCESS')
conn.close()
