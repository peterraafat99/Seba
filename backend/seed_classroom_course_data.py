import sqlite3
import random
from datetime import datetime, timedelta
import sys
import os

# Adjust path to import auth helpers if needed
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from auth import get_password_hash
from migrate_courses import migrate


def seed_database():
    db_dir = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(db_dir, "learning_platform.db")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    
    # 1. Fetch pre-existing face profiles so we don't lose the pre-computed embeddings
    print("Backing up pre-existing face profiles...")
    face_profiles_backup = []
    try:
        cur.execute("SELECT id, embedding, photo_url, enrolled_by, created_at, updated_at FROM student_face_profiles ORDER BY id")
        face_profiles_backup = cur.fetchall()
        print(f"Backed up {len(face_profiles_backup)} face profiles successfully.")
    except Exception as e:
        print(f"No face profiles to back up or error occurred: {e}")

    print("Clearing relevant tables to perform a clean seed...")
    tables_to_clear = [
        "schools", "grades", "physical_classrooms", "classroom_students",
        "classroom_teachers", "courses", "lessons", "enrollments",
        "activities", "student_sentiments", "teacher_notes", "class_schedule",
        "classwork", "classwork_submissions", "student_face_profiles"
    ]
    for table in tables_to_clear:
        try:
            cur.execute(f"DELETE FROM {table}")
        except Exception as e:
            print(f"Error clearing {table}: {e}")
            
    # Also delete users except our main super admin or let's re-create users cleanly
    try:
        cur.execute("DELETE FROM users")
    except Exception as e:
        print(f"Error clearing users: {e}")
        
    conn.commit()
    print("Tables cleared successfully.")
    
    # 2. Seed Users (Super Admin, School Admin, Teachers, Students, Parents)
    print("Seeding users...")
    hashed_pwd_student = get_password_hash("student123")
    hashed_pwd_teacher = get_password_hash("teacher123")
    hashed_pwd_admin = get_password_hash("admin123")
    
    # Super Admin
    cur.execute(
        "INSERT INTO users (id, name, email, hashed_password, role, school_id, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (1, "Super Admin", "admin@admin.com", hashed_pwd_admin, "super_admin", None, 0)
    )
    
    # School Admin for Seba High
    cur.execute(
        "INSERT INTO users (id, name, email, hashed_password, role, school_id, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (2, "أ. عادل إمام (Adel Emam)", "schooladmin@seba.edu", hashed_pwd_admin, "school_admin", 1, 0)
    )
    
    # Teachers
    teachers = [
        (101, "أ. أحمد صبحي (Ahmad Sobhy)", "ahmad.sobhy@seba.edu", "teacher", 1),
        (102, "أ. منى زكي (Mona Zaki)", "mona.zaki@seba.edu", "teacher", 1),
        (103, "أ. طارق الشريف (Tarek El Sherif)", "tarek@seba.edu", "teacher", 1),
        (104, "أ. عمر سليمان (Omar Suleiman)", "omar.s@farabi.edu", "teacher", 2),
    ]
    for tid, name, email, role, school_id in teachers:
        cur.execute(
            "INSERT INTO users (id, name, email, hashed_password, role, school_id, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (tid, name, email, hashed_pwd_teacher, role, school_id, 0)
        )
        
    # Students
    students = [
        # (id, name, email, role, school_id, nfc_tag_id, counselor_report, counselor_report_summary)
        (201, "يوسف منصور (Youssef Mansour)", "youssef@student.com", "student", 1, None, None, None),
        (202, "كريم عبد العزيز (Karim Abdel Aziz)", "karim@student.com", "student", 1, None, None, None),
        (203, "ياسمين صبري (Yasmine Sabri)", "yasmine@student.com", "student", 1, None, None, None),
        (204, "أميرة خطاب (Amira Khattab)", "amira@student.com", "student", 1, None, None, None),
        (205, "شريف منير (Sherif Mounir)", "sherif@student.com", "student", 1, None, None, None),
        (206, "دينا الشربيني (Dina El Sherbiny)", "dina@student.com", "student", 1, None, None, None),
        (207, "محمد رمضان (Mohamed Ramadan)", "mohamed.r@student.com", "student", 1, None, None, None),
        (208, "فاتن حمامة (Faten Hamama)", "faten@student.com", "student", 1, None, None, None),
        (209, "أحمد زكي (Ahmed Zaki)", "ahmed.z@student.com", "student", 1, None, None, None),
        (210, "فيصل العتيبي (Faisal Al Otaibi)", "faisal@student.com", "student", 2, None, None, None),
        (211, "نورة الدوسري (Noura Al Dawsari)", "noura@student.com", "student", 2, None, None, None),
        
        # New requested students with their NFC Tags and Psychologist Counselor Reports
        (221, "بيتر رأفت (Peter Raafat)", "peter@student.com", "student", 1, "1E3EC201", 
         "Peter is an intellectually curious student who shows a strong interest in technology and software development. He exhibits high analytical skills but occasionally becomes impatient when working on mundane repetitive tasks. He thrives when given open-ended coding challenges.",
         "Highly analytical student, excels in coding and problem-solving, but needs engagement to prevent boredom."),
         
        (222, "نهال كمال (Nehal Kamal)", "nehal@student.com", "student", 1, "C2083203",
         "Nehal is an outstanding student with high academic performance across mathematics and computer science. She has a quiet demeanor and shows great diligence in her studies. She sometimes experiences mild anxiety regarding examinations and seeks reassurance.",
         "Top academic performer, diligent and meticulous, but experiences exam anxiety."),
         
        (223, "لؤي محمد (Loai Mohamed)", "loai@student.com", "student", 1, "E1A2C3D4",
         "Loai is a friendly and cooperative student who is motivated to learn. He struggles with maintaining focus over extended periods and benefits from shorter, highly structured learning tasks. He has shown steady improvement.",
         "Steady worker, cooperative, but suffers from brief attention spans; benefits from chunked lessons."),
         
        (224, "زياد أحمد (Zeyad Ahmed)", "zeyada@student.com", "student", 1, "B1C2D3E4",
         "Zeyad is an energetic, social student who integrates well with his peers. He works enthusiastically in team projects. He tends to rush through his assignments, resulting in avoidable errors. Encouraging him to double-check his work is beneficial.",
         "Social, team-oriented student, but prone to rushing and making simple mistakes.")
    ]
    
    for sid, name, email, role, school_id, nfc_tag_id, report, summary in students:
        cur.execute(
            "INSERT INTO users (id, name, email, hashed_password, role, school_id, nfc_tag_id, counselor_report, counselor_report_summary, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
            (sid, name, email, hashed_pwd_student, role, school_id, nfc_tag_id, report, summary)
        )
        
    # Parents
    parents = [
        (301, "محمود منصور (Mahmoud Mansour)", "mahmoud@parent.com", "parent", 1),
        (302, "محمد صبري (Mohamed Sabri)", "mohamed@parent.com", "parent", 1),
    ]
    for pid, name, email, role, school_id in parents:
        cur.execute(
            "INSERT INTO users (id, name, email, hashed_password, role, school_id, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)",
            (pid, name, email, hashed_pwd_student, role, school_id)
        )
        
    # 3. Seed Schools
    print("Seeding schools...")
    schools = [
        (1, "مدرسة سيبا الثانوية (Seba High School)", "Cairo, Egypt", ""),
        (2, "مدرسة الفارابي الدولية (Al-Farabi School)", "Riyadh, Saudi Arabia", ""),
        (3, "مدارس النيل الدولية (Nile Schools)", "Giza, Egypt", ""),
    ]
    for sch_id, name, address, logo in schools:
        cur.execute(
            "INSERT INTO schools (id, name, address, logo_url) VALUES (?, ?, ?, ?)",
            (sch_id, name, address, logo)
        )
        
    # 4. Seed Grades
    print("Seeding grades...")
    grades = [
        (1, 1, "الصف العاشر (Grade 10)", "2025-2026"),
        (2, 1, "الصف الحادي عشر (Grade 11)", "2025-2026"),
        (3, 2, "Grade 10", "2025-2026"),
        (4, 2, "Grade 12", "2025-2026"),
        (5, 3, "الصف الحادي عشر (Grade 11)", "2025-2026"),
    ]
    for gid, school_id, name, year in grades:
        cur.execute(
            "INSERT INTO grades (id, school_id, name, academic_year) VALUES (?, ?, ?, ?)",
            (gid, school_id, name, year)
        )
        
    # 5. Seed Physical Classrooms
    print("Seeding classrooms...")
    classrooms = [
        (1, 1, "١٠-أ مختبر العلوم (10-A Science Lab)", "B202", 30, "0", False),
        (2, 1, "١٠-ب قاعة الرياضيات (10-B Math Room)", "B204", 25, "0", False),
        (3, 2, "١١-أ مختبر الأحياء (11-A Biology Lab)", "C301", 28, "0", False),
        (4, 2, "١١-ب قاعة الفيزياء (11-B Physics)", "C303", 30, "0", True),
        (5, 3, "10-Alpha Computer Room", "D101", 20, "0", False),
        (6, 4, "12-Beta Exam Hall", "Gym-A", 100, "0", True),
    ]
    for cid, grade_id, name, room, cap, cam, is_exam in classrooms:
        cur.execute(
            "INSERT INTO physical_classrooms (id, grade_id, name, room_number, capacity, camera_source, is_exam_room) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (cid, grade_id, name, room, cap, cam, is_exam)
        )
        
    # 6. Seed Classroom Students
    print("Seeding classroom students...")
    class_students = [
        (1, 201), (1, 202), (1, 203), # 10-A Science Lab
        
        # 10-B Math Room (including all requested students)
        (2, 204), (2, 205), (2, 221), (2, 222), (2, 223), (2, 224),
        
        (3, 206), (3, 207),           # 11-A Biology Lab
        (4, 208), (4, 209),           # 11-B Physics Room
        (5, 210),                     # Al-Farabi Grade 10
        (6, 211),                     # Al-Farabi Grade 12
    ]
    for classroom_id, student_id in class_students:
        cur.execute(
            "INSERT INTO classroom_students (classroom_id, student_id, is_active) VALUES (?, ?, ?)",
            (classroom_id, student_id, True)
        )
        
    # 7. Seed Classroom Teachers (ensuring every teacher has classrooms/students assigned)
    print("Seeding classroom teachers...")
    class_teachers = [
        # Classroom 1: Chemistry (Ahmad Sobhy), Physics (Mona Zaki)
        (1, 101, "homeroom", "كيمياء (Chemistry)"),
        (1, 102, "subject", "فيزياء (Physics)"),
        
        # Classroom 2: Math (Ahmad Sobhy), Python (Mona Zaki as homeroom)
        (2, 101, "subject", "رياضيات (Mathematics)"),
        (2, 102, "homeroom", "برمجة بايثون (Python Coding)"),
        
        # Classroom 3: Biology & Coding (Tarek El Sherif)
        (3, 103, "homeroom", "أحياء (Biology)"),
        
        # Classroom 4: Physics (Tarek El Sherif)
        (4, 103, "subject", "فيزياء (Physics)"),
        
        # Classroom 5: Computer Science (Omar Suleiman)
        (5, 104, "homeroom", "Computer Science"),
        
        # Classroom 6: Math proctoring (Tarek El Sherif)
        (6, 103, "subject", "رياضيات (Mathematics)"),
    ]
    for classroom_id, teacher_id, role, subject in class_teachers:
        cur.execute(
            "INSERT INTO classroom_teachers (classroom_id, teacher_id, role, subject) VALUES (?, ?, ?, ?)",
            (classroom_id, teacher_id, role, subject)
        )
        
    # 8. Seed Courses & Lessons
    print("Seeding courses...")
    courses = [
        (3, "Python Coding", "Master modern software engineering concepts and clean code in Python.", "أ. منى زكي (Mona Zaki)", 120, "/uploads/course_27817_6485.jpg", "Term 1"),
        (6, "Math Grade 8 1st term", "First term mathematics for Grade 8, covering real numbers, equations, and intervals.", "أ. أحمد صبحي (Ahmad Sobhy)", 150, "/uploads/course_1.png", "Term 1"),
        (7, "Math Grade 8 2nd term", "Second term mathematics for Grade 8, covering advanced algebra, geometry, and coordinates.", "أ. أحمد صبحي (Ahmad Sobhy)", 180, "/uploads/course_26558_1931.png", "Term 2"),
    ]
    for cid, title, desc, instructor, dur, thumb, term in courses:
        cur.execute(
            "INSERT INTO courses (id, title, description, instructor, duration, thumbnail, term) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (cid, title, desc, instructor, dur, thumb, term)
        )
    conn.commit()

    # Now run the migrate function to pull real math lessons from rag_content.db
    print("Migrating real math lessons from RAG database...")
    migrate()

    # Seed Python lessons
    print("Seeding Python lessons...")
    python_lessons = [
        (301, 3, "Introduction to Python", "Welcome to Python programming. Learn basic print statements and variables.", "https://www.youtube.com/embed/dQw4w9WgXcQ", 15, 1),
        (302, 3, "Variables and Data Types", "Learn about integers, floats, strings, and boolean values in Python.", "https://www.youtube.com/embed/dQw4w9WgXcQ", 20, 2),
        (303, 3, "Control Flow & Decisions", "Master if-else statements, logical operators, and loops in Python.", "https://www.youtube.com/embed/dQw4w9WgXcQ", 25, 3),
    ]
    for lid, cid, title, desc, url, dur, order in python_lessons:
        cur.execute(
            "INSERT INTO lessons (id, course_id, title, description, video_url, duration, [order], completed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (lid, cid, title, desc, url, dur, order, False)
        )
    conn.commit()

    # Query all lessons from DB (including migrated math ones) for enrollments & activities
    cur.execute("SELECT id, course_id, title FROM lessons")
    lessons = cur.fetchall()

    # 9. Seed Enrollments, Activities, and Lesson Progress
    print("Seeding enrollments and activity logs...")
    course_classroom_mapping = {
        1: [6, 3], # 10-A Science Lab: Math Term 1 & Python Coding
        2: [6, 3], # 10-B Math Room: Math Term 1 & Python Coding
        3: [6, 3], # 11-A Biology Lab: Math Term 1 & Python Coding
        4: [7, 3], # 11-B Physics Room: Math Term 2 & Python Coding
        5: [3],    # Al-Farabi Grade 10: Python Coding
        6: [7]     # Al-Farabi Grade 12: Math Term 2
    }
    
    random.seed(42)
    activity_id = 1
    enrollment_id = 1
    
    for classroom_id, student_id in class_students:
        assigned_courses = course_classroom_mapping.get(classroom_id, [6])
        for course_id in assigned_courses:
            # Calibrated progress values for specific students, random for others
            if student_id == 221: # Peter
                progress = 88 if course_id == 6 else 92
            elif student_id == 222: # Nehal
                progress = 94 if course_id == 6 else 85
            elif student_id == 223: # Loai
                progress = 76 if course_id == 6 else 80
            elif student_id == 224: # Zeyad
                progress = 82 if course_id == 6 else 78
            else:
                progress = random.randint(30, 95)
                
            cur.execute(
                "INSERT INTO enrollments (id, student_id, course_id, progress) VALUES (?, ?, ?, ?)",
                (enrollment_id, student_id, course_id, progress)
            )
            enrollment_id += 1
            
            # Seed lesson completion activities matching progress
            course_lessons = [l for l in lessons if l[1] == course_id]
            num_lessons = len(course_lessons)
            num_completed = int((progress / 100) * num_lessons)
            
            for i in range(num_completed):
                lesson = course_lessons[i]
                timestamp = datetime.now() - timedelta(days=random.randint(1, 25))
                
                # Add lesson completion activity
                cur.execute(
                    "INSERT INTO activities (id, user_id, activity_type, entity_type, entity_id, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (activity_id, student_id, "lesson_completed", "lesson", lesson[0], f"Completed lesson: {lesson[2]}", timestamp.strftime("%Y-%m-%d %H:%M:%S"))
                )
                activity_id += 1
                
                # Add time spent in lesson_progress
                cur.execute(
                    "INSERT INTO lesson_progress (user_id, lesson_id, time_spent_seconds, last_accessed) VALUES (?, ?, ?, ?)",
                    (student_id, lesson[0], random.randint(600, 1800), timestamp.strftime("%Y-%m-%d %H:%M:%S"))
                )
                
            # Randomly submit quizzes for completed lessons
            for i in range(num_completed):
                if random.random() > 0.3:
                    lesson = course_lessons[i]
                    score = random.randint(75, 100)
                    timestamp = datetime.now() - timedelta(days=random.randint(1, 25))
                    
                    cur.execute(
                        "INSERT INTO activities (id, user_id, activity_type, entity_type, entity_id, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (activity_id, student_id, "quiz_submitted", "quiz", lesson[0], f"Submitted quiz: {lesson[2]} (Score: {score}%)", timestamp.strftime("%Y-%m-%d %H:%M:%S"))
                    )
                    activity_id += 1
                    
    # 10. Seed Student Sentiments (for chatbot analytics charts)
    print("Seeding student sentiments...")
    sentiment_phrases = [
        ("أحتاج للمساعدة في فهم هذا المفهوم الصعب", "I need help understanding this difficult concept", "confusion", 0.82),
        ("هل يمكنك شرح طريقة عمل الحلقات التكرارية مجدداً؟", "Can you explain how loops work again?", "curiosity", 0.90),
        ("فهمت الدرس ممتاز جداً شكراً لك", "I understood the lesson perfectly, thank you", "gratitude", 0.95),
        ("الدرس رائع والتمارين مفيدة للغاية", "The lesson is great and the exercises are very useful", "approval", 0.98),
        ("أواجه مشكلة في تشغيل الكود البرمجي الخاص بي", "I am facing a problem running my code", "annoyance", 0.76),
        ("كيف يمكنني كتابة دالة ترجع قيمة في بايثون؟", "How can I write a function that returns a value in Python?", "curiosity", 0.85),
        ("أشعر بالضياع ولا أعرف من أين أبدأ", "I feel lost and do not know where to start", "sadness", 0.88),
        ("لقد تمكنت من حل التحدي وحصلت على الدرجة الكاملة!", "I managed to solve the challenge and got full marks!", "joy", 0.97),
        ("ما هي الفروقات بين CSS Grid و Flexbox؟", "What are the differences between CSS Grid and Flexbox?", "curiosity", 0.80),
        ("أنا مستمتع جداً بهذه الدورة التعليمية", "I am really enjoying this tutorial course", "joy", 0.96)
    ]
    
    specific_sentiments = {
        221: [
            ("كيف يمكنني كتابة دالة متداخلة في بايثون؟", "How can I write a nested function in Python?", "curiosity", 0.90),
            ("فهمت الدرس بالكامل وحللت التمرين بنجاح!", "I understood the lesson completely and solved the exercise successfully!", "joy", 0.97),
            ("أواجه صعوبة في فهم الأعداد غير النسبية.", "I have difficulty understanding irrational numbers.", "confusion", 0.85)
        ],
        222: [
            ("لقد حصلت على الدرجة النهائية في اختبار الأعداد الحقيقية!", "I got the final grade in the real numbers test!", "joy", 0.98),
            ("هل سنقوم بتعلم هندسة الإحداثيات في هذا الفصل؟", "Will we learn coordinate geometry this term?", "curiosity", 0.88),
            ("أشعر بعدم التأكد من مفهوم الدوال الشرطية.", "I feel unsure about the concept of conditional functions.", "confusion", 0.82)
        ],
        223: [
            ("أشعر ببعض التشتت اليوم ولا أستطيع التركيز.", "I feel a bit distracted today and cannot focus.", "annoyance", 0.78),
            ("هل يمكنك شرح جمل التكرار بطريقة مبسطة؟", "Can you explain loop statements in a simplified way?", "confusion", 0.85),
            ("شكراً لك، هذا المثال ساعدني كثيراً!", "Thank you, this example helped me a lot!", "gratitude", 0.92)
        ],
        224: [
            ("هذا ممتع للغاية! كيف يمكنني تطوير كود اللعبة؟", "This is very fun! How can I develop the game code?", "joy", 0.95),
            ("لقد نسيت بعض الخطوات في حل هذه المعادلة.", "I forgot some steps in solving this equation.", "confusion", 0.80),
            ("سأقوم بإعادة المحاولة الآن.", "I will retry now.", "approval", 0.85)
        ]
    }
    
    for classroom_id, student_id in class_students:
        if student_id in specific_sentiments:
            for phrase, translation, label, conf in specific_sentiments[student_id]:
                timestamp = datetime.now() - timedelta(days=random.randint(0, 10))
                cur.execute(
                    "INSERT INTO student_sentiments (student_id, original_message, translated_message, sentiment_label, confidence_score, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (student_id, phrase, translation, label, conf, timestamp.strftime("%Y-%m-%d %H:%M:%S"))
                )
        else:
            # Generate 5 random sentiments per standard student
            for k in range(5):
                phrase, translation, label, conf = random.choice(sentiment_phrases)
                timestamp = datetime.now() - timedelta(days=random.randint(0, 10))
                cur.execute(
                    "INSERT INTO student_sentiments (student_id, original_message, translated_message, sentiment_label, confidence_score, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (student_id, phrase, translation, label, conf, timestamp.strftime("%Y-%m-%d %H:%M:%S"))
                )
                
    # 11. Seed Teacher Notes (obs list)
    print("Seeding teacher notes...")
    notes_catalog = [
        ("يظهر تميزاً كبيراً في استيعاب المفاهيم ومساعدة زملائه.", 1.5, "STRENGTH", "General"),
        ("يحتاج لمزيد من المران وحل المسائل العملية بعد الدرس.", 1.2, "WEAKNESS", "Practice"),
        ("طالب مجتهد ومبادر، يشارك بفعالية في الفصل.", 1.4, "CORE_PERSONA", "General"),
        ("يبدي تقدماً ملحوظاً في أدائه الأكاديمي والحلول البرمجية.", 1.3, "STRENGTH", "General"),
        ("تشتت بسيط أثناء الشرح، يفضل توجيه أسئلة مباشرة له.", 1.0, "SITUATIONAL", "Attention")
    ]
    
    specific_notes = {
        221: [
            ("يظهر مهارات برمجية استثنائية وقدرة عالية على التفكير المنطقي.", 1.8, "STRENGTH", "Python Basics"),
            ("يحتاج إلى تحسين تنظيم حلوله في مسائل الجبر الخطية.", 1.5, "WEAKNESS", "Algebra"),
            ("طالب مبادر وشغوف بالتعلم الذاتي.", 2.0, "CORE_PERSONA", "General")
        ],
        222: [
            ("تتمتع بذكاء رياضي وسرعة بديهة في حل المسائل الصعبة.", 1.8, "STRENGTH", "Real Numbers"),
            ("تتردد أحياناً قبل الإجابة بالرغم من صحة حلها.", 2.0, "CORE_PERSONA", "Self-confidence"),
            ("أنجزت جميع فروض البرمجة في الوقت المحدد بدقة بالغة.", 1.5, "STRENGTH", "Control Flow")
        ],
        223: [
            ("يبذل جهداً كبيراً ولديه تقدم مستمر في فهم المتغيرات.", 1.2, "STRENGTH", "Variables"),
            ("يتشتت انتباهه سريعاً في الحصص الطويلة.", 1.0, "SITUATIONAL", "Focus"),
            ("يحتاج لمزيد من تمارين المراجعة على مفهوم الكسور والنسب.", 2.0, "WEAKNESS", "Fractions")
        ],
        224: [
            ("يمتلك مهارات تواصل ممتازة ويحب العمل الجماعي.", 2.0, "CORE_PERSONA", "Collaboration"),
            ("أظهر تحسناً كبيراً في حل المعادلات الجبرية مؤخراً.", 1.5, "STRENGTH", "Algebra"),
            ("يستعجل أحياناً في تسليم الفروض مما يوقعه في أخطاء بسيطة.", 1.5, "WEAKNESS", "Attention to Detail")
        ]
    }
    
    for classroom_id, student_id in class_students:
        if student_id in specific_notes:
            for content, weight, category, tags in specific_notes[student_id]:
                timestamp = datetime.now() - timedelta(days=random.randint(1, 15))
                cur.execute(
                    "INSERT INTO teacher_notes (student_id, note_content, weight, category, topic_tags, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (student_id, content, weight, category, tags, timestamp.strftime("%Y-%m-%d %H:%M:%S"))
                )
        else:
            # 3 random notes per standard student
            for k in range(3):
                content, weight, category, tags = random.choice(notes_catalog)
                timestamp = datetime.now() - timedelta(days=random.randint(1, 15))
                cur.execute(
                    "INSERT INTO teacher_notes (student_id, note_content, weight, category, topic_tags, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (student_id, content, weight, category, tags, timestamp.strftime("%Y-%m-%d %H:%M:%S"))
                )
                
    # 12. Seed Classwork (for courses)
    print("Seeding course classwork items...")
    classwork_items = [
        # Course 6 (Math Term 1)
        (1, 6, "Math Term 1 Assignment 1", "Solve the real number equations on Page 12 of your notebook. Upload your answers in PDF format.", "homework", "", 10, "2026-06-30"),
        (2, 6, "PDF Resource: Real Numbers Cheat Sheet", "A useful PDF cheat sheet outlining Natural, Rational, and Irrational numbers.", "pdf", "/curriculum_pdfs/Math/term_1/les1.pdf", None, None),
        (3, 6, "Video Resource: Real Numbers Number Line", "Watch this short video explaining how to represent irrational numbers on a number line.", "video", "https://www.youtube.com/embed/dQw4w9WgXcQ", None, None),
        # Course 3 (Python Coding)
        (4, 3, "Python Basics Assignment", "Write a python script that prints 'Hello World' and calculates the sum of numbers from 1 to 10. Submit your python file.", "homework", "", 100, "2026-06-25"),
    ]

    for cwid, course_id, title, desc, cw_type, res_url, max_g, due in classwork_items:
        cur.execute(
            "INSERT INTO classwork (id, course_id, title, description, classwork_type, resource_url, max_grade, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (cwid, course_id, title, desc, cw_type, res_url, max_g, due)
        )
        
    # Seed a classwork submission for student 201 (Youssef Mansour) in Course 6 homework
    cur.execute(
        "INSERT INTO classwork_submissions (classwork_id, student_id, completed, submission_file_url, grade) VALUES (?, ?, ?, ?, ?)",
        (1, 201, True, "/uploads/sub_201_1_portfolio_draft.pdf", 9.5)
    )

    # 13. Restore and map pre-existing face profiles to our new student records
    if face_profiles_backup:
        print("Restoring backed up face profiles and mapping them to new students...")
        # Map sequential backup profiles to our target new students
        mapping = {
            0: 221, # Peter Raafat -> student_304.jpeg (first profile backup)
            1: 222, # Nehal Kamal -> student_305.jpeg
            2: 223, # Loai Mohamed -> student_306.jpeg
            3: 224  # Zeyad Ahmed  -> student_307.jpeg
        }
        
        for idx, profile in enumerate(face_profiles_backup):
            p_id, emb, photo, enrolled_by, created_at, updated_at = profile
            
            # Map sequentially if index exists in mapping
            if idx in mapping:
                target_student_id = mapping[idx]
                
                # Check photo filename, e.g. change name if it fits
                cur.execute(
                    "INSERT INTO student_face_profiles (id, student_id, embedding, photo_url, enrolled_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (p_id, target_student_id, emb, photo, enrolled_by or 2, created_at, updated_at)
                )
                print(f"Restored Face Profile ID {p_id} linked to Student ID {target_student_id} ({photo})")
            else:
                # If there are extra profiles, just restore them with their original student_id (or keep them)
                # To prevent errors we skip inserting them if their student_id doesn't exist, or insert with a safe fallback
                try:
                    cur.execute(
                        "INSERT INTO student_face_profiles (id, student_id, embedding, photo_url, enrolled_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (p_id, profile[1], emb, photo, enrolled_by, created_at, updated_at)
                    )
                except Exception as ex:
                    print(f"Skipped restoring extra profile {p_id} (Student ID {profile[1]}): {ex}")
            
    conn.commit()
    conn.close()
    print("\nDatabase seeded successfully with rich Arabic mock dataset, custom students, and mapped face profiles!")
    print("Super Admin Login: admin@admin.com / admin123")
    print("Student logins: peter@student.com, nehal@student.com, loai@student.com, zeyada@student.com / student123")


if __name__ == "__main__":
    seed_database()
