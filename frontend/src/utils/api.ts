import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  mockDashboard,
  mockCourses,
  mockLessons,
  mockStudents,
  mockStudentDetail,
  mockSchools,
  mockGrades,
  mockClassrooms,
  mockUsers,
  mockClassroomStudents,
  mockClassroomTeachers
} from './mockData';

// ------------------------------------------------------------------
// 1. IMPORT YOUR NEW REGISTRY (The bridge to your JSON files)
// ------------------------------------------------------------------
import { lessonsData } from '@/data/lessons/Math';

// Types
export interface ApiResponse<T = any> {
  data: T;
  message?: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
const MOCK_TOKEN = '0097';

// Utility to simulate network delay for mock data (300-800ms)
const sleep = (ms: number = 500) => new Promise((resolve) => setTimeout(resolve, ms));

class ApiClient {
  private client: AxiosInstance;
  private isMockMode: boolean;
  private mockCounselorReports: Record<string, { counselor_report: string; counselor_report_summary: string }> = {
    '1': {
      counselor_report: "Ahmed has shown signs of mild exam anxiety. He performs exceptionally well under non-timed tasks but struggles with time pressure. He is highly visual and responsive to encouragement.",
      counselor_report_summary: "- Mild exam anxiety: struggles with high time-pressure environments.\n- Highly visual learner: benefits from diagrams, graphs, and visual explanations.\n- Responds well to positive reinforcement and structured encouragement."
    },
    '4': {
      counselor_report: "Omar is a high-achieving student but gets easily distracted during lecture-heavy segments. He benefits from hands-on tasks, short interactive quizzes, and coding examples. Counselor recommends keeping questions practical and engaging.",
      counselor_report_summary: "- Easily distracted: struggles with long lecture-heavy segments.\n- Hands-on preference: learns best through coding exercises and practical quizzes.\n- Recommends keeping prompts and explanations action-oriented."
    }
  };
  private mockClassworkStore: Record<string, any[]> = {
    '1': [
      {
        id: 1,
        course_id: 1,
        title: "HTML Basics Homework Assignment",
        description: "Create a personal portfolio page using basic HTML tags such as header, section, footer, and tables. Submit your HTML file below.",
        classwork_type: "homework",
        resource_url: "",
        max_grade: 10,
        due_date: "2026-06-30",
        completed: true,
        submission_file_url: "/uploads/sub_201_1_portfolio_draft.pdf",
        submitted_at: new Date().toISOString()
      },
      {
        id: 2,
        course_id: 1,
        title: "PDF Reference: HTML5 Semantic Elements Cheat Sheet",
        description: "A useful PDF handbook summarizing standard semantic elements and their proper usage.",
        classwork_type: "pdf",
        resource_url: "https://www.w3.org/TR/html52/",
        max_grade: null,
        due_date: null,
        completed: false,
        submission_file_url: null,
        submitted_at: null
      },
      {
        id: 3,
        course_id: 1,
        title: "Video Resource: Learn Flexbox Layout in 15 Minutes",
        description: "Watch this helper video to master CSS Flexbox container properties and alignments.",
        classwork_type: "video",
        resource_url: "https://www.youtube.com/embed/fYq58gdkjjA",
        max_grade: null,
        due_date: null,
        completed: false,
        submission_file_url: null,
        submitted_at: null
      }
    ],
    '5': [
      {
        id: 4,
        course_id: 5,
        title: "General Chemistry Homework 1",
        description: "Solve questions 1 through 10 in Chapter 3 regarding molecular stoichiometry. Upload your answers in PDF format.",
        classwork_type: "homework",
        resource_url: "",
        max_grade: 100,
        due_date: "2026-06-25",
        completed: false,
        submission_file_url: null,
        submitted_at: null
      },
      {
        id: 5,
        course_id: 5,
        title: "PDF Resource: Periodic Table HD Version",
        description: "Download and review the high-resolution Periodic Table PDF to prepare for the upcoming quiz.",
        classwork_type: "pdf",
        resource_url: "https://www.rsc.org/periodic-table/",
        max_grade: null,
        due_date: null,
        completed: false,
        submission_file_url: null,
        submitted_at: null
      }
    ]
  };

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Determine mock mode once on initialization
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    this.isMockMode = urlToken === MOCK_TOKEN;

