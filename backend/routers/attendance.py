from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime

from database import get_db
import models
from pydantic import BaseModel
from typing import Optional

router = APIRouter(
    prefix="/attendance",
    tags=["Attendance (NFC)"]
)

class NFCScanRequest(BaseModel):
    nfc_tag_id: str
    classroom_id: int

class NFCEnrollRequest(BaseModel):
    student_id: int
    nfc_tag_id: str

@router.post("/scan")
def scan_nfc_attendance(scan_data: NFCScanRequest, db: Session = Depends(get_db)):
    """
    Logs attendance for a student via their NFC card.
    Expects the hardware reader to send the `nfc_tag_id` and the `classroom_id` it belongs to.
    """
    # 1. Look up student by NFC tag
    student = db.query(models.User).filter(models.User.nfc_tag_id == scan_data.nfc_tag_id).first()
    
    if not student:
        raise HTTPException(status_code=404, detail="Unregistered NFC Tag")

    if student.role != "student":
        raise HTTPException(status_code=400, detail="Tag belongs to a non-student account")

    # 2. Check if student is enrolled in this classroom (Optional but good for security)
    classroom_link = db.query(models.ClassroomStudent).filter(
        models.ClassroomStudent.student_id == student.id,
        models.ClassroomStudent.classroom_id == scan_data.classroom_id,
        models.ClassroomStudent.is_active == True
    ).first()

    if not classroom_link:
        raise HTTPException(status_code=403, detail="Student is not registered for this classroom")

    # Look up active session
    from cv_analytics.session_manager import session_manager
    active = session_manager.get(scan_data.classroom_id)
    session_id = active.session_id if active else None

    # Check if already present in this session/today to avoid duplicate spamming
    if session_id:
        existing = db.query(models.AttendanceRecord).filter(
            models.AttendanceRecord.student_id == student.id,
            models.AttendanceRecord.classroom_id == scan_data.classroom_id,
            models.AttendanceRecord.session_id == session_id
        ).first()
        if existing:
            return {
                "status": "success",
                "message": f"Already checked in, {student.name}",
                "student_name": student.name,
                "timestamp": existing.timestamp
            }
    else:
        from datetime import datetime, time
        today_start = datetime.combine(datetime.today(), time.min)
        existing = db.query(models.AttendanceRecord).filter(
            models.AttendanceRecord.student_id == student.id,
            models.AttendanceRecord.classroom_id == scan_data.classroom_id,
            models.AttendanceRecord.timestamp >= today_start
        ).first()
        if existing:
            return {
                "status": "success",
                "message": f"Already checked in, {student.name}",
                "student_name": student.name,
                "timestamp": existing.timestamp
            }

    # 3. Log Attendance
    record = models.AttendanceRecord(
        student_id=student.id,
        classroom_id=scan_data.classroom_id,
        session_id=session_id,
        status="present"
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return {
        "status": "success",
        "message": f"Welcome, {student.name}",
        "student_name": student.name,
        "timestamp": record.timestamp
    }

@router.post("/enroll_card")
def enroll_nfc_card(enroll_data: NFCEnrollRequest, db: Session = Depends(get_db)):
    """
    Assigns an NFC card ID to a specific student.
    Usually performed by an Admin or Teacher on a registration kiosk.
    """
    # Check if tag is already used
    existing = db.query(models.User).filter(models.User.nfc_tag_id == enroll_data.nfc_tag_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="This NFC tag is already assigned to another user")

    student = db.query(models.User).filter(models.User.id == enroll_data.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    student.nfc_tag_id = enroll_data.nfc_tag_id
    db.commit()

    return {"status": "success", "message": f"NFC Card registered to {student.name}"}


@router.get("/classroom/{classroom_id}/today")
def get_today_classroom_attendance(classroom_id: int, db: Session = Depends(get_db)):
    """
    Returns the attendance roster for today in the given classroom.
    Includes scan times and overall attendance percentages.
    """
    from datetime import datetime, time
    from sqlalchemy import func
    from cv_analytics.session_manager import session_manager
    
    today_start = datetime.combine(datetime.today(), time.min)
    
    # Check if there is an active session
    active = session_manager.get(classroom_id)
    
    # Get all students enrolled in this classroom
    enrolled_students = db.query(models.ClassroomStudent).filter(
        models.ClassroomStudent.classroom_id == classroom_id,
        models.ClassroomStudent.is_active == True
    ).all()
    
    # Get all unique attendance days for this classroom to calculate rate base
    unique_days_query = db.query(func.date(models.AttendanceRecord.timestamp)).filter(
        models.AttendanceRecord.classroom_id == classroom_id
    ).distinct().all()
    total_school_days = len(unique_days_query)
    if total_school_days == 0:
        total_school_days = 1
        
    attendance_list = []
    for link in enrolled_students:
        student = db.query(models.User).filter(models.User.id == link.student_id).first()
        if not student:
            continue
            
        # Check if present in active session or today
        if active:
            today_record = db.query(models.AttendanceRecord).filter(
                models.AttendanceRecord.student_id == student.id,
                models.AttendanceRecord.classroom_id == classroom_id,
                models.AttendanceRecord.session_id == active.session_id
            ).order_by(models.AttendanceRecord.timestamp.asc()).first()
        else:
            today_record = db.query(models.AttendanceRecord).filter(
                models.AttendanceRecord.student_id == student.id,
                models.AttendanceRecord.classroom_id == classroom_id,
                models.AttendanceRecord.timestamp >= today_start
            ).order_by(models.AttendanceRecord.timestamp.asc()).first()
        
        # Calculate student's unique present days
        student_days_query = db.query(func.date(models.AttendanceRecord.timestamp)).filter(
            models.AttendanceRecord.student_id == student.id,
            models.AttendanceRecord.classroom_id == classroom_id
        ).distinct().all()
        student_present_days = len(student_days_query)
        
        rate = round((student_present_days / total_school_days) * 100)
        if rate > 100:
            rate = 100
            
        attendance_list.append({
            "student_id": student.id,
            "name": student.name,
            "is_present": today_record is not None,
            "scan_time": today_record.timestamp.isoformat() if today_record else None,
            "attendance_rate": rate
        })
        
    return attendance_list


@router.get("/student/{student_id}/history")
def get_student_attendance_history(student_id: int, db: Session = Depends(get_db)):
    """
    Returns the complete attendance history for a specific student,
    grouped by classroom.
    """
    from sqlalchemy import func
    
    records = (
        db.query(models.AttendanceRecord)
        .filter(models.AttendanceRecord.student_id == student_id)
        .order_by(models.AttendanceRecord.timestamp.desc())
        .all()
    )
    
    # Calculate attendance percentage per classroom the student is enrolled in
    classrooms_link = db.query(models.ClassroomStudent).filter(
        models.ClassroomStudent.student_id == student_id,
        models.ClassroomStudent.is_active == True
    ).all()
    
    classroom_stats = []
    for link in classrooms_link:
        classroom = db.query(models.PhysicalClassroom).filter(models.PhysicalClassroom.id == link.classroom_id).first()
        if not classroom:
            continue
            
        # Total unique days there was attendance in this classroom
        unique_days_query = db.query(func.date(models.AttendanceRecord.timestamp)).filter(
            models.AttendanceRecord.classroom_id == classroom.id
        ).distinct().all()
        total_days = len(unique_days_query)
        if total_days == 0:
            total_days = 1
            
        # Unique days this student was present
        student_days_query = db.query(func.date(models.AttendanceRecord.timestamp)).filter(
            models.AttendanceRecord.student_id == student_id,
            models.AttendanceRecord.classroom_id == classroom.id
        ).distinct().all()
        student_present_days = len(student_days_query)
        
        rate = round((student_present_days / total_days) * 100)
        if rate > 100:
            rate = 100
            
        classroom_stats.append({
            "classroom_id": classroom.id,
            "classroom_name": classroom.name,
            "room_number": classroom.room_number,
            "present_days": student_present_days,
            "total_days": total_days,
            "attendance_rate": rate
        })
        
    return {
        "stats": classroom_stats,
        "logs": [
            {
                "id": r.id,
                "classroom_id": r.classroom_id,
                "classroom_name": db.query(models.PhysicalClassroom).filter(models.PhysicalClassroom.id == r.classroom_id).first().name,
                "timestamp": r.timestamp.isoformat(),
                "status": r.status
            }
            for r in records
        ]
    }
