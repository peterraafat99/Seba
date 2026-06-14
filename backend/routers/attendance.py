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
        models.ClassroomStudent.classroom_id == scan_data.classroom_id
    ).first()

    if not classroom_link:
        raise HTTPException(status_code=403, detail="Student is not registered for this classroom")

    # 3. Log Attendance
    record = models.AttendanceRecord(
        student_id=student.id,
        classroom_id=scan_data.classroom_id,
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