    // Request interceptor for auth token
    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('auth_token') || urlToken;

        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
          // Persist the specific mock token if found in URL
          if (token === MOCK_TOKEN) {
            localStorage.setItem('auth_token', token);
          }
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401 && !this.isMockMode) {
          localStorage.removeItem('auth_token');
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  // --- Auth endpoints ---

  async login(email: string, password: string) {
    if (this.isMockMode) {
      await sleep();
      const mockResponse = { access_token: MOCK_TOKEN, user: { name: 'Mock User', email, role: 'student' } };
      localStorage.setItem('auth_token', mockResponse.access_token);
      localStorage.setItem('user', JSON.stringify(mockResponse.user));
      return mockResponse;
    }

    const response = await this.client.post('/auth/login', { email, password });
    if (response.data.access_token) {
      localStorage.setItem('auth_token', response.data.access_token);
      if (response.data.user) {
        localStorage.setItem('user', JSON.stringify(response.data.user));
      }
    }
    return response.data;
  }

  async register(data: { name: string; email: string; password: string; role: string }) {
    if (this.isMockMode) {
      await sleep();
      const mockResponse = { access_token: MOCK_TOKEN, user: { ...data } };
      localStorage.setItem('auth_token', mockResponse.access_token);
      localStorage.setItem('user', JSON.stringify(mockResponse.user));
      return mockResponse;
    }

    const response = await this.client.post('/auth/register', data);
    if (response.data.access_token) {
      localStorage.setItem('auth_token', response.data.access_token);
      if (response.data.user) {
        localStorage.setItem('user', JSON.stringify(response.data.user));
      }
    }
    return response.data;
  }

  async logout() {
    if (this.isMockMode) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      return;
    }
    await this.client.post('/auth/logout');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
  }

  // --- Session endpoints ---

  async startSession(lessonId: string) {
    if (this.isMockMode) {
      return { data: { success: true, startTime: new Date().toISOString() } };
    }
    return this.client.post('/session/start', { lessonId });
  }

  async endSession(lessonId: string, duration: number) {
    if (this.isMockMode) {
      return { data: { success: true } };
    }
    return this.client.post('/session/end', { lessonId, duration });
  }

  // --- Dashboard ---

  async getDashboard() {
    if (this.isMockMode) {
      await sleep();
      return { data: mockDashboard };
    }
    return this.client.get('/dashboard');
  }

  // --- Profile ---

  async setGoal(goal: string) {
    if (this.isMockMode) return { data: { success: true, goal } };
    return this.client.post('/profile/goal', { goal });
  }

  async setPreference(preference: string, value: unknown) {
    if (this.isMockMode) return { data: { success: true, preference, value } };
    return this.client.post('/profile/preference', { preference, value });
  }

  // --- Courses ---

  async getAllCourses(signal?: AbortSignal) {
    if (this.isMockMode) {
      await sleep();
      return { data: mockCourses };
    }
    return this.client.get('/courses', { signal });
  }

  async getCourse(courseId: string) {
    if (this.isMockMode) {
      await sleep();
      const course = mockCourses.find(c => c.id === courseId);
      return { data: course || mockCourses[0] };
    }
    return this.client.get(`/courses/${courseId}`);
  }

  async enrollInCourse(courseId: string) {
    if (this.isMockMode) {
      await sleep();
      return { data: { message: "Enrolled successfully", enrolled: true } };
    }
    return this.client.post(`/courses/${courseId}/enroll`);
  }

  // ------------------------------------------------------------------
  // 2. UPDATED GET LESSON LOGIC
  // ------------------------------------------------------------------
  async getLesson(lessonId: string) {
    let responseData;

    // A. FETCH BASIC DATA (From Mock or Real DB)
    if (this.isMockMode) {
      await sleep();
      // In mock mode, we usually just return the JSON directly, 
      // but let's stick to the fallback logic for consistency
      responseData = mockLessons[lessonId as keyof typeof mockLessons] || mockLessons['1'];
    } else {
      // REAL MODE: Fetch from your Python Backend (ID: 4)
      const response = await this.client.get(`/lessons/${lessonId}`);
      responseData = response.data;
    }

    // B. THE MERGE STEP (The Magic)
    // Check if we have "Extra Content" (JSON) for this ID (4)
    const localData = lessonsData[lessonId];

    if (localData) {
      console.log(`[API] ⚡ Merging Local JSON content into Lesson ${lessonId}`);
      responseData = {
        ...responseData, // Keep DB Title, VideoUrl, Description
        content: responseData.content || localData.content,     // Inject Content from JSON only if DB doesn't have it
        quiz: responseData.quiz || localData.quiz,           // Inject Quiz from JSON only if DB doesn't have it
        diagramId: localData.diagramId  // Inject Diagram ID from JSON
      };
    } else {
      console.log(`[API] ⚠️ No local JSON found for Lesson ${lessonId} (Checked Registry)`);
    }

    return { data: responseData };
  }

  async trackLessonTime(lessonId: string, seconds: number) {
    if (this.isMockMode) return;
    return this.client.post(`/lessons/${lessonId}/track-time`, { seconds });
  }

  // --- Chat ---

