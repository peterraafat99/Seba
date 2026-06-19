import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit, Trash2, BookOpen, Users, GraduationCap, ChevronDown, ChevronUp, Mail, Calendar, TrendingUp, Clock, Upload, X, School, MessageSquare, Video, Send, FileText, CheckCircle, ArrowLeft, Camera } from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const RechartsTooltip = Tooltip as any;
import { Layout } from '@/components/layout/Layout';
import { RelationshipManager } from '@/components/admin/RelationshipManager';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loading } from '@/components/ui/Loading';
import { Alert } from '@/components/ui/Alert';
import { api } from '@/utils/api';
import { t } from '@/utils/language';
import { useLanguage } from '@/contexts/LanguageContext';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import { FaceEnrollment } from '@/components/FaceEnrollment';

interface Course {
  id: number;
  title: string;
  description: string;
  instructor: string;
  duration: number;
  enrolled: number;
  thumbnail?: string;
  lessons: any[];
}

interface Lesson {
  id: number;
  title: string;
  courseId: number;
  courseTitle: string;
  duration: number;
}

interface UserEnrollment {
  course_id: number;
  course_title: string;
  progress: number;
  enrolled_at: string | null;
  completed_lessons: number;
  total_lessons: number;
}

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  created_at: string | null;
  enrollments: UserEnrollment[];
  total_enrollments: number;
}

interface Student {
  id: string;
  name: string;
  email: string;
  progress: number;
  attendance: number;
  averageGrade: number;
  coursesEnrolled: number;
}

interface StudentDetail {
  id: string;
  name: string;
  performance: {
    date: string;
    score: number;
  }[];
  attendance: {
    date: string;
    present: boolean;
  }[];
  grades: {
    course: string;
    grade: number;
    timeSpent: number;
    lessons: { title: string; timeSpent: number; }[];
  }[];
  notes: {
    id: string;
    content: string;
    timestamp: string;
  }[];
  engagementScore?: number;
  totalActivities?: number;
  totalTimeSpent?: number;
  sentimentData?: {
    positive: number;
    negative: number;
    neutral: number;
    positivePercentage: number;
    negativePercentage: number;
    neutralPercentage: number;
    engagementLevel: string;
    quiz_activities: number;
    lesson_activities: number;
    enrollment_activities: number;
  };
  teacherNotes?: {
    id: string;
    content: string;
    weight: number;
    timestamp: string;
  }[];
  studentSentiments?: {
    id: string;
    message: string;
    sentiment_label: string;
    confidence: number;
    timestamp: string;
  }[];
}

