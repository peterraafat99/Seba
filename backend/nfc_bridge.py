import sys
import os
import json
import time

# Ensure dependencies are installed
try:
    import serial
    import serial.tools.list_ports
except ImportError:
    print("Missing 'pyserial' package. Installing it now...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pyserial"])
    import serial
    import serial.tools.list_ports

try:
    import requests
except ImportError:
    print("Missing 'requests' package. Installing it now...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests"])
    import requests

API_URL = "http://127.0.0.1:8000/api"

# ANSI Terminal Colors
class Colors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'

def print_header(title):
    print(f"\n{Colors.BOLD}{Colors.HEADER}=== {title} ==={Colors.ENDC}")

def select_com_port():
    ports = list(serial.tools.list_ports.comports())
    if not ports:
        print(f"{Colors.FAIL}No serial ports found! Please check your USB connection.{Colors.ENDC}")
        sys.exit(1)
    
    print_header("Select ESP32 Serial COM Port")
    for i, port in enumerate(ports):
        print(f"[{i}] {port.device} - {port.description}")
        
    while True:
        try:
            choice = input(f"\nEnter port index (0-{len(ports)-1}): ").strip()
            if not choice:
                continue
            idx = int(choice)
            if 0 <= idx < len(ports):
                return ports[idx].device
        except ValueError:
            pass
        print(f"{Colors.FAIL}Invalid selection. Please try again.{Colors.ENDC}")

def run_attendance_mode(ser, classroom_id):
    print_header(f"Mode: Log Attendance (Classroom ID: {classroom_id})")
    print(f"{Colors.OKCYAN}Listening for NFC scans... Hold a card close to the RC522 reader.{Colors.ENDC}")
    print("Press Ctrl+C to go back to the menu.")
    
    while True:
        try:
            if ser.in_waiting > 0:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if line.startswith("NFC_TAG:"):
                    tag_id = line.split(":", 1)[1].strip().upper()
                    print(f"\n{Colors.OKBLUE}[SCAN]{Colors.ENDC} Card detected! UID: {Colors.BOLD}{tag_id}{Colors.ENDC}")
                    
                    # Send to backend
                    payload = {"nfc_tag_id": tag_id, "classroom_id": classroom_id}
                    try:
                        res = requests.post(f"{API_URL}/attendance/scan", json=payload)
                        if res.status_code == 200:
                            data = res.json()
                            print(f"{Colors.OKGREEN}✔ Attendance Logged Successfully!{Colors.ENDC}")
                            print(f"  Student: {Colors.BOLD}{data.get('student_name')}{Colors.ENDC}")
                            print(f"  Message: {data.get('message')}")
                        else:
                            detail = res.json().get('detail', 'Unknown error')
                            print(f"{Colors.FAIL}❌ Error: {detail}{Colors.ENDC}")
                    except Exception as e:
                        print(f"{Colors.FAIL}❌ Connection to backend failed: {e}{Colors.ENDC}")
            time.sleep(0.1)
        except KeyboardInterrupt:
            print(f"\n{Colors.WARNING}Returning to main menu...{Colors.ENDC}")
            break

def run_enroll_mode(ser):
    print_header("Mode: Enroll NFC Card to Student")
    student_id_str = input("Enter Student ID to assign card to: ").strip()
    if not student_id_str:
        print(f"{Colors.FAIL}Invalid Student ID.{Colors.ENDC}")
        return
        
    try:
        student_id = int(student_id_str)
    except ValueError:
        print(f"{Colors.FAIL}Student ID must be an integer.{Colors.ENDC}")
        return
        
    print(f"\n{Colors.OKCYAN}Please scan the NFC card on the reader to enroll...{Colors.ENDC}")
    
    while True:
        try:
            if ser.in_waiting > 0:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if line.startswith("NFC_TAG:"):
                    tag_id = line.split(":", 1)[1].strip().upper()
                    print(f"\n{Colors.OKBLUE}[SCAN]{Colors.ENDC} Card detected! UID: {Colors.BOLD}{tag_id}{Colors.ENDC}")
                    
                    # Send to backend
                    payload = {"student_id": student_id, "nfc_tag_id": tag_id}
                    try:
                        res = requests.post(f"{API_URL}/attendance/enroll_card", json=payload)
                        if res.status_code == 200:
                            data = res.json()
                            print(f"{Colors.OKGREEN}✔ Enrollment Success!{Colors.ENDC}")
                            print(f"  Message: {data.get('message')}")
                        else:
                            detail = res.json().get('detail', 'Unknown error')
                            print(f"{Colors.FAIL}❌ Enrollment Failed: {detail}{Colors.ENDC}")
                    except Exception as e:
                        print(f"{Colors.FAIL}❌ Connection to backend failed: {e}{Colors.ENDC}")
                    break
            time.sleep(0.1)
        except KeyboardInterrupt:
            print(f"\n{Colors.WARNING}Enrollment cancelled.{Colors.ENDC}")
            break

def main():
    print(f"{Colors.BOLD}{Colors.OKGREEN}╔══════════════════════════════════════════════════╗")
    print("║          SEBA NFC - SERIAL TO HTTP BRIDGE        ║")
    print(f"╚══════════════════════════════════════════════════╝{Colors.ENDC}")
    
    com_port = select_com_port()
    baud_rate = 115200
    
    print(f"\n{Colors.OKBLUE}Connecting to {com_port} at {baud_rate} baud...{Colors.ENDC}")
    try:
        ser = serial.Serial(com_port, baud_rate, timeout=1)
        # Flush serial buffer
        ser.reset_input_buffer()
        print(f"{Colors.OKGREEN}Connected successfully!{Colors.ENDC}")
    except Exception as e:
        print(f"{Colors.FAIL}Failed to connect: {e}{Colors.ENDC}")
        sys.exit(1)
        
    classroom_id = 2  # Default to classroom ID 2: "١٠-ب قاعة الرياضيات"
    
    while True:
        print_header("Main Menu")
        print("[1] Start Attendance Scanning Mode")
        print("[2] Enroll a new student NFC card")
        print("[3] Change Classroom ID (Current: {})".format(classroom_id))
        print("[4] Exit")
        
        choice = input("\nSelect option: ").strip()
        if choice == "1":
            run_attendance_mode(ser, classroom_id)
        elif choice == "2":
            run_enroll_mode(ser)
        elif choice == "3":
            new_id_str = input("Enter new Classroom ID: ").strip()
            try:
                classroom_id = int(new_id_str)
                print(f"{Colors.OKGREEN}Classroom ID updated to {classroom_id}{Colors.ENDC}")
            except ValueError:
                print(f"{Colors.FAIL}Invalid Classroom ID.{Colors.ENDC}")
        elif choice == "4":
            print(f"{Colors.OKBLUE}Goodbye!{Colors.ENDC}")
            ser.close()
            break
        else:
            print(f"{Colors.FAIL}Invalid option.{Colors.ENDC}")

if __name__ == "__main__":
    main()
