import logging
import sys
import threading
import time
from datetime import datetime, timezone

# Safely import or install pyserial
try:
    import serial
    import serial.tools.list_ports
except ImportError:
    logging.info("[NFCListener] Missing 'pyserial' package. Attempting automatic installation...")
    try:
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyserial"])
        import serial
        import serial.tools.list_ports
    except Exception as e:
        logging.error(f"[NFCListener] Failed to automatically install pyserial: {e}")
        serial = None

logger = logging.getLogger(__name__)

class NFCSerialListener:
    """
    Background listener for ESP32 NFC serial scans.
    Automatically identifies the COM port, opens it at 921600 baud,
    and records checked-in students to the database for the active session.
    """
    def __init__(self, classroom_id: int, session_id: int):
        self.classroom_id = classroom_id
        self.session_id = session_id
        self._stop_event = threading.Event()
        self._thread = None
        self._ser = None

    def start(self):
        """Starts the background listening thread."""
        if serial is None:
            logger.error("[NFCListener] pyserial is not available. Cannot start NFC listener.")
            return

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            name=f"nfc-listener-classroom-{self.classroom_id}",
            daemon=True
        )
        self._thread.start()
        logger.info(f"[NFCListener] Thread started for classroom={self.classroom_id}, session={self.session_id}")

    def stop(self):
        """Stops the listener and closes the serial connection."""
        self._stop_event.set()
        if self._ser:
            try:
                self._ser.close()
                logger.info("[NFCListener] Serial connection closed.")
            except Exception as e:
                logger.error(f"[NFCListener] Error closing serial connection: {e}")
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        logger.info("[NFCListener] Thread stopped.")

    def _find_com_port(self) -> str:
        """Finds the most suitable COM port for the ESP32 card reader."""
        ports = list(serial.tools.list_ports.comports())
        if not ports:
            return None

        # Print all ports to log for debugging
        logger.info(f"[NFCListener] Available ports: {[p.device for p in ports]}")

        # Common chipsets/descriptions for ESP32 boards
        esp32_keywords = ["cp210", "ch340", "ch341", "silicon labs", "usb-to-uart", "usb serial", "ftdi", "esp32"]
        
        # 1. Search for keyword matches in description/device info
        for port in ports:
            desc = (port.description or "").lower()
            device = (port.device or "").lower()
            for kw in esp32_keywords:
                if kw in desc or kw in device:
                    logger.info(f"[NFCListener] Auto-detected ESP32 reader on: {port.device} ({port.description})")
                    return port.device

        # 2. Fall back to the first available COM port
        logger.info(f"[NFCListener] No matching ESP32 signature. Selecting first available port: {ports[0].device}")
        return ports[0].device

    def _run_loop(self):
        """Serial monitoring loop running in background thread."""
        com_port = self._find_com_port()
        if not com_port:
            logger.warning("[NFCListener] No serial/COM ports found. NFC reader not connected.")
            return

        baud_rate = 921600
        logger.info(f"[NFCListener] Attempting connection on {com_port} at {baud_rate} baud...")
        
        try:
            self._ser = serial.Serial(com_port, baud_rate, timeout=1)
            self._ser.reset_input_buffer()
            logger.info(f"[NFCListener] Successfully connected to {com_port}!")
        except Exception as e:
            logger.error(f"[NFCListener] Failed to open serial port {com_port}: {e}")
            return

        from database import SessionLocal
        import models

        while not self._stop_event.is_set():
            try:
                if self._ser.in_waiting > 0:
                    line = self._ser.readline().decode('utf-8', errors='ignore').strip()
                    tag_id = None
                    if line.startswith("NFC_TAG:"):
                        tag_id = line.split(":", 1)[1].strip().replace(" ", "").upper()
                    elif "your ID is:" in line:
                        tag_id = line.split("your ID is:", 1)[1].strip().replace(" ", "").upper()

                    if tag_id:
                        logger.info(f"[NFCListener] Card Scanned! UID: {tag_id}")
                        self._handle_card_scan(tag_id)
                time.sleep(0.1)
            except Exception as e:
                # If connection is lost or reset, wait and retry opening it
                logger.error(f"[NFCListener] Error in serial loop: {e}")
                time.sleep(2.0)
                try:
                    if self._ser:
                        self._ser.close()
                    self._ser = serial.Serial(com_port, baud_rate, timeout=1)
                    self._ser.reset_input_buffer()
                except Exception as reconnect_error:
                    logger.error(f"[NFCListener] Reconnection attempt failed: {reconnect_error}")

    def _handle_card_scan(self, tag_id: str):
        """Processes a scanned NFC tag inside a dedicated DB transaction."""
        from database import SessionLocal
        import models

        db = SessionLocal()
        try:
            # 1. Look up student by NFC tag
            student = db.query(models.User).filter(models.User.nfc_tag_id == tag_id).first()
            if not student:
                logger.warning(f"[NFCListener] Scanned card {tag_id} belongs to an unregistered student.")
                return

            if student.role != "student":
                logger.warning(f"[NFCListener] Scanned card {tag_id} belongs to account '{student.name}' with role '{student.role}' (not student).")
                return

            # 2. Check if student is in classroom roster
            classroom_link = db.query(models.ClassroomStudent).filter(
                models.ClassroomStudent.student_id == student.id,
                models.ClassroomStudent.classroom_id == self.classroom_id,
                models.ClassroomStudent.is_active == True
            ).first()

            if not classroom_link:
                logger.warning(f"[NFCListener] Student '{student.name}' (ID: {student.id}) is not enrolled in classroom {self.classroom_id}.")
                return

            # 3. Check if already marked present in this session
            existing = db.query(models.AttendanceRecord).filter(
                models.AttendanceRecord.student_id == student.id,
                models.AttendanceRecord.classroom_id == self.classroom_id,
                models.AttendanceRecord.session_id == self.session_id
            ).first()

            if existing:
                logger.info(f"[NFCListener] Student '{student.name}' is already marked present in session {self.session_id}.")
                return

            # 4. Save to DB
            record = models.AttendanceRecord(
                student_id=student.id,
                classroom_id=self.classroom_id,
                session_id=self.session_id,
                status="present"
            )
            db.add(record)
            db.commit()
            logger.info(f"[NFCListener] Checked in student '{student.name}' (ID: {student.id}) successfully for session {self.session_id}.")
        except Exception as e:
            logger.error(f"[NFCListener] Error logging scanned card: {e}")
        finally:
            db.close()