export const Admin = () => {
  const navigate = useNavigate();
  const userStr = localStorage.getItem('user');
  const currentUser = userStr ? JSON.parse(userStr) : null;
  const isTeacher = currentUser && currentUser.role === 'teacher';

  const [activeTab, setActiveTab] = useState<'admin' | 'insights' | 'relationships' | 'classroom'>(
    isTeacher ? 'classroom' : 'admin'
  );
  const [courses, setCourses] = useState<Course[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [studentDetail, setStudentDetail] = useState<StudentDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [counselorReport, setCounselorReport] = useState('');
  const [counselorReportSummary, setCounselorReportSummary] = useState('');
  const [loadingCounselorReport, setLoadingCounselorReport] = useState(false);
  const [isSavingCounselorReport, setIsSavingCounselorReport] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCourseModal, setShowCourseModal] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());
  const [courseForm, setCourseForm] = useState({
    title: '',
    description: '',
    instructor: '',
    duration: 0,
    thumbnail: '',
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const { language } = useLanguage();

  // School & Classroom scoping for Insights (الرؤى)
  const [schools, setSchools] = useState<any[]>([]);
  const [selectedSchoolIdForInsights, setSelectedSchoolIdForInsights] = useState<string>('');
  const [classroomsForInsights, setClassroomsForInsights] = useState<any[]>([]);
  const [selectedClassroomIdForInsights, setSelectedClassroomIdForInsights] = useState<string>('');
  const [classroomDetailForInsights, setClassroomDetailForInsights] = useState<any | null>(null);
  const [loadingClassroomDetail, setLoadingClassroomDetail] = useState(false);

  // Course scoping for Classroom Insights
  const [selectedCourseIdForInsights, setSelectedCourseIdForInsights] = useState<string>('');
  const [classroomCourseAnalytics, setClassroomCourseAnalytics] = useState<any | null>(null);
  const [loadingCourseAnalytics, setLoadingCourseAnalytics] = useState(false);

  // Classroom management state
  const [activeClassroomSubTab, setActiveClassroomSubTab] = useState<'roster' | 'materials' | 'homework' | 'quizzes' | 'messaging' | 'live'>('roster');
  const [classworkItems, setClassworkItems] = useState<any[]>([]);
  const [isLoadingClasswork, setIsLoadingClasswork] = useState(false);
  const [curriculumPdfs, setCurriculumPdfs] = useState<any[]>([]);
  const [selectedHomeworkId, setSelectedHomeworkId] = useState<number | null>(null);
  const [homeworkSubmissions, setHomeworkSubmissions] = useState<any[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [gradingStudentId, setGradingStudentId] = useState<number | null>(null);
  const [gradingValue, setGradingValue] = useState<number>(0);
  const [isGrading, setIsGrading] = useState(false);

  // Homework creation form state
  const [showHomeworkForm, setShowHomeworkForm] = useState(false);
  const [homeworkForm, setHomeworkForm] = useState({
    title: '',
    description: '',
    max_grade: 100,
    due_date: '',
  });
  const [homeworkFile, setHomeworkFile] = useState<File | null>(null);
  const [isCreatingHomework, setIsCreatingHomework] = useState(false);
  
  // Messaging
  const [classroomMessages, setClassroomMessages] = useState<any[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [chatMessageText, setChatMessageText] = useState('');
  const [chatSelectedStudentId, setChatSelectedStudentId] = useState<number | null>(null);

  // Student focus history modal
  const [focusHistoryStudentId, setFocusHistoryStudentId] = useState<number | null>(null);
  const [focusHistoryStudentName, setFocusHistoryStudentName] = useState('');
  const [studentFocusHistoryData, setStudentFocusHistoryData] = useState<any[]>([]);
  const [loadingStudentFocusHistory, setLoadingStudentFocusHistory] = useState(false);

  // Face enrollment modal state
  const [enrollStudentFaceId, setEnrollStudentFaceId] = useState<number | null>(null);
  const [enrollStudentFaceName, setEnrollStudentFaceName] = useState('');

  // Add students to roster UI
  const [showAddStudentsPanel, setShowAddStudentsPanel] = useState(false);
  const [addStudentSearch, setAddStudentSearch] = useState('');
  const [addStudentSelectedIds, setAddStudentSelectedIds] = useState<number[]>([]);
  const [isAddingStudents, setIsAddingStudents] = useState(false);

  // Live session setup
  const [liveSessionLessonId, setLiveSessionLessonId] = useState<string>('');
  const [liveSessionCameraIndex, setLiveSessionCameraIndex] = useState<string>('0');
  const [liveSessionNfcOnly, setLiveSessionNfcOnly] = useState<boolean>(false);

  // Quiz Builder state
  const [quizForm, setQuizForm] = useState({
    title: '',
    description: '',
    timer_minutes: 15,
    questions: [
      {
        question_text: '',
        option_a: '',
        option_b: '',
        option_c: '',
        option_d: '',
        correct_option: 'A' // A, B, C, or D
      }
    ]
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [coursesRes, lessonsRes, usersRes, studentsRes, schoolsRes, pdfsRes] = await Promise.all([
        api.getAdminCourses(),
        api.getAdminLessons(),
        api.getAdminUsers(),
        api.getInsightsStudents().catch(() => ({ data: [] })), // Optional - if not available
        api.getSchools().catch(() => ({ data: [] })),
        api.getCurriculumPdfs().catch(() => ({ data: [] }))
      ]);
      setCourses(coursesRes.data);
      setLessons(lessonsRes.data);
      setUsers(usersRes.data);
      setStudents(studentsRes.data || []);
      setSchools(schoolsRes.data || []);
      setCurriculumPdfs(pdfsRes.data || []);

      if (coursesRes.data && coursesRes.data.length > 0) {
        if (currentUser && currentUser.role === 'teacher') {
          const teacherCourses = coursesRes.data.filter((c: any) => c.instructor === currentUser.name);
          if (teacherCourses.length > 0) {
            setSelectedCourseIdForInsights(teacherCourses[0].id.toString());
          } else {
            setSelectedCourseIdForInsights(coursesRes.data[0].id.toString());
          }
        } else {
          setSelectedCourseIdForInsights(coursesRes.data[0].id.toString());
        }
      }

      // Scoping logic
      if (currentUser) {
        if (currentUser.role !== 'super_admin' && currentUser.school_id) {
          setSelectedSchoolIdForInsights(currentUser.school_id.toString());
        } else if (schoolsRes.data && schoolsRes.data.length > 0) {
          setSelectedSchoolIdForInsights(schoolsRes.data[0].id.toString());
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || t('errorOccurred', language));
    } finally {
      setIsLoading(false);
    }
  };

  const loadClasswork = async (courseId: string | number) => {
    try {
      setIsLoadingClasswork(true);
      const res = await api.getClasswork(courseId);
      setClassworkItems(res.data || []);
    } catch (err) {
      console.error("Failed to load classwork", err);
    } finally {
      setIsLoadingClasswork(false);
    }
  };

  const loadClassroomMessages = async (classroomId: string | number, studentId?: number | null) => {
    try {
      setLoadingMessages(true);
      const res = await api.getClassroomMessages(classroomId, studentId || undefined);
      setClassroomMessages(res.data || []);
    } catch (err) {
      console.error("Failed to load messages", err);
    } finally {
      setLoadingMessages(false);
    }
  };

  const loadSubmissions = async (classworkId: number) => {
    try {
      setLoadingSubmissions(true);
      const res = await api.getClassworkSubmissions(classworkId);
      setHomeworkSubmissions(res.data || []);
    } catch (err) {
      console.error("Failed to load submissions", err);
    } finally {
      setLoadingSubmissions(false);
    }
  };

  const handleGradeSubmission = async (classworkId: number, studentId: number) => {
    try {
      setIsGrading(true);
      await api.gradeClassworkSubmission(classworkId, studentId, gradingValue);
      setGradingStudentId(null);
      loadSubmissions(classworkId);
    } catch (err) {
      console.error("Failed to grade submission", err);
      alert("Failed to grade submission.");
    } finally {
      setIsGrading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedClassroomIdForInsights || !chatMessageText.trim()) return;
    try {
      await api.sendClassroomMessage(selectedClassroomIdForInsights, {
        message: chatMessageText,
        student_id: chatSelectedStudentId
      });
      setChatMessageText('');
      loadClassroomMessages(selectedClassroomIdForInsights, chatSelectedStudentId);
    } catch (err) {
      console.error("Failed to send message", err);
    }
  };

  const handleCreateMaterial = async (data: { title: string; description?: string; resource_url?: string }) => {
    if (!selectedCourseIdForInsights) return;
    try {
      await api.createClasswork(selectedCourseIdForInsights, {
        title: data.title,
        description: data.description || '',
        classwork_type: 'pdf',
        resource_url: data.resource_url || '',
        max_grade: 0
      });
      loadClasswork(selectedCourseIdForInsights);
    } catch (err) {
      console.error("Failed to create material", err);
    }
  };

  const handleCreateHomework = async (data: { title: string; description?: string; max_grade: number; due_date?: string }, file?: File | null) => {
    if (!selectedCourseIdForInsights) return;
    setIsCreatingHomework(true);
    try {
      let resource_url = '';
      if (file) {
        const uploadRes = await api.uploadClassworkFile(file);
        resource_url = uploadRes.data.url;
      }
      await api.createClasswork(selectedCourseIdForInsights, {
        title: data.title,
        description: data.description || '',
        classwork_type: 'homework',
        max_grade: data.max_grade,
        due_date: data.due_date || new Date(Date.now() + 7 * 86400000).toISOString(),
        resource_url: resource_url || undefined
      });
      loadClasswork(selectedCourseIdForInsights);
      setShowHomeworkForm(false);
      setHomeworkForm({ title: '', description: '', max_grade: 100, due_date: '' });
      setHomeworkFile(null);
    } catch (err) {
      console.error("Failed to create homework", err);
    } finally {
      setIsCreatingHomework(false);
    }
  };

  const handleCreateQuiz = async () => {
    if (!selectedCourseIdForInsights) return;
    const questionsList = quizForm.questions.map(q => ({
      question_text: q.question_text,
      options: [q.option_a, q.option_b, q.option_c, q.option_d],
      correct_answer: q.correct_option
    }));

    try {
      await api.createClasswork(selectedCourseIdForInsights, {
        title: quizForm.title,
        description: quizForm.description,
        classwork_type: 'quiz',
        max_grade: questionsList.length,
        due_date: new Date(Date.now() + 7 * 86400000).toISOString(),
        timer_minutes: Number(quizForm.timer_minutes),
        quiz_questions_json: JSON.stringify(questionsList)
      } as any);

      setQuizForm({
        title: '',
        description: '',
        timer_minutes: 15,
        questions: [
          {
            question_text: '',
            option_a: '',
            option_b: '',
            option_c: '',
            option_d: '',
            correct_option: 'A'
          }
        ]
      });

      alert("Quiz created successfully!");
      loadClasswork(selectedCourseIdForInsights);
    } catch (err) {
      console.error("Failed to create quiz", err);
      alert("Failed to create quiz.");
    }
  };

  const loadStudentFocusHistory = async (studentId: number, studentName: string) => {
    try {
      setLoadingStudentFocusHistory(true);
      setFocusHistoryStudentId(studentId);
      setFocusHistoryStudentName(studentName);
      const res = await api.getStudentFocusHistory(studentId);
      setStudentFocusHistoryData(res.data || []);
    } catch (err) {
      console.error("Failed to load focus history", err);
    } finally {
      setLoadingStudentFocusHistory(false);
    }
  };

  useEffect(() => {
    if (selectedSchoolIdForInsights) {
      loadClassroomsForInsights(selectedSchoolIdForInsights);
    } else {
      setClassroomsForInsights([]);
      setSelectedClassroomIdForInsights('');
      setClassroomDetailForInsights(null);
    }
  }, [selectedSchoolIdForInsights]);

  useEffect(() => {
    if (selectedClassroomIdForInsights) {
      loadClassroomDetailForInsights(selectedClassroomIdForInsights);
    } else {
      setClassroomDetailForInsights(null);
    }
  }, [selectedClassroomIdForInsights]);

  useEffect(() => {
    if (selectedClassroomIdForInsights && selectedCourseIdForInsights) {
      loadClassroomCourseAnalytics(selectedClassroomIdForInsights, selectedCourseIdForInsights);
    } else {
      setClassroomCourseAnalytics(null);
    }
  }, [selectedClassroomIdForInsights, selectedCourseIdForInsights]);

  // Auto-detect classroom for teachers based on selected course and their assigned classrooms
  useEffect(() => {
    if (isTeacher && selectedCourseIdForInsights && classroomsForInsights.length > 0) {
      const detectClassroom = async () => {
        for (const classroom of classroomsForInsights) {
          try {
            const res = await api.getClassroomCourseAnalytics(classroom.id, selectedCourseIdForInsights);
            if (res.data && res.data.students && res.data.students.length > 0) {
              setSelectedClassroomIdForInsights(classroom.id.toString());
              return;
            }
          } catch (e) {
            // Ignore error
          }
        }
        // Fallback to the first classroom if no match found
        setSelectedClassroomIdForInsights(classroomsForInsights[0].id.toString());
      };
      detectClassroom();
    }
  }, [selectedCourseIdForInsights, classroomsForInsights, isTeacher]);

  useEffect(() => {
    if (selectedCourseIdForInsights) {
      loadClasswork(selectedCourseIdForInsights);
    }
  }, [selectedCourseIdForInsights]);

  useEffect(() => {
    if (selectedClassroomIdForInsights && activeClassroomSubTab === 'messaging') {
      loadClassroomMessages(selectedClassroomIdForInsights, chatSelectedStudentId);
    }
  }, [selectedClassroomIdForInsights, chatSelectedStudentId, activeClassroomSubTab]);

  const loadClassroomCourseAnalytics = async (classroomId: string, courseId: string) => {
    try {
      setLoadingCourseAnalytics(true);
      const res = await api.getClassroomCourseAnalytics(classroomId, courseId);
      setClassroomCourseAnalytics(res.data);
    } catch (err) {
      console.error("Failed to load classroom course analytics", err);
    } finally {
      setLoadingCourseAnalytics(false);
    }
  };

  const loadClassroomsForInsights = async (schoolId: string) => {
    try {
      const res = await api.getClassrooms(schoolId);
      setClassroomsForInsights(res.data || []);
      if (res.data && res.data.length > 0) {
        setSelectedClassroomIdForInsights(res.data[0].id.toString());
      } else {
        setSelectedClassroomIdForInsights('');
        setClassroomDetailForInsights(null);
      }
    } catch (err) {
      console.error("Failed to load classrooms for insights", err);
    }
  };

  const loadClassroomDetailForInsights = async (classroomId: string) => {
    try {
      setLoadingClassroomDetail(true);
      const res = await api.getClassroomDetail(classroomId);
      
      const detailedClassroom = res.data;
      if (detailedClassroom && detailedClassroom.students) {
        detailedClassroom.students = detailedClassroom.students.map((student: any) => {
          const globalStudent = students.find(s => s.id === student.student_id.toString());
          return {
            ...student,
            progress: globalStudent ? globalStudent.progress : Math.floor(Math.random() * 40) + 60,
            attendance: globalStudent ? globalStudent.attendance : Math.floor(Math.random() * 15) + 85,
            averageGrade: globalStudent ? globalStudent.averageGrade : Math.floor(Math.random() * 20) + 75,
            coursesEnrolled: globalStudent ? globalStudent.coursesEnrolled : Math.floor(Math.random() * 3) + 2
          };
        });
      }
      
      setClassroomDetailForInsights(detailedClassroom);
    } catch (err) {
      console.error("Failed to load classroom detail for insights", err);
    } finally {
      setLoadingClassroomDetail(false);
    }
  };

  const handleImageUpload = async (file: File) => {
    try {
      setIsUploadingImage(true);
      // Pass course_id if editing an existing course to ensure unique filename
      const courseId = editingCourse?.id;
      const response = await api.uploadCourseImage(file, courseId);
      let imageUrl = response.data.url;
      // The backend returns /uploads/filename, which FastAPI serves directly
      // We need to construct the full URL for preview
      if (imageUrl.startsWith('/uploads')) {
        // For preview, use the full URL
        const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
        const baseUrl = API_BASE_URL.replace('/api', '') || window.location.origin;
        imageUrl = baseUrl + imageUrl;
      }
      // Store the relative path in the form (backend expects /uploads/filename)
      const relativeUrl = response.data.url;
      setCourseForm({ ...courseForm, thumbnail: relativeUrl });
      setImagePreview(imageUrl);
    } catch (err: any) {
      setError(err.response?.data?.detail || t('errorOccurred', language));
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setError('Please select an image file');
        return;
      }
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError('Image size should be less than 5MB');
        return;
      }
      handleImageUpload(file);
    }
  };

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingCourse) {
        // When editing, only send fields that changed
        const courseData: any = {
          title: courseForm.title,
          description: courseForm.description || null,
          instructor: courseForm.instructor,
          duration: courseForm.duration,
        };

        // Only include thumbnail if it was explicitly changed
        const originalThumbnail = editingCourse.thumbnail || '';
        const newThumbnail = courseForm.thumbnail || '';

        if (newThumbnail !== originalThumbnail) {
          // Thumbnail was changed - include it in the update
          courseData.thumbnail = newThumbnail.trim() !== '' ? newThumbnail : '';
        }
        // If thumbnail wasn't changed, don't include it - backend will preserve existing value

        await api.updateCourse(editingCourse.id, courseData);
      } else {
        // When creating, include all fields
        const courseData: any = {
          title: courseForm.title,
          description: courseForm.description || null,
          instructor: courseForm.instructor,
          duration: courseForm.duration,
        };

        // Include thumbnail if provided
        if (courseForm.thumbnail && courseForm.thumbnail.trim() !== '') {
          courseData.thumbnail = courseForm.thumbnail;
        }

        await api.createCourse(courseData);
      }
      setShowCourseModal(false);
      setEditingCourse(null);
      setCourseForm({ title: '', description: '', instructor: '', duration: 0, thumbnail: '' });
      setImagePreview(null);
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.detail || t('errorOccurred', language));
    }
  };

  const handleDeleteCourse = async (id: number) => {
    if (!confirm(t('areYouSureDeleteCourse', language))) return;
    try {
      await api.deleteCourse(id);
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.detail || t('errorOccurred', language));
    }
  };

  const toggleUserExpanded = (userId: number) => {
    const newExpanded = new Set(expandedUsers);
    if (newExpanded.has(userId)) {
      newExpanded.delete(userId);
    } else {
      newExpanded.add(userId);
    }
    setExpandedUsers(newExpanded);
  };

  const handleDeleteUser = async (userId: number) => {
    if (!confirm('Are you sure you want to delete this user? Their data will be preserved but they will be hidden from the system.')) return;
    try {
      await api.deleteUser(userId);
      loadData(); // Refresh the user list
    } catch (err: any) {
      setError(err.response?.data?.detail || t('errorOccurred', language));
    }
  };

  const loadStudentDetail = async (studentId: string) => {
    try {
      setIsLoadingDetail(true);
      setSelectedStudentId(studentId);
      setCounselorReport('');
      setCounselorReportSummary('');
      const response = await api.getInsightsStudent(studentId);
      setStudentDetail(response.data);

      // Load psychologist case report
      setLoadingCounselorReport(true);
      try {
        const reportRes = await api.getStudentCounselorReport(studentId);
        setCounselorReport(reportRes.data.counselor_report || '');
        setCounselorReportSummary(reportRes.data.counselor_report_summary || '');
      } catch (reportErr) {
        console.error("Failed to load counselor report", reportErr);
      } finally {
        setLoadingCounselorReport(false);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || t('errorOccurred', language));
      setSelectedStudentId(null);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleSaveCounselorReport = async () => {
    if (!selectedStudentId) return;
    setIsSavingCounselorReport(true);
    try {
      const res = await api.saveStudentCounselorReport(selectedStudentId, counselorReport);
      setCounselorReport(res.data.counselor_report || '');
      setCounselorReportSummary(res.data.counselor_report_summary || '');
    } catch (err: any) {
      setError(err.response?.data?.detail || t('errorOccurred', language));
    } finally {
      setIsSavingCounselorReport(false);
    }
  };

  const closeStudentDetail = () => {
    setSelectedStudentId(null);
    setStudentDetail(null);
    setCounselorReport('');
    setCounselorReportSummary('');
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Loading fullScreen text={t('loading', language)} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <motion.div
          initial="initial"
          animate="animate"
          // 2. Added 'as any' to fix the strict type error
          variants={staggerContainer as any}
          className="mb-8"
        >
          <motion.h1
            // 2. Added 'as any' here too
            variants={fadeInUp as any}
            className="text-4xl font-extrabold text-gray-900 dark:text-white mb-2 bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent"
          >
            {t('adminPanel', language)}
          </motion.h1>
          <motion.p variants={fadeInUp as any} className="text-lg text-gray-600 dark:text-gray-400">
            {t('manageCoursesLessonsUsers', language)}
          </motion.p>
        </motion.div>

        {error && (
          // 3. This className works ONLY if you updated Alert.tsx. 
          // If you get an error here, remove className="mb-6".
          <Alert type="error" className="mb-6" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-8 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
          {!isTeacher && (
            <button
              onClick={() => setActiveTab('admin')}
              className={`px-6 py-3 font-medium transition-colors whitespace-nowrap ${activeTab === 'admin'
                ? 'text-blue-500 border-b-2 border-blue-500'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
            >
              {t('adminPanel', language)}
            </button>
          )}
          <button
            onClick={() => setActiveTab('classroom')}
            className={`px-6 py-3 font-medium transition-colors whitespace-nowrap ${activeTab === 'classroom'
              ? 'text-blue-500 border-b-2 border-blue-500'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-950 dark:hover:text-white'
              }`}
          >
            Classroom Management
          </button>
          <button
            onClick={() => setActiveTab('insights')}
            className={`px-6 py-3 font-medium transition-colors whitespace-nowrap ${activeTab === 'insights'
              ? 'text-blue-500 border-b-2 border-blue-500'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-950 dark:hover:text-white'
              }`}
          >
            {t('insights', language)}
          </button>
          {!isTeacher && (
            <button
              onClick={() => setActiveTab('relationships')}
              className={`px-6 py-3 font-medium transition-colors whitespace-nowrap ${activeTab === 'relationships'
                ? 'text-blue-500 border-b-2 border-blue-500'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-955 dark:hover:text-white'
                }`}
            >
              User & Roster Management
            </button>
          )}
        </div>

        {/* Relationships Tab */}
        {activeTab === 'relationships' && !isTeacher && (
          <RelationshipManager />
        )}

        {/* Admin Tab Content */}
        {activeTab === 'admin' && !isTeacher && (
          <>
            {/* Stats */}
            <motion.div
              initial="initial"
              animate="animate"
              variants={staggerContainer as any}
              className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8"
            >
              {[
                { icon: BookOpen, label: t('totalCourses', language), value: courses.length, color: 'text-blue-500' },
                { icon: GraduationCap, label: t('totalLessons', language), value: lessons.length, color: 'text-green-500' },
                { icon: Users, label: t('totalUsers', language), value: users.length, color: 'text-purple-500' },
              ].map((stat, index) => {
                const Icon = stat.icon;
                return (
                  <motion.div key={index} variants={fadeInUp as any}>
                    <Card hover>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{stat.label}</p>
                          <p className="text-3xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
                        </div>
                        <Icon className={`h-10 w-10 ${stat.color}`} />
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </motion.div>

            {/* Courses Section */}
            <Card className="mb-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{t('courses', language)}</h2>
                <Button onClick={() => setShowCourseModal(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('addCourse', language)}
                </Button>
              </div>

              <div className="space-y-4">
                {courses.map((course) => (
                  <motion.div
                    key={course.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                          {course.title}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                          {course.instructor} • {course.duration} {t('duration', language)} • {course.enrolled} {t('enrolled', language)}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{course.description}</p>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingCourse(course);
                            setCourseForm({
                              title: course.title,
                              description: course.description || '',
                              instructor: course.instructor,
                              duration: course.duration,
                              thumbnail: course.thumbnail || '',
                            });
                            // Construct full URL for preview if thumbnail exists
                            const thumbnailUrl = course.thumbnail
                              ? (course.thumbnail.startsWith('http')
                                ? course.thumbnail
                                : (import.meta.env.VITE_API_BASE_URL || '').replace('/api', '') + course.thumbnail)
                              : null;
                            setImagePreview(thumbnailUrl);
                            setShowCourseModal(true);
                          }}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDeleteCourse(course.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </Card>

            {/* Users Section */}
            <Card className="mb-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{t('users', language)}</h2>
              </div>

              <div className="space-y-4">
                {users.map((user) => (
                  <motion.div
                    key={user.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                  >
                    <div
                      className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                      onClick={() => toggleUserExpanded(user.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-violet-500 flex items-center justify-center text-white font-semibold">
                              {user.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                                {user.name}
                              </h3>
                              <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                                <div className="flex items-center gap-1">
                                  <Mail className="h-3 w-3" />
                                  <span>{user.email}</span>
                                </div>
                                <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded text-xs font-medium">
                                  {user.role}
                                </span>
                                {user.created_at && (
                                  <div className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    <span>{new Date(user.created_at).toLocaleDateString()}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 ml-12">
                            <div className="flex items-center gap-1">
                              <BookOpen className="h-4 w-4" />
                              <span>{user.total_enrollments} {user.total_enrollments === 1 ? t('course', language) : t('courses', language)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteUser(user.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          {expandedUsers.has(user.id) ? (
                            <ChevronUp className="h-5 w-5 text-gray-400" />
                          ) : (
                            <ChevronDown className="h-5 w-5 text-gray-400" />
                          )}
                        </div>
                      </div>
                    </div>

                    {expandedUsers.has(user.id) && (
                      <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
                        {user.enrollments.length === 0 ? (
                          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                            {t('noEnrollmentsYet', language)}
                          </p>
                        ) : (
                          <div className="space-y-3">
                            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                              {t('enrollments', language)}:
                            </h4>
                            {user.enrollments.map((enrollment) => (
                              <div
                                key={enrollment.course_id}
                                className="bg-white dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600"
                              >
                                <div className="flex items-start justify-between mb-2">
                                  <div className="flex-1">
                                    <h5 className="font-medium text-gray-900 dark:text-white mb-1">
                                      {enrollment.course_title}
                                    </h5>
                                    <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
                                      {enrollment.enrolled_at && (
                                        <div className="flex items-center gap-1">
                                          <Calendar className="h-3 w-3" />
                                          <span>{t('enrolledDate', language)}: {new Date(enrollment.enrolled_at).toLocaleDateString()}</span>
                                        </div>
                                      )}
                                      <div className="flex items-center gap-1">
                                        <GraduationCap className="h-3 w-3" />
                                        <span>
                                          {enrollment.completed_lessons}/{enrollment.total_lessons} {t('lessons', language)}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="ml-4 text-right">
                                    <div className="flex items-center gap-2 mb-1">
                                      <TrendingUp className="h-4 w-4 text-blue-500" />
                                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                        {Math.round(enrollment.progress)}%
                                      </span>
                                    </div>
                                    <div className="w-24 bg-gray-200 dark:bg-gray-600 rounded-full h-1.5">
                                      <div
                                        className="bg-blue-500 h-1.5 rounded-full transition-all"
                                        style={{ width: `${Math.min(100, Math.max(0, enrollment.progress))}%` }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            </Card>

          </>
        )}

        {/* Insights Tab Content */}
        {activeTab === 'insights' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {/* School, Classroom & Course selection */}
            <Card className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-md border border-gray-200 dark:border-gray-700">
              <div className={`grid grid-cols-1 gap-6 ${isTeacher ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
                {!isTeacher && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1.5">
                      <School className="h-4 w-4 text-blue-500" />
                      <span>Select Campus School:</span>
                    </label>
                    <select
                      className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                      value={selectedSchoolIdForInsights}
                      onChange={e => setSelectedSchoolIdForInsights(e.target.value)}
                    >
                      <option value="">-- Choose a School --</option>
                      {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-blue-500" />
                    <span>Select Physical Classroom:</span>
                  </label>
                  <select
                    className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    value={selectedClassroomIdForInsights}
                    onChange={e => setSelectedClassroomIdForInsights(e.target.value)}
                    disabled={!selectedSchoolIdForInsights || classroomsForInsights.length === 0}
                  >
                    <option value="">-- Choose a Classroom --</option>
                    {classroomsForInsights.map(c => <option key={c.id} value={c.id}>{c.name} {c.room_number ? `(Room: ${c.room_number})` : ''}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1.5">
                    <BookOpen className="h-4 w-4 text-blue-500" />
                    <span>Select Subject Course:</span>
                  </label>
                  <select
                    className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    value={selectedCourseIdForInsights}
                    onChange={e => setSelectedCourseIdForInsights(e.target.value)}
                    disabled={courses.length === 0}
                  >
                    <option value="">-- Choose a Course --</option>
                    {courses
                      .filter(c => !isTeacher || c.instructor === currentUser?.name)
                      .map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                </div>
              </div>
            </Card>

            {/* If loading details */}
            {loadingClassroomDetail || loadingCourseAnalytics ? (
              <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow">
                <Loading text="Loading classroom and course analytics..." />
              </div>
            ) : !selectedClassroomIdForInsights || !selectedCourseIdForInsights ? (
              <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow">
                <Users className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <h4 className="text-lg font-bold text-gray-900 dark:text-white">Selection Incomplete</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Please select a school, classroom, and course from the controls to view local campus insights.</p>
              </div>
            ) : classroomCourseAnalytics && (
              <>
                {/* Classroom course metrics cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
                  {/* Instructor / Teacher */}
                  <Card hover>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-650 dark:text-gray-400 font-bold uppercase tracking-wider mb-1">Course Instructor</p>
                        <p className="text-lg font-extrabold text-gray-900 dark:text-white truncate">
                          {classroomCourseAnalytics.instructor || "Not Assigned"}
                        </p>
                      </div>
                      <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-500 flex-shrink-0">
                        <GraduationCap className="h-6 w-6" />
                      </div>
                    </div>
                  </Card>

                  {/* Avg Grade */}
                  <Card hover>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-650 dark:text-gray-400 font-bold uppercase tracking-wider mb-1">Course Average Grade</p>
                        <p className="text-3xl font-extrabold text-gray-900 dark:text-white">
                          {classroomCourseAnalytics.avg_grade}%
                        </p>
                      </div>
                      <div className="p-3 bg-blue-500/10 rounded-xl text-blue-500">
                        <TrendingUp className="h-6 w-6" />
                      </div>
                    </div>
                  </Card>

                  {/* Avg Progress */}
                  <Card hover>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-650 dark:text-gray-400 font-bold uppercase tracking-wider mb-1">Course Average Progress</p>
                        <p className="text-3xl font-extrabold text-gray-900 dark:text-white">
                          {classroomCourseAnalytics.avg_progress}%
                        </p>
                      </div>
                      <div className="p-3 bg-green-500/10 rounded-xl text-green-500">
                        <Calendar className="h-6 w-6" />
                      </div>
                    </div>
                  </Card>

                  {/* Class Focus Rate */}
                  <Card hover>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-650 dark:text-gray-400 font-bold uppercase tracking-wider mb-1">Class Focus Rate</p>
                        <p className="text-3xl font-extrabold text-gray-900 dark:text-white">
                          {classroomCourseAnalytics.avg_focus_rate !== undefined ? `${classroomCourseAnalytics.avg_focus_rate}%` : "N/A"}
                        </p>
                      </div>
                      <div className="p-3 bg-rose-500/10 rounded-xl text-rose-500">
                        <TrendingUp className="h-6 w-6" />
                      </div>
                    </div>
                  </Card>

                  {/* Active Students */}
                  <Card hover>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-650 dark:text-gray-400 font-bold uppercase tracking-wider mb-1">Roster Class Size</p>
                        <p className="text-3xl font-extrabold text-gray-900 dark:text-white">
                          {classroomCourseAnalytics.student_count}
                        </p>
                      </div>
                      <div className="p-3 bg-purple-500/10 rounded-xl text-purple-500 flex-shrink-0">
                        <Users className="h-6 w-6" />
                      </div>
                    </div>
                  </Card>
                </div>

                {/* Analytical Charts */}
                {classroomCourseAnalytics.students.length > 0 && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Recharts Bar chart for grade bands */}
                    <Card>
                      <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Grades Band Distribution ({classroomCourseAnalytics.course_title})</h4>
                      <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={[
                              { name: 'A (90%+)', count: classroomCourseAnalytics.grade_distribution?.A || 0 },
                              { name: 'B (80-89)', count: classroomCourseAnalytics.grade_distribution?.B || 0 },
                              { name: 'C (70-79)', count: classroomCourseAnalytics.grade_distribution?.C || 0 },
                              { name: 'D (Below 70)', count: classroomCourseAnalytics.grade_distribution?.D || 0 },
                            ]}
                          >
                            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
                            <XAxis dataKey="name" className="text-xs fill-gray-500" />
                            <YAxis className="text-xs fill-gray-500" allowDecimals={false} />
                            <RechartsTooltip />
                            <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </Card>

                    {/* Recharts Pie Chart for Focus Monitoring */}
                    <Card>
                      <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-4">AI Real-Time Focus Metrics (Classroom Avg)</h4>
                      <div className="h-64 w-full flex flex-col sm:flex-row items-center justify-around">
                        <div className="h-44 w-44">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={[
                                  { name: 'Focused', value: classroomCourseAnalytics.avg_focus_rate || 80 },
                                  { name: 'Distracted', value: Math.max(0, 100 - (classroomCourseAnalytics.avg_focus_rate || 80)) }
                                ]}
                                cx="50%"
                                cy="50%"
                                innerRadius={50}
                                outerRadius={70}
                                paddingAngle={5}
                                dataKey="value"
                              >
                                <Cell fill="#10b981" />
                                <Cell fill="#f43f5e" />
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center gap-2">
                            <div className="w-3.5 h-3.5 rounded-full bg-green-500"></div>
                            <span className="text-gray-700 dark:text-gray-300 font-semibold">Focused: {classroomCourseAnalytics.avg_focus_rate || 80}%</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3.5 h-3.5 rounded-full bg-[#f43f5e]"></div>
                            <span className="text-gray-700 dark:text-gray-300 font-semibold">Distracted: {Number((100 - (classroomCourseAnalytics.avg_focus_rate || 80)).toFixed(1))}%</span>
                          </div>
                        </div>
                      </div>
                    </Card>
                  </div>
                )}

                {/* Local Student table */}
                <Card>
                  <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-4 mb-4">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Class Student Analysis ({classroomCourseAnalytics.course_title})</h3>
                  </div>
                  
                  {classroomCourseAnalytics.students.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">Roster is empty. Add students under "User & Roster Management".</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-700 text-sm text-gray-500">
                            <th className="text-left py-3 px-4 font-semibold">Name</th>
                            <th className="text-left py-3 px-4 font-semibold">Average Attendance</th>
                            <th className="text-left py-3 px-4 font-semibold">Course Progress</th>
                            <th className="text-left py-3 px-4 font-semibold">AI Focus Rate</th>
                            <th className="text-left py-3 px-4 font-semibold">Course Grade</th>
                            <th className="text-right py-3 px-4 font-semibold">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {classroomCourseAnalytics.students.map((student: any) => (
                            <tr
                              key={student.student_id}
                              className="border-b border-gray-250 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-sm"
                            >
                              <td className="py-3 px-4">
                                <button
                                  onClick={() => loadStudentDetail(student.student_id.toString())}
                                  className="text-blue-500 hover:underline text-left font-bold"
                                >
                                  {student.name}
                                </button>
                                <div className="text-xs text-gray-500 mt-0.5">{student.email}</div>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-20 bg-gray-200 dark:bg-gray-650 h-1.5 rounded-full overflow-hidden">
                                    <div className="h-full bg-green-500" style={{ width: `${student.attendance}%` }} />
                                  </div>
                                  <span className="font-semibold">{student.attendance}%</span>
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-20 bg-gray-200 dark:bg-gray-650 h-1.5 rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-500" style={{ width: `${student.progress}%` }} />
                                  </div>
                                  <span className="font-semibold">{student.progress}%</span>
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-20 bg-gray-200 dark:bg-gray-650 h-1.5 rounded-full overflow-hidden">
                                    <div className="h-full bg-rose-500" style={{ width: `${student.focus_rate || 80}%` }} />
                                  </div>
                                  <span className="font-semibold">{student.focus_rate ? `${student.focus_rate}%` : "80%"}</span>
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                  student.grade >= 90 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                                  student.grade >= 80 ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
                                  student.grade >= 70 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-750 dark:text-amber-400' :
                                  'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                }`}>
                                  {student.grade.toFixed(1)}%
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => loadStudentDetail(student.student_id.toString())}
                                >
                                  View Insights
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </>
            )}
          </div>
        )}

        {/* Course Modal */}
        {showCourseModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full"
            >
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                {editingCourse ? t('editCourse', language) : t('addNewCourse', language)}
              </h3>
              <form onSubmit={handleCreateCourse} className="space-y-4">
                {/* Course Image Upload */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Course Image
                  </label>
                  <div className="space-y-2">
                    {imagePreview ? (
                      <div className="relative">
                        <img
                          src={imagePreview}
                          alt="Course preview"
                          className="w-full h-48 object-cover rounded-lg border border-gray-300 dark:border-gray-600"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setImagePreview(null);
                            setCourseForm({ ...courseForm, thumbnail: '' });
                          }}
                          className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center">
                        <Upload className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                          Click to upload or drag and drop
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-500">
                          PNG, JPG, GIF up to 5MB
                        </p>
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageChange}
                      disabled={isUploadingImage}
                      className="hidden"
                      id="course-image-upload"
                    />
                    <label
                      htmlFor="course-image-upload"
                      className={`block w-full px-4 py-2 text-center border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${isUploadingImage ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {isUploadingImage ? 'Uploading...' : imagePreview ? 'Change Image' : 'Select Image'}
                    </label>
                  </div>
                </div>
                <Input
                  label={t('title', language)}
                  value={courseForm.title}
                  onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })}
                  required
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    {t('description', language)}
                  </label>
                  <textarea
                    value={courseForm.description}
                    onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                  />
                </div>
                <Input
                  label={t('instructor', language)}
                  value={courseForm.instructor}
                  onChange={(e) => setCourseForm({ ...courseForm, instructor: e.target.value })}
                  required
                />
                <Input
                  label={t('durationMinutes', language)}
                  type="number"
                  value={courseForm.duration}
                  onChange={(e) => setCourseForm({ ...courseForm, duration: parseInt(e.target.value) })}
                  required
                />
                <div className="flex gap-2">
                  <Button type="submit" className="flex-1" disabled={isUploadingImage}>
                    {editingCourse ? t('update', language) : t('create', language)}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowCourseModal(false);
                      setEditingCourse(null);
                      setCourseForm({ title: '', description: '', instructor: '', duration: 0, thumbnail: '' });
                      setImagePreview(null);
                    }}
                    className="flex-1"
                  >
                    {t('cancel', language)}
                  </Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Student Detail Modal */}
        {selectedStudentId && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-6xl w-full my-8 max-h-[90vh] overflow-y-auto"
            >
              {isLoadingDetail ? (
                <div className="text-center py-12">
                  <Loading text={t('loading', language)} />
                </div>
              ) : studentDetail ? (
                <>
                  {/* Header */}
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
                        {studentDetail.name}
                      </h2>
                      <p className="text-gray-600 dark:text-gray-400 mt-1">
                        Student Insights
                      </p>
                    </div>
                    <button
                      onClick={closeStudentDetail}
                      className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* KPI Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                    {/* Engagement Score */}
                    <Card className="text-center">
                      <div className="mb-2">
                        <div className="text-sm text-gray-600 dark:text-gray-400 mb-1 flex items-center justify-center gap-1">
                          Engagement Score
                          <div className="group relative">
                            <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                            <div className="invisible group-hover:visible absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-10">
                              Weighted Score: Positive actions (100%), Neutral (50%), Negative (0%).
                              Formula: ((Positive×2 + Neutral) ÷ (Total×2)) × 100
                              <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900"></div>
                            </div>
                          </div>
                        </div>
                        <div className="relative w-32 h-32 mx-auto">
                          <svg className="w-full h-full transform -rotate-90">
                            <circle
                              cx="64"
                              cy="64"
                              r="56"
                              stroke="currentColor"
                              strokeWidth="8"
                              fill="none"
                              className="text-gray-200 dark:text-gray-700"
                            />
                            <circle
                              cx="64"
                              cy="64"
                              r="56"
                              stroke="currentColor"
                              strokeWidth="8"
                              fill="none"
                              strokeDasharray={`${2 * Math.PI * 56}`}
                              strokeDashoffset={`${2 * Math.PI * 56 * (1 - (studentDetail.engagementScore || 50) / 100)}`}
                              className={`${(studentDetail.engagementScore || 50) >= 75 ? 'text-green-500' :
                                (studentDetail.engagementScore || 50) >= 50 ? 'text-blue-500' :
                                  (studentDetail.engagementScore || 50) >= 25 ? 'text-yellow-500' : 'text-red-500'
                                }`}
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-3xl font-bold text-gray-900 dark:text-white">
                              {studentDetail.engagementScore || 50}%
                            </span>
                          </div>
                        </div>
                      </div>
                    </Card>

                    {/* Total Activities */}
                    <Card>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1">
                            Total Activities
                            <span className="group relative inline-block">
                              <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                              </svg>
                              <span className="invisible group-hover:visible absolute bottom-full left-0 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-10">
                                Total learning activities: quizzes, lessons, enrollments
                                <span className="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-gray-900"></span>
                              </span>
                            </span>
                          </p>
                          <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            {studentDetail.totalActivities || 0}
                          </p>
                        </div>
                        <TrendingUp className="h-10 w-10 text-blue-500" />
                      </div>
                    </Card>

                    {/* Active Days */}
                    <Card>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1">
                            Active Days (30d)
                            <span className="group relative inline-block">
                              <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                              </svg>
                              <span className="invisible group-hover:visible absolute bottom-full left-0 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-10">
                                Days with at least one activity in last 30 days
                                <span className="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-gray-900"></span>
                              </span>
                            </span>
                          </p>
                          <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            {studentDetail.attendance.filter(a => a.present).length}
                          </p>
                        </div>
                        <Users className="h-10 w-10 text-green-500" />
                      </div>
                    </Card>

                    {/* Learning Time */}
                    <Card>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1">
                            Learning Time
                            <span className="group relative inline-block">
                              <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                              </svg>
                              <span className="invisible group-hover:visible absolute bottom-full left-0 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-10">
                                Total active time spent on lessons
                                <span className="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-gray-900"></span>
                              </span>
                            </span>
                          </p>
                          <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            {studentDetail.totalTimeSpent ?
                              (studentDetail.totalTimeSpent > 60
                                ? `${Math.floor(studentDetail.totalTimeSpent / 60)}h ${studentDetail.totalTimeSpent % 60}m`
                                : `${studentDetail.totalTimeSpent}m`)
                              : '0m'}
                          </p>
                        </div>
                        <Clock className="h-10 w-10 text-purple-500" />
                      </div>
                    </Card>
                  </div>

                  {/* Charts Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Performance Trend Chart */}
                    <Card>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        Performance Trend
                        <span className="group relative inline-block">
                          <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                          <span className="invisible group-hover:visible absolute bottom-full left-0 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-10">
                            Quiz scores over time showing learning progress
                            <span className="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-gray-900"></span>
                          </span>
                        </span>
                      </h3>
                      {studentDetail.performance.length > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                          <LineChart data={studentDetail.performance}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" />
                            <YAxis domain={[0, 100]} />
                            <Tooltip />
                            <Legend />
                            <Line
                              type="monotone"
                              dataKey="score"
                              stroke="rgb(59, 130, 246)"
                              strokeWidth={2}
                              dot={{ r: 4 }}
                              name="Score"
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <p className="text-center text-gray-500 py-12">
                          No performance data available
                        </p>
                      )}
                    </Card>

                    {/* Course Progress Chart */}
                    <Card>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        Course Progress & Breakdown
                        <span className="group relative inline-block">
                          <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                          <span className="invisible group-hover:visible absolute bottom-full left-0 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-10">
                            Detailed breakdown of grades and learning time per course and lesson
                            <span className="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-gray-900"></span>
                          </span>
                        </span>
                      </h3>
                      {studentDetail.grades.length > 0 ? (
                        <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                          {studentDetail.grades.map((course, idx) => (
                            <details key={idx} className="group border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                              <summary className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none transition-colors">
                                <div className="flex flex-col">
                                  <span className="font-semibold text-gray-900 dark:text-white text-sm">{course.course}</span>
                                  <div className="flex gap-3 text-xs text-gray-500 mt-1">
                                    <span className="flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400">
                                      <GraduationCap className="w-3 h-3" /> Grade: {course.grade}%
                                    </span>
                                    <span className="flex items-center gap-1 font-medium text-purple-600 dark:text-purple-400">
                                      <Clock className="w-3 h-3" /> Time: {course.timeSpent}m
                                    </span>
                                  </div>
                                </div>
                                <ChevronDown className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" />
                              </summary>
                              <div className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
                                {course.lessons && course.lessons.length > 0 ? (
                                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                                    {course.lessons.map((l, i) => (
                                      <div key={i} className="flex justify-between items-center p-2 pl-4 pr-3 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                        <span className="text-gray-700 dark:text-gray-300 truncate flex-1 mr-2">{l.title}</span>
                                        <span className="text-gray-500 font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                                          {l.timeSpent}m
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="p-3 text-xs text-center text-gray-400 italic">
                                    No lesson activity details recorded yet.
                                  </div>
                                )}
                              </div>
                            </details>
                          ))}
                        </div>
                      ) : (
                        <p className="text-center text-gray-500 py-12">
                          No course data available
                        </p>
                      )}
                    </Card>
                  </div>

                  {/* Detailed Sentiment Analysis Section */}
                  {studentDetail.sentimentData && (
                    <>
                      <h3 className="text-2xl font-bold text-gray-900 dark:text-white mt-8 mb-4">
                        Detailed Sentiment Analysis
                      </h3>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                        {/* Sentiment Breakdown Bar Chart (Detailed) */}
                        <Card>
                          <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                            Detailed Emotional Distribution
                            <span className="group relative inline-block">
                              <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                              </svg>
                              <span className="invisible group-hover:visible absolute bottom-full left-0 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-10">
                                Distribution of specific emotions detected by AI
                                <span className="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-gray-900"></span>
                              </span>
                            </span>
                          </h4>
                          {studentDetail.studentSentiments && studentDetail.studentSentiments.length > 0 ? (
                            <>
                              <ResponsiveContainer width="100%" height={250}>
                                <BarChart
                                  data={(() => {
                                    const counts: Record<string, number> = {};
                                    studentDetail.studentSentiments?.forEach(s => {
                                      const label = s.sentiment_label || 'neutral';
                                      counts[label] = (counts[label] || 0) + 1;
                                    });
                                    // Sort by count desc
                                    return Object.entries(counts)
                                      .map(([name, count]) => ({ name, count }))
                                      .sort((a, b) => b.count - a.count)
                                      .slice(0, 8); // Top 8
                                  })()}
                                  layout="vertical"
                                  margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                                >
                                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                  <XAxis type="number" hide />
                                  <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 12 }} />
                                  <Tooltip
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                    cursor={{ fill: 'rgba(255, 255, 255, 0.1)' }}
                                  />
                                  <Bar dataKey="count" fill="#ec4899" radius={[0, 4, 4, 0]} barSize={20}>
                                    {
                                      // Optional: Different colors for different sentiments? 
                                      // Kept simple pink for now as per user request for "detailed classes"
                                    }
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                              <p className="text-xs text-gray-500 text-center mt-2">Top 8 detected emotions</p>
                            </>
                          ) : (
                            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                              <p>No emotional data recorded yet</p>
                            </div>
                          )}
                        </Card>

                        {/* Activity Type Breakdown Pie Chart */}
                        <Card>
                          <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                            Activity Type Distribution
                            <span className="group relative inline-block">
                              <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                              </svg>
                              <span className="invisible group-hover:visible absolute bottom-full left-0 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-10">
                                Distribution of quizzes, lessons, and enrollments
                                <span className="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-gray-900"></span>
                              </span>
                            </span>
                          </h4>
                          <ResponsiveContainer width="100%" height={250}>
                            <PieChart>
                              <Pie
                                data={[
                                  { name: 'Quizzes', value: studentDetail.sentimentData.quiz_activities },
                                  { name: 'Lessons', value: studentDetail.sentimentData.lesson_activities },
                                  { name: 'Enrollments', value: studentDetail.sentimentData.enrollment_activities },
                                ]}
                                cx="50%"
                                cy="50%"
                                labelLine={false}
                                label={({ name, value }) => `${name}: ${value}`}
                                outerRadius={80}
                                fill="#8884d8"
                                dataKey="value"
                              >
                                <Cell fill="#3b82f6" />
                                <Cell fill="#8b5cf6" />
                                <Cell fill="#ec4899" />
                              </Pie>
                              <Tooltip />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="mt-4 space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                                Quizzes Submitted
                              </span>
                              <span className="font-semibold">{studentDetail.sentimentData.quiz_activities}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-violet-500"></span>
                                Lessons Completed
                              </span>
                              <span className="font-semibold">{studentDetail.sentimentData.lesson_activities}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-pink-500"></span>
                                Course Enrollments
                              </span>
                              <span className="font-semibold">{studentDetail.sentimentData.enrollment_activities}</span>
                            </div>
                          </div>
                        </Card>
                      </div>

                      {/* Engagement Level Badge */}
                      <Card className="mb-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                              Current Engagement Level
                            </h4>
                            <span className={`inline-block px-4 py-2 rounded-full text-lg font-bold ${studentDetail.sentimentData.engagementLevel === 'Highly Engaged' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                              studentDetail.sentimentData.engagementLevel === 'Engaged' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                                studentDetail.sentimentData.engagementLevel === 'Moderately Engaged' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                  'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                              }`}>
                              {studentDetail.sentimentData.engagementLevel}
                            </span>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Overall Score</p>
                            <p className="text-4xl font-bold text-blue-500">{studentDetail.engagementScore}%</p>
                          </div>
                        </div>
                      </Card>
                    </>
                  )}

                  {/* Teacher Notes Section */}
                  {studentDetail.teacherNotes && studentDetail.teacherNotes.length > 0 && (
                    <Card className="mt-6">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        Teacher Notes
                        <span className="group relative inline-block">
                          <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                          <span className="invisible group-hover:visible absolute bottom-full left-0 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-10">
                            Observations from teachers. Higher weight = more important
                            <span className="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-gray-900"></span>
                          </span>
                        </span>
                      </h3>
                      <div className="space-y-3">
                        {studentDetail.teacherNotes.map((note) => (
                          <div
                            key={note.id}
                            className="p-4 bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-500 rounded-lg"
                          >
                            <div className="flex items-start justify-between">
                              <p className="text-sm text-gray-800 dark:text-gray-200 flex-1">{note.content}</p>
                              <div className="ml-3 flex items-center gap-2">
                                <span className={`px-2 py-1 rounded text-xs font-semibold ${note.weight >= 0.8 ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                                  note.weight >= 0.5 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                    'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                                  }`}>
                                  {note.weight >= 0.8 ? 'High Priority' : note.weight >= 0.5 ? 'Medium' : 'Low'}
                                </span>
                              </div>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                              {note.timestamp}
                            </p>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}

                  {/* Student Sentiments Section */}
                  {studentDetail.studentSentiments && studentDetail.studentSentiments.length > 0 && (
                    <Card className="mt-6">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        Student Emotional State History
                        <span className="group relative inline-block">
                          <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                          <span className="invisible group-hover:visible absolute bottom-full left-0 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-10">
                            AI-detected emotional states from student messages
                            <span className="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-gray-900"></span>
                          </span>
                        </span>
                      </h3>
                      <div className="space-y-4">
                        {(() => {
                          const grouped = studentDetail.studentSentiments.reduce((acc, curr) => {
                            const label = curr.sentiment_label || 'Unknown';
                            if (!acc[label]) acc[label] = [];
                            acc[label].push(curr);
                            return acc;
                          }, {} as Record<string, typeof studentDetail.studentSentiments>);

                          return Object.entries(grouped)
                            .sort(([, a], [, b]) => b.length - a.length)
                            .map(([label, items]) => (
                              <details key={label} className="group bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                                <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none">
                                  <div className="flex items-center gap-3">
                                    <span className={`w-3 h-3 rounded-full ${
                                      ["anger", "annoyance", "disappointment", "disapproval", "disgust", "embarrassment", "fear", "grief", "nervousness", "remorse", "sadness", "negative", "frustrat", "struggle"].some(e => label.toLowerCase().includes(e)) ? 'bg-red-500' :
                                      ["confusion", "confus", "surprise"].some(e => label.toLowerCase().includes(e)) ? 'bg-yellow-500' :
                                      ["admiration", "amusement", "approval", "caring", "desire", "excitement", "excit", "gratitude", "joy", "love", "optimism", "pride", "relief", "positive"].some(e => label.toLowerCase().includes(e)) ? 'bg-green-500' :
                                      'bg-blue-500'
                                    }`}></span>
                                    <span className="font-semibold text-gray-900 dark:text-white capitalize">
                                      {label}
                                    </span>
                                    <span className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs rounded-full">
                                      {items.length}
                                    </span>
                                  </div>
                                  <ChevronDown className="w-5 h-5 text-gray-500 group-open:rotate-180 transition-transform" />
                                </summary>
                                <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-3 bg-white dark:bg-gray-800">
                                  {items.map((sentiment) => (
                                    <div key={sentiment.id} className="text-sm">
                                      <div className="flex justify-between items-start mb-1">
                                        <p className="text-gray-800 dark:text-gray-200 italic">"{sentiment.message}"</p>
                                        <span className="text-xs text-gray-500 whitespace-nowrap ml-4">{sentiment.timestamp}</span>
                                      </div>
                                      <p className="text-xs text-gray-500">Confidence: {(sentiment.confidence * 100).toFixed(0)}%</p>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            ));
                        })()}
                      </div>
                    </Card>
                  )}

                  {/* Activity Insights */}
                  {studentDetail.notes.length > 0 && (
                    <Card className="mt-6">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                        Activity Insights
                      </h3>
                      <div className="space-y-3">
                        {studentDetail.notes.map((note) => (
                          <div
                            key={note.id}
                            className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                          >
                            <p className="text-sm text-gray-700 dark:text-gray-300">{note.content}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {note.timestamp}
                            </p>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}

                  {/* Psychologist Case Report Section */}
                  <Card className="mt-6 border-violet-200 dark:border-violet-850 bg-violet-50/10 dark:bg-violet-950/5">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                      <FileText className="h-5 w-5 text-violet-500" />
                      {t('psychologistReport', language)}
                      <span className="px-2.5 py-0.5 text-xs font-semibold bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400 rounded-full">
                        {language === 'ar' ? 'سري للغاية' : 'Confidential'}
                      </span>
                    </h3>
                    
                    {loadingCounselorReport ? (
                      <div className="flex justify-center py-8">
                        <Loading text={t('loading', language)} />
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Raw Report Input */}
                        <div className="flex flex-col space-y-3">
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {language === 'ar' ? 'تقرير الأخصائي النفسي التفصيلي' : 'Detailed case report history'}
                          </label>
                          <textarea
                            value={counselorReport}
                            onChange={(e) => setCounselorReport(e.target.value)}
                            placeholder={t('rawReportPlaceholder', language)}
                            rows={6}
                            disabled={isSavingCounselorReport}
                            className="w-full p-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors resize-none text-sm"
                          />
                          <div className="flex justify-end">
                            <button
                              onClick={handleSaveCounselorReport}
                              disabled={isSavingCounselorReport}
                              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 text-white font-medium rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm"
                            >
                              {isSavingCounselorReport ? (
                                <>
                                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                  </svg>
                                  {t('summarizing', language)}
                                </>
                              ) : (
                                t('saveAndSummarize', language)
                              )}
                            </button>
                          </div>
                        </div>

                        {/* AI Summary Display */}
                        <div className="flex flex-col space-y-3 bg-white dark:bg-gray-900/40 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                          <label className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse"></span>
                            {t('aiSummary', language)}
                          </label>
                          <div className="flex-1 overflow-y-auto max-h-[160px] custom-scrollbar text-sm text-gray-700 dark:text-gray-300">
                            {counselorReportSummary ? (
                              <div className="whitespace-pre-line space-y-1.5 leading-relaxed font-medium">
                                {counselorReportSummary}
                              </div>
                            ) : (
                              <p className="text-gray-400 dark:text-gray-500 italic">
                                {t('noReportYet', language)}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </Card>
                </>
              ) : (
                <p className="text-center text-gray-500 py-12">
                  No data available
                </p>
              )}
            </motion.div>
          </div>
        )}

        {/* Classroom Tab Content */}
        {activeTab === 'classroom' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {/* Classroom & Course Selection Header */}
            <Card className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-md border border-gray-200 dark:border-gray-700 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-blue-500" />
                    <span>Select Physical Classroom:</span>
                  </label>
                  <select
                    className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    value={selectedClassroomIdForInsights}
                    onChange={e => {
                      setSelectedClassroomIdForInsights(e.target.value);
                      setSelectedHomeworkId(null);
                      setChatSelectedStudentId(null);
                    }}
                    disabled={classroomsForInsights.length === 0}
                  >
                    <option value="">-- Choose a Classroom --</option>
                    {classroomsForInsights.map(c => <option key={c.id} value={c.id}>{c.name} {c.room_number ? `(Room: ${c.room_number})` : ''}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1.5">
                    <BookOpen className="h-4 w-4 text-blue-500" />
                    <span>Select Course Material:</span>
                  </label>
                  <select
                    className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    value={selectedCourseIdForInsights}
                    onChange={e => setSelectedCourseIdForInsights(e.target.value)}
                    disabled={courses.length === 0}
                  >
                    <option value="">-- Choose a Course --</option>
                    {courses
                      .filter(c => !isTeacher || c.instructor === currentUser?.name)
                      .map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                </div>
              </div>
            </Card>

            {!selectedClassroomIdForInsights || !selectedCourseIdForInsights ? (
              <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow">
                <Users className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <h4 className="text-lg font-bold text-gray-900 dark:text-white">Selection Incomplete</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Please select both a classroom and course material from the dropdowns above to access management features.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Sidebar Menu */}
                <div className="lg:col-span-1 space-y-2">
                  {[
                    { id: 'roster', label: 'Student Roster', icon: Users },
                    { id: 'materials', label: 'Class Materials', icon: BookOpen },
                    { id: 'homework', label: 'Homework Assignments', icon: FileText },
                    { id: 'quizzes', label: 'Timed Quizzes', icon: Clock },
                    { id: 'messaging', label: 'Announcements & Chat', icon: MessageSquare },
                    { id: 'live', label: 'Live AI Proctoring', icon: Video }
                  ].map(tab => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveClassroomSubTab(tab.id as any);
                          setSelectedHomeworkId(null);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all text-sm ${
                          activeClassroomSubTab === tab.id
                            ? 'bg-blue-600 text-white shadow-md shadow-blue-600/10'
                            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Sub Tab Content */}
                <div className="lg:col-span-3">
                  <Card className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-md border border-gray-200 dark:border-gray-700 p-6 min-h-[400px]">
                    {/* ROSTER SUB-TAB */}
                    {activeClassroomSubTab === 'roster' && (
                      <div className="space-y-6">
                        <div className="flex justify-between items-center">
                          <h3 className="text-xl font-bold text-gray-900 dark:text-white">Physical Classroom Roster</h3>
                          <div className="flex items-center gap-3">
                            <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 font-semibold px-2.5 py-1 rounded-full">
                              {classroomCourseAnalytics?.students?.length || 0} Students
                            </span>
                            <button
                              onClick={() => {
                                setShowAddStudentsPanel(v => !v);
                                setAddStudentSearch('');
                                setAddStudentSelectedIds([]);
                              }}
                              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
                            >
                              <Users className="h-3.5 w-3.5" />
                              {showAddStudentsPanel ? 'Cancel' : '+ Add Students'}
                            </button>
                          </div>
                        </div>

                        {/* Add Students Panel */}
                        {showAddStudentsPanel && (() => {
                          const existingIds = new Set((classroomCourseAnalytics?.students || []).map((s: any) => s.student_id));
                          const allStudents = users.filter(u => u.role === 'student' && !existingIds.has(u.id));
                          const filtered = allStudents.filter(u =>
                            u.name.toLowerCase().includes(addStudentSearch.toLowerCase()) ||
                            u.email.toLowerCase().includes(addStudentSearch.toLowerCase())
                          );
                          return (
                            <div className="p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-xl space-y-3">
                              <h4 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <Users className="h-4 w-4 text-indigo-500" />
                                <span>Add Students to This Class</span>
                              </h4>
                              <input
                                type="text"
                                placeholder="Search by name or email…"
                                value={addStudentSearch}
                                onChange={e => setAddStudentSearch(e.target.value)}
                                className="w-full p-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                              />
                              <div className="max-h-48 overflow-y-auto space-y-0 rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                                {filtered.length === 0 ? (
                                  <p className="text-xs text-gray-500 italic p-3 text-center">
                                    {allStudents.length === 0 ? 'All platform students are already in this class.' : 'No students match your search.'}
                                  </p>
                                ) : filtered.map(u => {
                                  const isSelected = addStudentSelectedIds.includes(u.id);
                                  return (
                                    <button
                                      key={u.id}
                                      onClick={() => setAddStudentSelectedIds(prev =>
                                        isSelected ? prev.filter(id => id !== u.id) : [...prev, u.id]
                                      )}
                                      className={`w-full text-left px-3 py-2 flex items-center justify-between text-sm transition-colors ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}
                                    >
                                      <div>
                                        <p className="font-semibold text-gray-900 dark:text-white">{u.name}</p>
                                        <p className="text-xs text-gray-500">{u.email}</p>
                                      </div>
                                      <div className={`h-4 w-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-gray-400'}`}>
                                        {isSelected && <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                              {addStudentSelectedIds.length > 0 && (
                                <div className="flex items-center justify-between pt-1">
                                  <span className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold">{addStudentSelectedIds.length} student(s) selected</span>
                                  <button
                                    disabled={isAddingStudents}
                                    onClick={async () => {
                                      if (!selectedClassroomIdForInsights) return;
                                      setIsAddingStudents(true);
                                      try {
                                        await api.addClassroomStudents(selectedClassroomIdForInsights, addStudentSelectedIds);
                                        setShowAddStudentsPanel(false);
                                        setAddStudentSelectedIds([]);
                                        await loadClassroomCourseAnalytics(selectedClassroomIdForInsights, selectedCourseIdForInsights);
                                        alert(`✅ ${addStudentSelectedIds.length} student(s) added to class!`);
                                      } catch (err: any) {
                                        alert('Failed to add students: ' + (err.response?.data?.detail || err.message));
                                      } finally {
                                        setIsAddingStudents(false);
                                      }
                                    }}
                                    className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg transition-colors"
                                  >
                                    {isAddingStudents ? (
                                      <><div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" /><span>Adding…</span></>
                                    ) : (
                                      <><Users className="h-3.5 w-3.5" /><span>Add to Class</span></>
                                    )}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 uppercase">
                                <th className="pb-3 px-4">Student Name</th>
                                <th className="pb-3 px-4">Attendance</th>
                                <th className="pb-3 px-4">Syllabus Progress</th>
                                <th className="pb-3 px-4">Focus Rate</th>
                                <th className="pb-3 px-4">Grade</th>
                                <th className="pb-3 px-4 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                              {classroomCourseAnalytics?.students?.map((student: any) => (
                                <tr key={student.student_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 text-sm">
                                  <td className="py-3 px-4">
                                    <p className="font-bold text-gray-900 dark:text-white">{student.name}</p>
                                    <p className="text-xs text-gray-500">{student.email}</p>
                                  </td>
                                  <td className="py-3 px-4">
                                    <span className="font-semibold text-gray-800 dark:text-gray-200">{student.attendance}%</span>
                                  </td>
                                  <td className="py-3 px-4">
                                    <div className="flex items-center gap-2">
                                      <div className="w-16 bg-gray-200 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
                                        <div className="h-full bg-blue-500" style={{ width: `${student.progress}%` }} />
                                      </div>
                                      <span className="font-semibold">{student.progress}%</span>
                                    </div>
                                  </td>
                                  <td className="py-3 px-4">
                                    <div className="flex items-center gap-2">
                                      <div className="w-16 bg-gray-200 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
                                        <div className="h-full bg-rose-500" style={{ width: `${student.focus_rate || 80}%` }} />
                                      </div>
                                      <span className="font-semibold">{student.focus_rate || 80}%</span>
                                    </div>
                                  </td>
                                  <td className="py-3 px-4">
                                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                      student.grade >= 90 ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                                      student.grade >= 80 ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                                      'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                                    }`}>
                                      {student.grade}%
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-right">
                                    <div className="flex items-center justify-end gap-3">
                                      <button
                                        onClick={() => loadStudentFocusHistory(student.student_id, student.name)}
                                        className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-semibold flex items-center gap-1"
                                      >
                                        <TrendingUp className="h-3.5 w-3.5" />
                                        <span>Focus History</span>
                                      </button>
                                      <button
                                        onClick={() => {
                                          setEnrollStudentFaceId(student.student_id);
                                          setEnrollStudentFaceName(student.name);
                                        }}
                                        className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 font-semibold flex items-center gap-1"
                                      >
                                        <Camera className="h-3.5 w-3.5" />
                                        <span>Face Profile</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* MATERIALS SUB-TAB */}
                    {activeClassroomSubTab === 'materials' && (
                      <div className="space-y-6">
                        <div className="flex justify-between items-center border-b border-gray-200 dark:border-gray-700 pb-4">
                          <h3 className="text-xl font-bold text-gray-900 dark:text-white">Class Materials</h3>
                        </div>

                        {/* Link Curriculum PDF */}
                        <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl space-y-3">
                          <h4 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <BookOpen className="h-4 w-4 text-blue-500" />
                            <span>Link Core Curriculum PDF</span>
                          </h4>
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            Select a platform-prescribed curriculum math text to link to this course for students.
                          </p>
                          <div className="flex flex-col sm:flex-row gap-3">
                            <select
                              id="curriculum-pdf-select"
                              className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            >
                              <option value="">-- Choose Curriculum PDF --</option>
                              {curriculumPdfs.map((pdf, idx) => (
                                <option key={idx} value={pdf.filepath}>{pdf.filename}</option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              onClick={() => {
                                const selectEl = document.getElementById('curriculum-pdf-select') as HTMLSelectElement;
                                if (selectEl && selectEl.value) {
                                  const filename = selectEl.options[selectEl.selectedIndex].text;
                                  handleCreateMaterial({
                                    title: filename.replace('.pdf', ''),
                                    description: 'Linked course curriculum textbook.',
                                    resource_url: selectEl.value
                                  });
                                  selectEl.value = '';
                                  alert("Curriculum linked successfully!");
                                } else {
                                  alert("Please select a PDF first.");
                                }
                              }}
                            >
                              Link to Course
                            </Button>
                          </div>
                        </div>

                        {/* List Materials */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">Shared Materials</h4>
                          {isLoadingClasswork ? (
                            <Loading text="Loading materials..." />
                          ) : classworkItems.filter(item => ['video', 'pdf', 'document'].includes(item.classwork_type)).length === 0 ? (
                            <p className="text-sm text-gray-500 italic">No files or materials shared yet.</p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {classworkItems
                                .filter(item => ['video', 'pdf', 'document'].includes(item.classwork_type))
                                .map(item => (
                                  <div key={item.id} className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-100 dark:border-gray-800 flex items-start justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className="p-2.5 bg-blue-500/10 text-blue-500 rounded-lg">
                                        <FileText className="h-5 w-5" />
                                      </div>
                                      <div>
                                        <p className="text-sm font-bold text-gray-900 dark:text-white truncate max-w-[180px]">{item.title}</p>
                                        <p className="text-xs text-gray-500 uppercase">{item.classwork_type}</p>
                                      </div>
                                    </div>
                                    {item.resource_url && (
                                      <a
                                        href={item.resource_url.startsWith('http') || item.resource_url.startsWith('/curriculum_pdfs') ? item.resource_url : `http://${item.resource_url}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-blue-500 hover:underline font-bold self-center"
                                      >
                                        Open
                                      </a>
                                    )}
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* HOMEWORK SUB-TAB */}
                    {activeClassroomSubTab === 'homework' && (
                      <div className="space-y-6">
                        {!selectedHomeworkId ? (

                          <>
                            <div className="flex justify-between items-center border-b border-gray-200 dark:border-gray-700 pb-4 mb-4">
                              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Homework Assignments</h3>
                              <Button
                                size="sm"
                                onClick={() => setShowHomeworkForm(!showHomeworkForm)}
                              >
                                <Plus className="h-4 w-4 mr-1" />
                                {showHomeworkForm ? "Hide Form" : "Create Homework"}
                              </Button>
                            </div>

                            {showHomeworkForm && (
                              <div className="p-5 bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-200 dark:border-gray-700 space-y-4 mb-6 shadow-sm">
                                <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide">Create Homework Assignment</h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                  <div className="md:col-span-2">
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Homework Title</label>
                                    <input
                                      type="text"
                                      value={homeworkForm.title}
                                      onChange={e => setHomeworkForm({ ...homeworkForm, title: e.target.value })}
                                      placeholder="e.g. Algebra Homework 3"
                                      className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Max Grade</label>
                                    <input
                                      type="number"
                                      value={homeworkForm.max_grade}
                                      onChange={e => setHomeworkForm({ ...homeworkForm, max_grade: Number(e.target.value) })}
                                      className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                    />
                                  </div>
                                </div>

                                <div>
                                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Description / Instructions</label>
                                  <textarea
                                    value={homeworkForm.description}
                                    onChange={e => setHomeworkForm({ ...homeworkForm, description: e.target.value })}
                                    placeholder="Enter instructions, questions or reference notes..."
                                    rows={3}
                                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                  />
                                </div>

                                <div>
                                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Attach Reference Document</label>
                                  <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4 text-center hover:bg-gray-100 dark:hover:bg-gray-700/30 transition-all cursor-pointer relative">
                                    <input
                                      type="file"
                                      onChange={e => setHomeworkFile(e.target.files ? e.target.files[0] : null)}
                                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                    <p className="text-sm text-gray-700 dark:text-gray-300 font-semibold truncate">
                                      {homeworkFile ? `Selected file: ${homeworkFile.name}` : "Click or drag file to attach"}
                                    </p>
                                    <p className="text-xs text-gray-400 mt-1">Supports PDF, DOCX, IPYNB, ZIP (max 10MB)</p>
                                  </div>
                                </div>

                                <div className="flex justify-end gap-3 pt-2">
                                  <Button
                                    variant="outline"
                                    onClick={() => {
                                      setShowHomeworkForm(false);
                                      setHomeworkForm({ title: '', description: '', max_grade: 100, due_date: '' });
                                      setHomeworkFile(null);
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    onClick={() => handleCreateHomework(homeworkForm, homeworkFile)}
                                    isLoading={isCreatingHomework}
                                    disabled={!homeworkForm.title}
                                  >
                                    Publish Homework
                                  </Button>
                                </div>
                              </div>
                            )}

                            {isLoadingClasswork ? (
                              <Loading text="Loading homework..." />
                            ) : classworkItems.filter(item => item.classwork_type === 'homework').length === 0 ? (
                              <p className="text-sm text-gray-500 italic">No homework assignments created yet.</p>
                            ) : (
                              <div className="space-y-3">
                                {classworkItems
                                  .filter(item => item.classwork_type === 'homework')
                                  .map(item => (
                                    <div key={item.id} className="p-4 bg-gray-50 dark:bg-gray-700/30 rounded-xl border border-gray-200 dark:border-gray-800 flex items-center justify-between">
                                      <div>
                                        <p className="text-base font-bold text-gray-900 dark:text-white">{item.title}</p>
                                        <p className="text-xs text-gray-500 mt-1">{item.description}</p>
                                        
                                        {item.resource_url && (
                                          <div className="mt-2 flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 font-semibold">
                                            <FileText className="h-3.5 w-3.5" />
                                            <a
                                              href={item.resource_url.startsWith('http') || item.resource_url.startsWith('/uploads') ? item.resource_url : `http://${item.resource_url}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="hover:underline"
                                            >
                                              Attachment: {item.resource_url.split('/').pop()}
                                            </a>
                                          </div>
                                        )}
                                        
                                        <p className="text-xs text-gray-400 mt-2 font-bold">Max Grade: {item.max_grade || 100}</p>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          setSelectedHomeworkId(item.id);
                                          loadSubmissions(item.id);
                                        }}
                                      >
                                        View Submissions
                                      </Button>
                                    </div>
                                  ))}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="space-y-6">
                            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-4">
                              <button
                                onClick={() => setSelectedHomeworkId(null)}
                                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white font-medium flex items-center gap-1"
                              >
                                <ArrowLeft className="h-4 w-4" />
                                <span>Back to Assignments</span>
                              </button>
                              <h4 className="text-lg font-bold text-gray-900 dark:text-white">
                                {classworkItems.find(i => i.id === selectedHomeworkId)?.title} - Submissions
                              </h4>
                            </div>

                            {loadingSubmissions ? (
                              <Loading text="Loading student submissions..." />
                            ) : homeworkSubmissions.length === 0 ? (
                              <p className="text-sm text-gray-500 italic">No student submissions received yet.</p>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm border-collapse">
                                  <thead>
                                    <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 font-semibold text-xs uppercase">
                                      <th className="pb-2 px-2">Student Name</th>
                                      <th className="pb-2 px-2">Submitted At</th>
                                      <th className="pb-2 px-2">File</th>
                                      <th className="pb-2 px-2">Current Grade</th>
                                      <th className="pb-2 px-2 text-right">Action</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {homeworkSubmissions.map((sub: any) => (
                                      <tr key={sub.id} className="border-b border-gray-100 dark:border-gray-700/50">
                                        <td className="py-3 px-2 font-bold text-gray-900 dark:text-white">
                                          {sub.student?.name || `Student ID ${sub.student_id}`}
                                        </td>
                                        <td className="py-3 px-2 text-gray-500 dark:text-gray-400">
                                          {new Date(sub.submitted_at).toLocaleString()}
                                        </td>
                                        <td className="py-3 px-2">
                                          {sub.submission_file_url ? (
                                            <a
                                              href={sub.submission_file_url.startsWith('http') ? sub.submission_file_url : (import.meta.env.VITE_API_BASE_URL || '').replace('/api', '') + sub.submission_file_url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-blue-500 hover:underline font-bold text-xs"
                                            >
                                              Download Upload
                                            </a>
                                          ) : (
                                            <span className="text-gray-400 text-xs italic">No file</span>
                                          )}
                                        </td>
                                        <td className="py-3 px-2 font-bold text-gray-800 dark:text-gray-200">
                                          {sub.grade !== null ? `${sub.grade} / ${classworkItems.find(i => i.id === selectedHomeworkId)?.max_grade || 100}` : <span className="text-amber-600">Ungraded</span>}
                                        </td>
                                        <td className="py-3 px-2 text-right">
                                          {gradingStudentId === sub.student_id ? (
                                            <div className="flex items-center gap-1.5 justify-end">
                                              <input
                                                type="number"
                                                className="w-16 p-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm"
                                                value={gradingValue}
                                                onChange={e => setGradingValue(Number(e.target.value))}
                                                max={classworkItems.find(i => i.id === selectedHomeworkId)?.max_grade || 100}
                                                min={0}
                                              />
                                              <Button
                                                size="sm"
                                                disabled={isGrading}
                                                onClick={() => handleGradeSubmission(selectedHomeworkId, sub.student_id)}
                                              >
                                                Save
                                              </Button>
                                              <button
                                                className="text-xs text-gray-505 hover:underline font-bold"
                                                onClick={() => setGradingStudentId(null)}
                                              >
                                                Cancel
                                              </button>
                                            </div>
                                          ) : (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => {
                                                setGradingStudentId(sub.student_id);
                                                setGradingValue(sub.grade || 0);
                                              }}
                                            >
                                              Grade
                                            </Button>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* QUIZZES SUB-TAB */}
                    {activeClassroomSubTab === 'quizzes' && (
                      <div className="space-y-6">
                        <div className="flex justify-between items-center border-b border-gray-200 dark:border-gray-700 pb-4">
                          <h3 className="text-xl font-bold text-gray-900 dark:text-white">Timed Quizzes</h3>
                          <span className="text-xs bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 font-semibold px-2.5 py-1 rounded-full">
                            {classworkItems.filter(item => item.classwork_type === 'quiz').length} Quizzes
                          </span>
                        </div>

                        {/* Quiz Builder Form */}
                        <div className="p-5 bg-purple-500/5 border border-purple-500/25 rounded-2xl space-y-4">
                          <h4 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <Clock className="h-5 w-5 text-purple-500" />
                            <span>Interactive Quiz Builder</span>
                          </h4>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Quiz Title:</label>
                              <input
                                type="text"
                                className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                placeholder="e.g. Algebra Quiz 1"
                                value={quizForm.title}
                                onChange={e => setQuizForm({ ...quizForm, title: e.target.value })}
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Time Limit (Minutes):</label>
                              <input
                                type="number"
                                className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                value={quizForm.timer_minutes}
                                onChange={e => setQuizForm({ ...quizForm, timer_minutes: Number(e.target.value) })}
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Quiz Description:</label>
                            <textarea
                              className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                              placeholder="Describe the quiz or instructions for students..."
                              rows={2}
                              value={quizForm.description}
                              onChange={e => setQuizForm({ ...quizForm, description: e.target.value })}
                            />
                          </div>

                          {/* Questions List builder */}
                          <div className="space-y-4 pt-3 border-t border-purple-500/10">
                            <div className="flex justify-between items-center">
                              <h5 className="text-xs font-bold uppercase tracking-wider text-gray-500">Questions ({quizForm.questions.length})</h5>
                              <button
                                type="button"
                                onClick={() => setQuizForm({
                                  ...quizForm,
                                  questions: [...quizForm.questions, { question_text: '', option_a: '', option_b: '', option_c: '', option_d: '', correct_option: 'A' }]
                                })}
                                className="text-xs text-purple-600 dark:text-purple-400 hover:underline font-bold flex items-center gap-1"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Add Question
                              </button>
                            </div>

                            {quizForm.questions.map((q, qidx) => (
                              <div key={qidx} className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3 relative">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (quizForm.questions.length === 1) return;
                                    const nextQs = [...quizForm.questions];
                                    nextQs.splice(qidx, 1);
                                    setQuizForm({ ...quizForm, questions: nextQs });
                                  }}
                                  className="absolute top-3 right-3 text-gray-400 hover:text-red-500"
                                >
                                  <X className="h-4 w-4" />
                                </button>

                                <div>
                                  <label className="block text-xs font-semibold text-gray-500 mb-1">Question {qidx + 1}:</label>
                                  <input
                                    type="text"
                                    className="w-full p-2 border border-gray-300 dark:border-gray-655 rounded bg-gray-50 dark:bg-gray-700 text-sm font-semibold"
                                    placeholder="Enter question text..."
                                    value={q.question_text}
                                    onChange={e => {
                                      const nextQs = [...quizForm.questions];
                                      nextQs[qidx].question_text = e.target.value;
                                      setQuizForm({ ...quizForm, questions: nextQs });
                                    }}
                                  />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                  {['A', 'B', 'C', 'D'].map(opt => {
                                    const field = `option_${opt.toLowerCase()}` as any;
                                    return (
                                      <div key={opt}>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase">Option {opt}:</label>
                                        <input
                                          type="text"
                                          className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-750"
                                          placeholder={`Answer Choice ${opt}`}
                                          value={(q as any)[field]}
                                          onChange={e => {
                                            const nextQs = [...quizForm.questions];
                                            (nextQs[qidx] as any)[field] = e.target.value;
                                            setQuizForm({ ...quizForm, questions: nextQs });
                                          }}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>

                                <div className="w-1/2">
                                  <label className="block text-xs font-semibold text-gray-500 mb-1">Correct Answer:</label>
                                  <select
                                    className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-xs"
                                    value={q.correct_option}
                                    onChange={e => {
                                      const nextQs = [...quizForm.questions];
                                      nextQs[qidx].correct_option = e.target.value;
                                      setQuizForm({ ...quizForm, questions: nextQs });
                                    }}
                                  >
                                    <option value="A">Option A</option>
                                    <option value="B">Option B</option>
                                    <option value="C">Option C</option>
                                    <option value="D">Option D</option>
                                  </select>
                                </div>
                              </div>
                            ))}
                          </div>

                          <Button
                            className="w-full"
                            onClick={handleCreateQuiz}
                            disabled={!quizForm.title || quizForm.questions.some(q => !q.question_text || !q.option_a || !q.option_b)}
                          >
                            <CheckCircle className="h-4 w-4 mr-1.5" />
                            <span>Save timed Quiz</span>
                          </Button>
                        </div>

                        {/* List Quizzes */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">Active Course Quizzes</h4>
                          {isLoadingClasswork ? (
                            <Loading text="Loading quizzes..." />
                          ) : classworkItems.filter(item => item.classwork_type === 'quiz').length === 0 ? (
                            <p className="text-sm text-gray-500 italic">No quizzes created yet.</p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {classworkItems
                                .filter(item => item.classwork_type === 'quiz')
                                .map(item => (
                                  <div key={item.id} className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-100 dark:border-gray-800 flex items-center justify-between">
                                    <div>
                                      <p className="text-sm font-bold text-gray-900 dark:text-white">{item.title}</p>
                                      <p className="text-xs text-gray-505 font-semibold">{item.timer_minutes} mins | Max Score: {item.max_grade || 10}</p>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        setSelectedHomeworkId(item.id);
                                        loadSubmissions(item.id);
                                      }}
                                    >
                                      Quiz Submissions
                                    </Button>
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* MESSAGING SUB-TAB */}
                    {activeClassroomSubTab === 'messaging' && (
                      <div className="space-y-6">
                        <div className="border-b border-gray-200 dark:border-gray-700 pb-4 flex items-center justify-between">
                          <h3 className="text-xl font-bold text-gray-900 dark:text-white">Classroom Chat & Broadcast</h3>
                          <Button
                            size="sm"
                            variant={chatSelectedStudentId === null ? "primary" : "outline"}
                            onClick={() => setChatSelectedStudentId(null)}
                          >
                            Broadcast Announcement
                          </Button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[450px]">
                          {/* Left Panel: Students Roster List */}
                          <div className="md:col-span-1 border border-gray-200 dark:border-gray-700 rounded-xl overflow-y-auto p-2 space-y-1 bg-gray-50 dark:bg-gray-800/40">
                            <p className="text-xs font-bold uppercase tracking-wider text-gray-400 px-3 py-1">Direct Chat Contacts</p>
                            {classroomCourseAnalytics?.students?.map((student: any) => (
                              <button
                                key={student.student_id}
                                onClick={() => setChatSelectedStudentId(student.student_id)}
                                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all font-semibold flex items-center justify-between ${
                                  chatSelectedStudentId === student.student_id
                                    ? 'bg-blue-600 text-white shadow-sm'
                                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                }`}
                              >
                                <span>{student.name}</span>
                                <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full ${
                                  chatSelectedStudentId === student.student_id ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                                }`}>
                                  Chat
                                </span>
                              </button>
                            ))}
                          </div>

                          {/* Right Panel: Chat Message area */}
                          <div className="md:col-span-2 flex flex-col justify-between border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-800/20">
                            {/* Header */}
                            <div className="p-3 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                              <span className="font-bold text-gray-900 dark:text-white">
                                {chatSelectedStudentId === null
                                  ? "📢 Broadcasting to Entire Classroom"
                                  : `💬 Chat with ${classroomCourseAnalytics?.students?.find((s: any) => s.student_id === chatSelectedStudentId)?.name || 'Student'}`}
                              </span>
                            </div>

                            {/* Messages History */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 dark:bg-gray-900/10">
                              {loadingMessages ? (
                                <Loading text="Loading messages..." />
                              ) : classroomMessages.length === 0 ? (
                                <p className="text-center text-sm text-gray-400 italic py-12">No messages sent in this thread yet.</p>
                              ) : (
                                classroomMessages.map((msg: any) => {
                                  const isTeacherSender = msg.sender?.role === 'teacher';
                                  return (
                                    <div key={msg.id} className={`flex ${isTeacherSender ? 'justify-end' : 'justify-start'}`}>
                                      <div className={`max-w-[75%] p-3 rounded-2xl text-sm ${
                                        isTeacherSender
                                          ? 'bg-blue-600 text-white rounded-tr-none'
                                          : 'bg-white dark:bg-gray-700 text-gray-950 dark:text-white border border-gray-250 dark:border-gray-600 rounded-tl-none'
                                      }`}>
                                        <p className="font-bold text-[10px] opacity-75 mb-0.5">{msg.sender?.name}</p>
                                        <p className="font-medium">{msg.message}</p>
                                        <span className="block text-[9px] text-right mt-1 opacity-60">
                                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>

                            {/* Send Input */}
                            <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
                              <input
                                type="text"
                                className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-750 text-gray-900 dark:text-white text-sm"
                                placeholder={chatSelectedStudentId === null ? "Type announcement message..." : "Type direct chat message..."}
                                value={chatMessageText}
                                onChange={e => setChatMessageText(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') handleSendMessage();
                                }}
                              />
                              <Button size="sm" onClick={handleSendMessage}>
                                <Send className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* LIVE CV MONITOR LAUNCHER */}
                    {activeClassroomSubTab === 'live' && (
                      <div className="space-y-6 text-center max-w-lg mx-auto py-8">
                        <div className="p-4 bg-blue-500/10 text-blue-500 rounded-2xl w-16 h-16 flex items-center justify-center mx-auto mb-4">
                          <Video className="h-8 w-8" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-950 dark:text-white">Start Classroom AI Monitoring</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Launch the live Computer Vision session to monitor students' attentiveness, focus rates, and cheat detection during active lessons or exams.
                        </p>

                        <div className="space-y-4 text-left mt-6 bg-gray-50 dark:bg-gray-700/30 p-5 rounded-2xl border border-gray-200 dark:border-gray-800">
                          <div>
                            <label className="block text-xs font-semibold text-gray-750 dark:text-gray-300 mb-1">Selected Course:</label>
                            <div className="w-full p-2.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm border border-gray-300 dark:border-gray-600 rounded-lg font-bold">
                              {courses.find(c => c.id.toString() === selectedCourseIdForInsights)?.title || "No Course Mapped"}
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-gray-750 dark:text-gray-300 mb-1">Select Current Lesson Topic:</label>
                            <select
                              className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                              value={liveSessionLessonId}
                              onChange={e => setLiveSessionLessonId(e.target.value)}
                            >
                              <option value="">-- General / Review Session --</option>
                              {lessons
                                .filter(l => l.courseId === Number(selectedCourseIdForInsights))
                                .map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-gray-750 dark:text-gray-300 mb-1">
                              Camera Device Index
                              <span className="ml-1 text-gray-400 font-normal">(0 = built-in, 1 = first external webcam, 2 = second…)</span>
                            </label>
                            <div className="flex items-center gap-3">
                              {['0', '1', '2', '3'].map(idx => (
                                <button
                                  key={idx}
                                  onClick={() => setLiveSessionCameraIndex(idx)}
                                  className={`flex-1 py-2 rounded-lg border text-sm font-bold transition-colors ${liveSessionCameraIndex === idx ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:border-blue-400'}`}
                                >
                                  Camera {idx}
                                </button>
                              ))}
                            </div>
                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 font-semibold">
                              💡 If you're using an external/USB webcam (e.g. Microsoft LifeCam), try Camera 1 or Camera 2.
                            </p>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                              CV Proctoring Mode
                            </label>
                            <div className="flex gap-4">
                              <button
                                type="button"
                                onClick={() => setLiveSessionNfcOnly(true)}
                                className={`flex-1 p-3 rounded-xl border-2 text-left transition-all ${liveSessionNfcOnly ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-900/10' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 bg-white dark:bg-gray-800'}`}
                              >
                                <span className="block font-bold text-sm text-gray-900 dark:text-white">Mode 1: NFC Scoped</span>
                                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">CV only tracks students who scanned present via NFC today.</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setLiveSessionNfcOnly(false)}
                                className={`flex-1 p-3 rounded-xl border-2 text-left transition-all ${!liveSessionNfcOnly ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-900/10' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 bg-white dark:bg-gray-800'}`}
                              >
                                <span className="block font-bold text-sm text-gray-900 dark:text-white">Mode 2: Normal Roster</span>
                                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">CV tracks all roster students and alerts unknown faces.</span>
                              </button>
                            </div>
                          </div>
                        </div>

                        <Button
                          className="w-full py-3 mt-6 text-base font-bold bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl shadow-lg shadow-blue-500/25"
                          onClick={async () => {
                            try {
                              const classroom = classroomsForInsights.find(c => c.id.toString() === selectedClassroomIdForInsights);
                              const type = (classroom && classroom.is_exam_room) ? 'exam' : 'class';
                              // Update camera source in DB before starting
                              await api.updateClassroomConfig(selectedClassroomIdForInsights, { camera_source: liveSessionCameraIndex });
                              await api.startCvSession(
                                selectedClassroomIdForInsights,
                                type,
                                liveSessionCameraIndex,
                                currentUser.id,
                                Number(selectedCourseIdForInsights),
                                liveSessionLessonId ? Number(liveSessionLessonId) : undefined,
                                liveSessionNfcOnly
                              );
                              navigate(`/school/classroom/${selectedClassroomIdForInsights}/live`);
                            } catch (error) {
                              console.error("Failed to start session:", error);
                              alert("Failed to start CV session. Make sure the webcam is available and classroom camera is set.");
                            }
                          }}
                        >
                          <Video className="h-5 w-5 mr-2" />
                          <span>Start AI Monitoring Session</span>
                        </Button>
                      </div>
                    )}
                  </Card>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Student Focus History Modal */}
        <AnimatePresence>
          {focusHistoryStudentId !== null && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white dark:bg-gray-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-gray-200 dark:border-gray-700"
              >
                <div className="flex justify-between items-center border-b border-gray-200 dark:border-gray-700 pb-3 mb-4">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-blue-500" />
                    <span>Focus Analytics History: {focusHistoryStudentName}</span>
                  </h3>
                  <button onClick={() => setFocusHistoryStudentId(null)} className="text-gray-400 hover:text-gray-600">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {loadingStudentFocusHistory ? (
                  <div className="py-16 text-center">
                    <Loading text="Retrieving session records..." />
                  </div>
                ) : studentFocusHistoryData.length === 0 ? (
                  <p className="text-sm text-gray-500 italic text-center py-12">No finished CV session data available for this student.</p>
                ) : (
                  <div className="space-y-4">
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={studentFocusHistoryData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                          <XAxis
                            dataKey="started_at"
                            tickFormatter={(val) => new Date(val).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            stroke="#9CA3AF"
                            fontSize={11}
                          />
                          <YAxis stroke="#9CA3AF" fontSize={11} domain={[40, 100]} />
                          <RechartsTooltip
                            labelFormatter={(label: any) => new Date(label).toLocaleString()}
                            formatter={(value: any, name: any, props: any) => [
                              `${value}%`,
                              `Focus (Teacher: ${props.payload.teacher_name || 'N/A'})`
                            ]}
                          />
                          <Line
                            type="monotone"
                            dataKey="focus_rate"
                            stroke="#3B82F6"
                            strokeWidth={3}
                            dot={{ r: 4, strokeWidth: 2 }}
                            activeDot={{ r: 6 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Text feed list of sessions */}
                    <div className="max-h-48 overflow-y-auto space-y-2.5 divide-y divide-gray-100 dark:divide-gray-800">
                      {studentFocusHistoryData.map((session, sidx) => (
                        <div key={sidx} className="pt-2 flex items-center justify-between text-xs">
                          <div>
                            <p className="font-bold text-gray-900 dark:text-white">{session.lesson_title} ({session.course_title})</p>
                            <p className="text-gray-500 font-semibold mt-0.5">Taught by {session.teacher_name} • {new Date(session.started_at).toLocaleDateString()}</p>
                          </div>
                          <span className={`px-2.5 py-1 rounded-full font-bold text-sm ${
                            session.focus_rate >= 80 ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                            session.focus_rate >= 70 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                            'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                          }`}>
                            {session.focus_rate}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Student Face Enrollment Modal */}
        <AnimatePresence>
          {enrollStudentFaceId !== null && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="relative bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
              >
                <button
                  onClick={() => setEnrollStudentFaceId(null)}
                  className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 z-10"
                >
                  <X className="h-5 w-5" />
                </button>
                <FaceEnrollment
                  studentId={enrollStudentFaceId}
                  studentName={enrollStudentFaceName}
                  onComplete={() => {
                    setEnrollStudentFaceId(null);
                    if (selectedClassroomIdForInsights && selectedCourseIdForInsights) {
                      loadClassroomCourseAnalytics(selectedClassroomIdForInsights, selectedCourseIdForInsights);
                    }
                  }}
                />
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </Layout>
  );
};