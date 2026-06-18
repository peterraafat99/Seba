import sqlite3

db_path = "learning_platform.db"

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

def add_column(table, column, definition):
    try:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        print(f"Added {column} to {table}")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e).lower():
            print(f"Column {column} already exists in {table}")
        else:
            print(f"Error adding {column} to {table}: {e}")

add_column("users", "school_id", "INTEGER")
add_column("users", "persona_profile", "TEXT")
add_column("users", "nfc_tag_id", "VARCHAR")
add_column("teacher_notes", "category", "VARCHAR DEFAULT 'TOPIC_SPECIFIC'")
add_column("teacher_notes", "embedding", "TEXT")
add_column("teacher_notes", "topic_tags", "VARCHAR")
add_column("cv_sessions", "teacher_id", "INTEGER")
add_column("cv_sessions", "subject_name", "VARCHAR")

conn.commit()
conn.close()

from database import engine
import models

# Create any brand new tables (School, Grade, PhysicalClassroom, etc.)
models.Base.metadata.create_all(bind=engine)
print("Created any missing new tables.")
