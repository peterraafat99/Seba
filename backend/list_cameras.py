import cv2

def list_cameras():
    print("==================================================")
    print("SCANNING FOR CONNECTED WEB CAMS...")
    print("==================================================")
    available_cameras = 0
    for index in range(10):
        cap = cv2.VideoCapture(index)
        if cap.isOpened():
            ret, frame = cap.read()
            w = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
            h = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
            print(f"📸 Index {index}: Camera is AVAILABLE ({int(w)}x{int(h)})")
            cap.release()
            available_cameras += 1
        else:
            # Some platforms return False even if index exists, but isOpened is the standard.
            pass
            
    if available_cameras == 0:
        print("❌ No cameras found! Please verify that your Microsoft Webcam is plugged in and not being used by another application (like browser, Zoom, Teams, etc.).")
    else:
        print("==================================================")
        print("💡 Set 'WEBCAM_INDEX' in your backend/.env to the index of the camera you want to use.")
        print("==================================================")

if __name__ == "__main__":
    list_cameras()