  async sendChatMessage(lessonId: string, message: string, modelBackend?: string) {
    if (this.isMockMode) {
      await sleep(1000); // Longer delay for AI simulation
      return {
        data: {
          message: `[MOCK AI - ${modelBackend || 'default'}]: I received your question about "${message}". In the live app, this would be processed by an LLM based on the lesson context.`,
          timestamp: new Date().toISOString()
        },
      };
    }
    return this.client.post('/chat', { lessonId: parseInt(lessonId), message, model_backend: modelBackend });
  }

  async sendMultimodalChat(
    lessonId: string | number,
    message: string,
    imageFile?: File | null,
    audioBlob?: Blob | null,
    respondWithVoice: boolean = false,
    modelBackend?: string
  ) {
    if (this.isMockMode) {
      await sleep(1500);
      return {
        data: {
          message: `[MOCK AI MULTIMODAL]: I processed your request. Message: "${message}". Has attached image: ${!!imageFile}. Has attached audio: ${!!audioBlob}.`,
          type: "multimodal_response",
          detected_language: "en",
          timestamp: new Date().toISOString()
        }
      };
    }

    const formData = new FormData();
    formData.append('lesson_id', lessonId.toString());
    formData.append('message', message);
    formData.append('respond_with_voice', respondWithVoice ? 'true' : 'false');
    
    if (modelBackend) {
      formData.append('model_backend', modelBackend);
    }
    if (imageFile) {
      formData.append('image', imageFile);
    }
    if (audioBlob) {
      formData.append('audio', audioBlob, 'audio.webm');
    }

    return this.client.post('/chat/multimodal', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  }

  async startActiveLearning(lessonId: string, modelBackend?: string) {
    if (this.isMockMode) {
      await sleep(1000);
      return { data: { message: "[MOCK AI]: Welcome to Active Learning! Let's start with part 1." } };
    }
    return this.client.post('/active-learning/start', { lessonId: parseInt(lessonId), model_backend: modelBackend });
  }

  async sendActiveLearningMessage(lessonId: string, message: string, modelBackend?: string) {
    if (this.isMockMode) {
      await sleep(1000);
      return { data: { message: "[MOCK AI]: Good job! Let's move to part 2.", is_completed: false } };
    }
    return this.client.post('/active-learning/message', { lessonId: parseInt(lessonId), message, model_backend: modelBackend });
  }

  // --- Quiz ---

  async submitQuiz(lessonId: string, answers: Record<string, string | number>, calculatedScore?: number) {

    // 1. LOOK IN YOUR LOCAL JSON FIRST
    // This grabs the file: src/data/lessons/Math/lesson-1.json
    const localData = lessonsData[lessonId];

    if (localData && localData.quiz) {
      console.log(`[API] ⚡ Grading Quiz Locally using JSON for Lesson ${lessonId}`);

      let correct = 0;
      let total = localData.quiz.questions.length;

      // Loop through the questions in the JSON
      localData.quiz.questions.forEach((q: any) => {
        // Compare User's Answer vs JSON Correct Answer
        if (answers[q.id] === q.correctAnswer) {
          correct++;
        }
      });

      const score = total > 0 ? Math.round((correct / total) * 100) : 0;

      // FIXED: Always send to backend with calculated score
      await this.client.post('/quiz/submit', {
        lessonId: parseInt(lessonId),
        answers,
        calculatedScore: calculatedScore || score
      });

      // Return the result to frontend
      return {
        data: {
          score,
          correct,
          total,
          passed: score >= 70
        }
      };
    }

    // 2. Fallback: If no local data found, call the backend
    // (This is what was causing the 404 error, but we skip it now)
    return this.client.post('/quiz/submit', {
      lessonId: parseInt(lessonId),
      answers,
      calculatedScore
    });
  }

  async requestQuiz(lessonId: string) {
    if (this.isMockMode) {
      await sleep();
      // Try Registry first
      const lesson = lessonsData[lessonId] || mockLessons[lessonId as keyof typeof mockLessons] || mockLessons['1'];
      return { data: lesson.quiz };
    }
    return this.client.post('/quiz/request', { lessonId });
  }
  async generateQuiz(lessonId: string, modelBackend?: string) {
    // If we are in Mock Mode (offline)
    if (this.isMockMode) {
      await sleep(1500);
      return {
        data: {
          title: "Mock AI Quiz",
          difficulty: "MEDIUM",
          questions: [
            {
              id: 999,
              text: "This is a mock question to test the UI.",
              options: ["A", "B", "C", "D"],
              correct_option_index: 0
            }
          ]
        }
      };
    }

    return this.client.post('/quiz/generate', { lessonId: parseInt(lessonId), model_backend: modelBackend });
  }
  // --- Logs and Feedback ---

  async logLesson(lessonId: string, data: Record<string, any>) {
    if (this.isMockMode) return { data: { success: true } };
    return this.client.post('/log/lesson', { lessonId, ...data });
  }

  async feedbackLesson(lessonId: string, feedback: string, helpful: boolean) {
    if (this.isMockMode) return { data: { success: true } };
    return this.client.post('/feedback/lesson', { lessonId, feedback, helpful });
  }

  async feedbackChat(messageId: string, helpful: boolean) {
    if (this.isMockMode) return { data: { success: true } };
    return this.client.post('/feedback/chat', { messageId, helpful });
  }

  // --- Insights ---

  async getInsightsStudents() {
    if (this.isMockMode) {
      await sleep();
      return { data: mockStudents };
    }
    return this.client.get('/insights/students');
  }

  async getInsightsStudent(studentId: string) {
    if (this.isMockMode) {
      await sleep();
      return { data: mockStudentDetail };
    }
    return this.client.get(`/insights/student/${studentId}`);
  }

  async getNotesStudent(studentId: string) {
    if (this.isMockMode) {
      await sleep();
      return { data: mockStudentDetail.notes };
    }
    return this.client.get(`/notes/student/${studentId}`);
  }

  async addInsightComment(studentId: string, comment: string) {
    if (this.isMockMode) {
      return { data: { success: true, comment, createdAt: new Date().toISOString() } };
    }
    return this.client.post('/insights/comment', { studentId, comment });
  }

  async getStudentCounselorReport(studentId: string | number) {
    if (this.isMockMode) {
      await sleep();
      const report = this.mockCounselorReports[studentId.toString()] || { counselor_report: '', counselor_report_summary: '' };
      return {
        data: {
          student_id: Number(studentId),
          counselor_report: report.counselor_report,
          counselor_report_summary: report.counselor_report_summary
        }
      };
    }
    return this.client.get(`/school/students/${studentId}/counselor-report`);
  }

  async saveStudentCounselorReport(studentId: string | number, report: string) {
    if (this.isMockMode) {
      await sleep(1500); // Simulate AI processing time
      const summary = report.trim()
        ? "- Responsive to interactive exercises.\n- Benefited from step-by-step guidance.\n- Needs positive reinforcement."
        : "";
      this.mockCounselorReports[studentId.toString()] = {
        counselor_report: report,
        counselor_report_summary: summary
      };
      return {
        data: {
          student_id: Number(studentId),
          counselor_report: report,
          counselor_report_summary: summary
        }
      };
    }
    return this.client.post(`/school/students/${studentId}/counselor-report`, { report });
  }

  // --- Notifications ---

  async updateNotificationSettings(settings: Record<string, boolean>) {
    if (this.isMockMode) {
      await sleep(300);
      return { data: { success: true, settings } };
    }
    return this.client.post('/notifications/settings', settings);
  }

  // --- Admin endpoints ---

  async getAdminCourses() {
    if (this.isMockMode) {
      await sleep();
      return { data: mockCourses };
    }
    return this.client.get('/admin/courses');
  }

  async getAdminLessons() {
    if (this.isMockMode) {
      await sleep();
      const allLessons = Object.values(mockLessons);
      return { data: allLessons };
    }
    return this.client.get('/admin/lessons');
  }

  async getAdminUsers() {
    if (this.isMockMode) {
      await sleep();
      return { data: mockStudents };
    }
    return this.client.get('/admin/users');
  }

  async uploadCourseImage(file: File, courseId?: number) {
    if (this.isMockMode) {
      await sleep();
      return { data: { url: 'https://placehold.co/600x400', filename: 'mock-image.jpg' } };
    }
    const formData = new FormData();
    formData.append('file', file);
    if (courseId) {
      formData.append('course_id', courseId.toString());
    }
    return this.client.post('/upload/course-image', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  }

  async createCourse(data: { title: string; description: string; instructor: string; duration: number; thumbnail?: string }) {
    if (this.isMockMode) {
      await sleep();
      const newCourse = {
        id: `c_${Date.now()}`,
        ...data,
        lessons: 0,
        students: 0,
        rating: 0,
        image: data.thumbnail || 'https://placehold.co/600x400'
      };
      return { data: newCourse };
    }
    return this.client.post('/admin/courses', data);
  }

  async updateCourse(courseId: number | string, data: Partial<{ title: string; description: string; instructor: string; duration: number; thumbnail?: string }>) {
    if (this.isMockMode) {
      await sleep();
      return { data: { success: true, id: courseId, ...data } };
    }
    return this.client.put(`/admin/courses/${courseId}`, data);
  }

  async deleteCourse(courseId: number | string) {
    if (this.isMockMode) {
      await sleep();
      return { data: { success: true, deletedId: courseId } };
    }
    return this.client.delete(`/admin/courses/${courseId}`);
  }

  // --- Admin User Management ---
  async getUsersByRole(role?: string) {
    if (this.isMockMode) return { data: [] };
    return this.client.get('/admin/users', { params: { role } });
  }

  async linkParent(parentId: number | string, studentIds: (number | string)[]) {
    if (this.isMockMode) return { data: { success: true } };
    return this.client.post('/admin/link-parent', { parent_id: parentId, student_ids: studentIds });
  }

  async linkTeacher(teacherId: number | string, studentIds: (number | string)[]) {
    if (this.isMockMode) return { data: { success: true } };
    return this.client.post('/admin/link-teacher', { teacher_id: teacherId, student_ids: studentIds });
  }

  async deleteUser(userId: number | string) {
    if (this.isMockMode) {
      await sleep();
      return { data: { success: true, message: 'User deleted successfully' } };
    }
    return this.client.delete(`/admin/users/${userId}`);
  }

  // --- School Management ---

  async createSchool(data: { name: string; address?: string; logo_url?: string }) {
    if (this.isMockMode) {
      await sleep();
      const newSchool = { id: mockSchools.length + 1, ...data };
      mockSchools.push(newSchool);
      return { data: newSchool };
    }
    return this.client.post('/school/', data);
  }

  async createGrade(schoolId: string | number, data: { name: string; academic_year: string }) {
    if (this.isMockMode) {
      await sleep();
      const newGrade = { id: mockGrades.length + 1, school_id: Number(schoolId), ...data };
      mockGrades.push(newGrade);
      return { data: newGrade };
    }
    return this.client.post(`/school/${schoolId}/grades`, data);
  }

  async createClassroom(gradeId: string | number, data: { name: string; room_number?: string; capacity?: number; camera_source?: string; is_exam_room?: boolean }) {
    if (this.isMockMode) {
      await sleep();
      const newClassroom = { id: mockClassrooms.length + 1, grade_id: Number(gradeId), name: data.name, room_number: data.room_number, capacity: data.capacity, camera_source: '0', is_exam_room: !!data.is_exam_room };
      mockClassrooms.push(newClassroom);
      return { data: newClassroom };
    }
    return this.client.post(`/school/grades/${gradeId}/classrooms`, data);
  }

  async getSchools() {
    if (this.isMockMode) {
      await sleep();
      return { data: mockSchools };
    }
    return this.client.get('/school/');
  }

  async getGrades(schoolId: string | number) {
    if (this.isMockMode) {
      await sleep();
      return { data: mockGrades.filter(g => g.school_id === Number(schoolId)) };
    }
    return this.client.get(`/school/${schoolId}/grades`);
  }

  async getClassrooms(schoolId: string | number) {
    if (this.isMockMode) {
      await sleep();
      const gradeIds = mockGrades.filter(g => g.school_id === Number(schoolId)).map(g => g.id);
      return { data: mockClassrooms.filter(c => gradeIds.includes(c.grade_id)) };
    }
    return this.client.get(`/school/${schoolId}/classrooms`);
  }

  async updateClassroomConfig(classroomId: string | number, config: Record<string, any>) {
    if (this.isMockMode) {
      await sleep();
      return { data: { status: 'updated', config } };
    }
    return this.client.patch(`/school/classrooms/${classroomId}/config`, config);
  }

  async getSchoolUsers(role?: string, schoolId?: string | number) {
    if (this.isMockMode) {
      await sleep();
      let users = mockUsers;
      if (schoolId) {
        users = users.filter(u => u.school_id === Number(schoolId));
      }
      if (role) {
        users = users.filter(u => u.role === role);
      }
      return { data: users };
    }
    return this.client.get('/school/users', { params: { role, school_id: schoolId } });
  }

  async createSchoolUser(data: { name: string; email: string; password?: string; role: string; school_id?: number | null }) {
    if (this.isMockMode) {
      await sleep();
      const newUser = { id: mockUsers.length + 1000, school_id: data.school_id ? Number(data.school_id) : null, ...data };
      mockUsers.push(newUser);
      return { data: newUser };
    }
    return this.client.post('/school/users', data);
  }

  async getClassroomDetail(classroomId: string | number) {
    if (this.isMockMode) {
      await sleep();
      const c = mockClassrooms.find(room => room.id === Number(classroomId));
      if (!c) return { data: { id: classroomId, name: 'Classroom not found', students: [], teachers: [] } };
      
      const studentsInClass = mockClassroomStudents
        .filter(cs => cs.classroom_id === Number(classroomId) && cs.is_active)
        .map(cs => {
          const u = mockUsers.find(user => user.id === cs.student_id);
          return {
            student_id: cs.student_id,
            name: u ? u.name : 'Unknown Student',
            email: u ? u.email : '',
            is_active: cs.is_active
          };
        });

      const teachersInClass = mockClassroomTeachers
        .filter(ct => ct.classroom_id === Number(classroomId))
        .map(ct => {
          const u = mockUsers.find(user => user.id === ct.teacher_id);
          return {
            teacher_id: ct.teacher_id,
            name: u ? u.name : 'Unknown Teacher',
            role: ct.role,
            subject: ct.subject
          };
        });

      return {
        data: {
          id: c.id,
          name: c.name,
          room_number: c.room_number,
          students: studentsInClass,
          teachers: teachersInClass
        }
      };
    }
    return this.client.get(`/school/classrooms/${classroomId}`);
  }

  async getClassroomCourseAnalytics(classroomId: string | number, courseId: string | number) {
    if (this.isMockMode) {
      await sleep();
      const c = mockClassrooms.find(room => room.id === Number(classroomId));
      const course = mockCourses.find(item => item.id === courseId.toString());
      if (!c || !course) return { data: { classroom_id: classroomId, course_id: courseId, students: [], grade_distribution: { A:0, B:0, C:0, D:0 } } };
      
      const studentsInClass = mockClassroomStudents
        .filter(cs => cs.classroom_id === Number(classroomId) && cs.is_active)
        .map(cs => {
          const u = mockUsers.find(user => user.id === cs.student_id);
          
          // Seed grade & progress deterministically
          const seed = Number(cs.student_id) + Number(courseId);
          const baseScore = (Number(cs.student_id) % 2 === 0) ? 85 : 65;
          const variation = ((seed * 9301 + 49297) % 233280) % 21 - 10;
          const grade = Math.max(0, Math.min(100, baseScore + variation));
          
          const progress = Math.max(10, (seed * 17) % 91); // deterministic progress 10-100
          
          // Deterministic focus rate (65-98%)
          const focusSeed = Number(cs.student_id) * 3 + Number(courseId) * 7;
          const baseFocus = (Number(cs.student_id) % 2 === 0) ? 88 : 78;
          const focusVar = ((focusSeed * 9301 + 49297) % 233280) % 15 - 7;
          const focusRate = Math.max(50, Math.min(100, baseFocus + focusVar));
          
          return {
            student_id: cs.student_id,
            name: u ? u.name : 'Unknown Student',
            email: u ? u.email : '',
            grade: grade,
            progress: progress,
            attendance: Math.floor(Math.random() * 15) + 85,
            focus_rate: focusRate
          };
        });
        
      const grades = studentsInClass.map(s => s.grade);
      const progresses = studentsInClass.map(s => s.progress);
      const avgGrade = grades.length > 0 ? (grades.reduce((a, b) => a + b, 0) / grades.length) : 0;
      const avgProgress = progresses.length > 0 ? (progresses.reduce((a, b) => a + b, 0) / progresses.length) : 0;
      const avgFocus = studentsInClass.length > 0 ? (studentsInClass.reduce((acc, s) => acc + s.focus_rate, 0) / studentsInClass.length) : 0;
      
      return {
        data: {
          classroom_id: classroomId,
          classroom_name: c.name,
          course_id: courseId,
          course_title: course.title,
          instructor: course.instructor,
          avg_grade: Number(avgGrade.toFixed(1)),
          avg_progress: Number(avgProgress.toFixed(1)),
          avg_focus_rate: Number(avgFocus.toFixed(1)),
          student_count: studentsInClass.length,
          students: studentsInClass,
          grade_distribution: {
            A: studentsInClass.filter(s => s.grade >= 90).length,
            B: studentsInClass.filter(s => s.grade >= 80 && s.grade < 90).length,
            C: studentsInClass.filter(s => s.grade >= 70 && s.grade < 80).length,
            D: studentsInClass.filter(s => s.grade < 70).length
          }
        }
      };
    }
    return this.client.get(`/analytics/classroom/${classroomId}/course/${courseId}`);
  }

  async addClassroomStudents(classroomId: string | number, studentIds: number[]) {
    if (this.isMockMode) {
      await sleep();
      studentIds.forEach(sid => {
        const existingIdx = mockClassroomStudents.findIndex(cs => cs.classroom_id === Number(classroomId) && cs.student_id === sid);
        if (existingIdx !== -1) {
          mockClassroomStudents[existingIdx].is_active = true;
        } else {
          mockClassroomStudents.push({ id: mockClassroomStudents.length + 1, classroom_id: Number(classroomId), student_id: sid, is_active: true });
        }
      });
      return { data: { status: 'success', added: studentIds.length } };
    }
    return this.client.post(`/school/classrooms/${classroomId}/students`, { student_ids: studentIds });
  }

  async assignClassroomTeacher(classroomId: string | number, teacherData: { teacher_id: number; role: string; subject?: string }) {
    if (this.isMockMode) {
      await sleep();
      const existingIdx = mockClassroomTeachers.findIndex(ct => ct.classroom_id === Number(classroomId) && ct.teacher_id === teacherData.teacher_id);
      if (existingIdx !== -1) {
        mockClassroomTeachers[existingIdx].role = teacherData.role;
        mockClassroomTeachers[existingIdx].subject = teacherData.subject || '';
      } else {
        mockClassroomTeachers.push({
          id: mockClassroomTeachers.length + 1,
          classroom_id: Number(classroomId),
          teacher_id: teacherData.teacher_id,
          role: teacherData.role,
          subject: teacherData.subject || ''
        });
      }
      return { data: { status: 'success' } };
    }
    return this.client.post(`/school/classrooms/${classroomId}/teachers`, teacherData);
  }

  async removeClassroomStudent(classroomId: string | number, studentId: string | number) {
    if (this.isMockMode) {
      await sleep();
      const existingIdx = mockClassroomStudents.findIndex(cs => cs.classroom_id === Number(classroomId) && cs.student_id === Number(studentId));
      if (existingIdx !== -1) {
        mockClassroomStudents[existingIdx].is_active = false;
      }
      return { data: { success: true } };
    }
    return this.client.delete(`/school/classrooms/${classroomId}/students/${studentId}`);
  }

  // --- CV Analytics ---

  async startCvSession(
    classroomId: string | number,
    type: 'class' | 'exam' = 'class',
    cameraSource: string = '0',
    teacherId?: number,
    courseId?: number,
    lessonId?: number
  ) {
    if (this.isMockMode) {
      await sleep();
      return { data: { success: true, session_id: 1, classroom_id: classroomId, status: 'started' } };
    }
    return this.client.post('/cv/session/start', {
      classroom_id: parseInt(classroomId.toString()),
      session_type: type,
      camera_source: cameraSource,
      teacher_id: teacherId,
      course_id: courseId,
      lesson_id: lessonId
    });
  }

  async stopCvSession(classroomId: string | number) {
    if (this.isMockMode) {
      await sleep();
      return { data: { success: true } };
    }
    return this.client.post(`/cv/session/stop?classroom_id=${classroomId}`);
  }

  async enrollStudentFace(studentId: string | number, file: File) {
    if (this.isMockMode) {
      await sleep();
      return { data: { success: true, student_id: studentId } };
    }
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('student_id', studentId.toString());
    return this.client.post('/cv/faces/enroll', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  }

  async uploadClassworkFile(file: File) {
    if (this.isMockMode) {
      await sleep();
      return { data: { url: '/uploads/mock_material.pdf', filename: file.name } };
    }
    const formData = new FormData();
    formData.append('file', file);
    return this.client.post('/classwork/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  }

  // --- Classwork endpoints ---

  async getClasswork(courseId: string | number) {
    if (this.isMockMode) {
      await sleep();
      return { data: this.mockClassworkStore[courseId.toString()] || [] };
    }
    return this.client.get(`/classwork/course/${courseId}`);
  }

  async createClasswork(courseId: string | number, data: { title: string; description?: string; classwork_type: string; resource_url?: string; max_grade?: number; due_date?: string }) {
    if (this.isMockMode) {
      await sleep();
      if (!this.mockClassworkStore[courseId.toString()]) {
        this.mockClassworkStore[courseId.toString()] = [];
      }
      const newItem = {
        id: Date.now(),
        course_id: Number(courseId),
        ...data,
        created_at: new Date().toISOString(),
        completed: false,
        submission_file_url: null,
        submitted_at: null,
        grade: null
      };
      this.mockClassworkStore[courseId.toString()].unshift(newItem);
      return { data: newItem };
    }
    return this.client.post(`/classwork/course/${courseId}`, data);
  }

  async submitClasswork(classworkId: string | number, formData: FormData) {
    if (this.isMockMode) {
      await sleep();
      let found = false;
      const file = formData.get('file') as File | null;
      const completed = formData.get('completed') === 'true';
      
      for (const courseId of Object.keys(this.mockClassworkStore)) {
        const idx = this.mockClassworkStore[courseId].findIndex(item => item.id === Number(classworkId));
        if (idx !== -1) {
          const item = this.mockClassworkStore[courseId][idx];
          item.completed = completed;
          if (file) {
            item.submission_file_url = `/uploads/mock_${Date.now()}_${file.name}`;
          }
          item.submitted_at = new Date().toISOString();
          found = true;
          break;
        }
      }
      return { data: { status: 'success', completed } };
    }
    return this.client.post(`/classwork/${classworkId}/submit`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  }

  async unsubmitClasswork(classworkId: string | number) {
    if (this.isMockMode) {
      await sleep();
      for (const courseId of Object.keys(this.mockClassworkStore)) {
        const idx = this.mockClassworkStore[courseId].findIndex(item => item.id === Number(classworkId));
        if (idx !== -1) {
          const item = this.mockClassworkStore[courseId][idx];
          item.completed = false;
          item.submission_file_url = null;
          item.submitted_at = null;
          break;
        }
      }
      return { data: { status: 'success' } };
    }
    return this.client.post(`/classwork/${classworkId}/unsubmit`);
  }

  async getCurriculumPdfs() {
    if (this.isMockMode) {
      await sleep();
      return { data: [{ filename: "math_term_1.pdf", filepath: "/curriculum_pdfs/math_term_1.pdf" }] };
    }
    return this.client.get('/classwork/curriculum-pdfs');
  }

  async getClassworkSubmissions(classworkId: string | number) {
    if (this.isMockMode) {
      await sleep();
      return { data: [
        {
          id: 1,
          classwork_id: Number(classworkId),
          student_id: 4,
          student: { id: 4, name: "عمر الفاروق", email: "student@seba.com" },
          submitted_at: new Date().toISOString(),
          grade: null,
          answers_json: "{}",
          completed: true,
          submission_file_url: "/uploads/mock_homework.pdf"
        }
      ]};
    }
    return this.client.get(`/classwork/${classworkId}/submissions`);
  }

  async gradeClassworkSubmission(classworkId: string | number, studentId: string | number, grade: number) {
    if (this.isMockMode) {
      await sleep();
      return { data: { status: 'success', grade } };
    }
    return this.client.post(`/classwork/${classworkId}/grade`, { student_id: Number(studentId), grade });
  }

  async getClassroomMessages(classroomId: string | number, studentId?: string | number) {
    if (this.isMockMode) {
      await sleep();
      return { data: [
        {
          id: 1,
          classroom_id: Number(classroomId),
          sender_id: 2,
          sender: { name: "أ/ احمد صبحي", role: "teacher" },
          student_id: studentId ? Number(studentId) : null,
          message: "أهلاً بكم في الفصل! سنبدأ درس الجبر غداً.",
          created_at: new Date(Date.now() - 3600000).toISOString()
        }
      ]};
    }
    return this.client.get(`/school/classrooms/${classroomId}/messages`, { params: { student_id: studentId } });
  }

  async sendClassroomMessage(classroomId: string | number, data: { message: string; student_id?: number | null }) {
    if (this.isMockMode) {
      await sleep();
      const newMsg = {
        id: Date.now(),
        classroom_id: Number(classroomId),
        sender_id: 2,
        sender: { name: "أ/ احمد صبحي", role: "teacher" },
        student_id: data.student_id || null,
        message: data.message,
        created_at: new Date().toISOString()
      };
      return { data: newMsg };
    }
    return this.client.post(`/school/classrooms/${classroomId}/messages`, data);
  }

  async getStudentFocusHistory(studentId: string | number) {
    if (this.isMockMode) {
      await sleep();
      return { data: [
        {
          session_id: 1,
          started_at: new Date(Date.now() - 86400000).toISOString(),
          focus_rate: 85.5,
          teacher_name: "أ/ احمد صبحي",
          course_title: "Math Grade 8 1st term",
          lesson_title: "Introduction to Algebra"
        },
        {
          session_id: 2,
          started_at: new Date().toISOString(),
          focus_rate: 78.2,
          teacher_name: "أ/ احمد صبحي",
          course_title: "Math Grade 8 1st term",
          lesson_title: "Linear Equations"
        }
      ]};
    }
    return this.client.get(`/analytics/student/${studentId}/focus-history`);
  }

  async getTeacherFocusHistory(teacherId: string | number) {
    if (this.isMockMode) {
      await sleep();
      return { data: [
        {
          session_id: 1,
          started_at: new Date(Date.now() - 86400000).toISOString(),
          avg_focus_rate: 82.3,
          course_title: "Math Grade 8 1st term",
          lesson_title: "Introduction to Algebra"
        },
        {
          session_id: 2,
          started_at: new Date().toISOString(),
          avg_focus_rate: 84.1,
          course_title: "Math Grade 8 1st term",
          lesson_title: "Linear Equations"
        }
      ]};
    }
    return this.client.get(`/analytics/teacher/${teacherId}/focus-history`);
  }

  async getCourseFocusHistory(courseId: string | number) {
    if (this.isMockMode) {
      await sleep();
      return { data: [
        {
          session_id: 1,
          started_at: new Date(Date.now() - 86400000).toISOString(),
          avg_focus_rate: 82.3,
          teacher_name: "أ/ احمد صبحي",
          lesson_title: "Introduction to Algebra"
        },
        {
          session_id: 2,
          started_at: new Date().toISOString(),
          avg_focus_rate: 84.1,
          teacher_name: "أ/ احمد صبحي",
          lesson_title: "Linear Equations"
        }
      ]};
    }
    return this.client.get(`/analytics/course/${courseId}/focus-history`);
  }
}

export const api = new ApiClient();