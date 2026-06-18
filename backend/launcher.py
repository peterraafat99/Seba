import os
import subprocess
import sys

if __name__ == "__main__":
    print("========================================")
    print("  Starting Seba AI Tutor Backend...     ")
    print("========================================")
    try:
        subprocess.run([sys.executable, "main.py"], check=True)
    except KeyboardInterrupt:
        print("Backend stopped by user.")
    except Exception as e:
        print(f"\nError starting backend: {e}")
        print("Ensure you have installed requirements with: pip install -r requirements.txt")
        input("Press Enter to exit...")
