# Seba AI Tutor - Testing Guide

Welcome to the Seba AI Tutor testing phase! Since you have a powerful machine (32GB RAM), you are in a great position to test the local AI generation and computer vision features smoothly.

This guide outlines the exact steps to test the newly implemented features: **Active Learning**, **Webcam Classroom Monitoring**, and **Admin Flow**.

---

## 1. Prerequisites & Setup

Before starting the tests, make sure the backend and frontend are running properly.

1. **Start the Backend:**
   Open a terminal in the `backend` folder and run:
   ```bash
   uvicorn main:app --reload
   ```
   *Note: The first time you ask the AI a question, it might take a moment to load the LLM into your RAM.*

2. **Start the Frontend:**
   Open a terminal in the `frontend` folder and run:
   ```bash
   npm run dev
   ```
   The platform should be accessible at `http://localhost:5173`.

---

## 2. Test Case 1: Admin Login & Dashboard

**Goal:** Verify that the admin account can log in and access the system overview.

**Steps:**
1. Open the application in your browser.
2. Navigate to the **Login** page.
3. Use the following credentials:
   - **Email:** `admin@example.com`
   - **Password:** `admin123`
4. Click **Login**.
5. **Expected Result:** You should be redirected to the main Dashboard. You should see platform statistics, and your role should reflect your administrative privileges.
6. Check if the newly added "Show/Hide Password" eye icon works correctly on the login screen.

---

## 3. Test Case 2: Active Learning Mode

**Goal:** Verify that the LLM acts as an interactive tutor, pacing the lesson chunk-by-chunk based on the student's persona.

**Steps:**
1. Log in with a Student account.
2. Navigate to the **Courses** page and open any available **Lesson**.
3. Look at the tabs on the right side of the lesson view (Video, Content, Quiz, Chat).
4. Click on the **Chat** (Study Assistant) tab.
5. At the top of the chat panel, you will see a toggle button: **"Start Active Learning"**. Click it!
6. **Expected Result:** 
   - The UI should change to a distinct purple theme (Active Learning Mode).
   - The AI should automatically send the first message, explaining the *first part* of the lesson and asking you a question about it.
7. **Interact with the Tutor:**
   - **Answer correctly:** The AI should praise you and move on to explaining the *next* part of the lesson.
   - **Answer incorrectly:** The AI should gently correct you, re-explain the current concept, and ask another question to verify your understanding before moving on.
8. **Verify Persistence:** Refresh the page, go back to the chat tab, and toggle Active Learning back on. Your previous active learning conversation history should load seamlessly.

---

## 4. Test Case 3: Webcam Classroom (Computer Vision)

**Goal:** Verify that the Computer Vision pipeline correctly initializes the webcam and detects student focus.

**Steps:**
1. As an Admin or Teacher, navigate to the **Classroom / Session Management** area.
2. Find the option to start a **Classroom Session** or **Exam Session**.
3. Ensure your laptop's webcam is not being used by another application (like Zoom or Teams).
4. Click **Start Camera / Start Session**.
5. **Expected Result:**
   - The browser should ask for Camera permissions. Click **Allow**.
   - You should see the webcam feed rendering on the screen.
   - The system should begin performing facial recognition and focus tracking.
6. **Test Distraction:**
   - Look away from the screen for a few seconds. The system should log a "Distracted" event.
   - Look back at the screen. The system should log a "Recovered" event.
7. Click **Stop Session**. Verify that the session summary (including your focus events) is successfully saved.

---

## Reporting Issues

If you encounter any errors or 500 Internal Server Error popups:
1. Check the `backend` terminal for the Python traceback.
2. Check the browser console (Right Click -> Inspect -> Console) for frontend errors.
3. Note down the exact steps you took before the error occurred.
