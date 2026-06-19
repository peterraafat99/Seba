import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Clock, TrendingUp, Play, ChevronRight, X, Users, GraduationCap, Award, Activity, Brain, MessageSquare, Calendar, Target, TrendingDown, Info, ChevronDown, Send, FileText, CheckCircle, ArrowLeft, Upload, School } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';
import { Alert } from '@/components/ui/Alert';
import { api } from '@/utils/api';
import { t } from '@/utils/language';
import { useLanguage } from '@/contexts/LanguageContext';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import { StudentInsightsModal } from '@/components/admin/StudentInsightsModal';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  ResponsiveContainer,
} from 'recharts';

interface Course {
  id: string;
  title: string;
  instructor: string;
  progress: number;
  thumbnail?: string;
}

interface StudentSummary {
  id: number;
  name: string;
  email: string;
  totalTimeSpent: number;
  averageGrade: number;
  coursesCount: number;
}

interface DashboardData {
  courses: Course[];
  progress: number;
  upcomingLessons: any[];
  recentActivity: any[];
  students?: StudentSummary[];
}

interface StudentDetail {
  id: number;
  name: string;
  performance: { date: string; score: number }[];
  attendance: { date: string; present: boolean }[];
  grades: {
    course: string;
    grade: number;
    timeSpent: number;
    lessons: { title: string; timeSpent: number; }[];
  }[];
  notes: any[];
  engagementScore?: number;
  totalActivities?: number;
  totalTimeSpent?: number;
  sentimentData?: any;
  teacherNotes?: {
    id: string;
    content: string;
    priority: string;
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

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'];

export const Dashboard = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [studentDetail, setStudentDetail] = useState<StudentDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { language } = useLanguage();

  const userStr = localStorage.getItem('user');
  const currentUser = userStr ? JSON.parse(userStr) : null;

  // Student view states
  const [activeTabStudent, setActiveTabStudent] = useState<'learning' | 'classroom'>('learning');
  const [classroomSubTabStudent, setClassroomSubTabStudent] = useState<'materials' | 'messaging' | 'focus' | 'attendance'>('materials');
  const [studentClassroomId, setStudentClassroomId] = useState<number | null>(null);
  const [studentClassroomName, setStudentClassroomName] = useState<string>('');
  
  // Classwork & submissions
  const [classworkItems, setClassworkItems] = useState<any[]>([]);
  const [isLoadingClasswork, setIsLoadingClasswork] = useState(false);
  
  // Messaging
  const [classroomMessages, setClassroomMessages] = useState<any[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [chatMessageText, setChatMessageText] = useState('');
  
  // Focus analytics
  const [focusHistoryData, setFocusHistoryData] = useState<any[]>([]);
  const [isLoadingFocusHistory, setIsLoadingFocusHistory] = useState(false);
  const [studentAttendanceHistory, setStudentAttendanceHistory] = useState<any>(null);
  const [loadingAttendance, setLoadingAttendance] = useState(false);

  // Quiz taking state
  const [activeQuiz, setActiveQuiz] = useState<any | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({}); // { questionIndex: answer }
  const [quizTimerSeconds, setQuizTimerSeconds] = useState<number>(0);
  const [isSubmittingQuiz, setIsSubmittingQuiz] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Record<number, File>>({});

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    if (currentUser && currentUser.role === 'student') {
      fetchStudentClassroom();
    }
  }, [currentUser]);

  useEffect(() => {
    if (studentClassroomId) {
      if (classroomSubTabStudent === 'messaging') {
        loadClassroomMessages(studentClassroomId);
      }
    }
  }, [studentClassroomId, classroomSubTabStudent]);

  useEffect(() => {
    if (currentUser && currentUser.role === 'student' && classroomSubTabStudent === 'focus') {
      loadStudentFocusHistory(currentUser.id);
    }
  }, [currentUser, classroomSubTabStudent]);

  useEffect(() => {
    if (currentUser && currentUser.role === 'student' && classroomSubTabStudent === 'attendance') {
      loadStudentAttendanceHistory(currentUser.id);
    }
  }, [currentUser, classroomSubTabStudent]);

  useEffect(() => {
    if (!activeQuiz) return;
    setQuizTimerSeconds(activeQuiz.timer_minutes * 60);
    const interval = setInterval(() => {
      setQuizTimerSeconds(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setTimeout(() => handleAutoSubmitQuiz(), 100);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [activeQuiz]);

  const fetchStudentClassroom = async () => {
    if (!currentUser || !currentUser.school_id) return;
    try {
      const res = await api.getClassrooms(currentUser.school_id);
      const rooms = res.data || [];
      for (const r of rooms) {
        const detailRes = await api.getClassroomDetail(r.id);
        const details = detailRes.data;
        if (details.students && details.students.some((s: any) => s.student_id === currentUser.id)) {
          setStudentClassroomId(r.id);
          setStudentClassroomName(r.name);
          break;
        }
      }
    } catch (err) {
      console.error("Failed to detect student classroom", err);
    }
  };

  const loadClassworkForStudent = async () => {
    if (!data?.courses || data.courses.length === 0) return;
    try {
      setIsLoadingClasswork(true);
      const allClasswork: any[] = [];
      for (const c of data.courses) {
        const res = await api.getClasswork(c.id);
        allClasswork.push(...(res.data || []));
      }
      setClassworkItems(allClasswork);
    } catch (err) {
      console.error("Failed to load classwork for student", err);
    } finally {
      setIsLoadingClasswork(false);
    }
  };

  useEffect(() => {
    if (data?.courses && data.courses.length > 0) {
      loadClassworkForStudent();
    }
  }, [data]);

  const loadClassroomMessages = async (classroomId: number) => {
    if (!currentUser) return;
    try {
      setLoadingMessages(true);
      const res = await api.getClassroomMessages(classroomId, currentUser.id);
      setClassroomMessages(res.data || []);
    } catch (err) {
      console.error("Failed to load messages", err);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSendMessage = async () => {
    if (!studentClassroomId || !chatMessageText.trim() || !currentUser) return;
    try {
      await api.sendClassroomMessage(studentClassroomId, {
        message: chatMessageText,
        student_id: currentUser.id
      });
      setChatMessageText('');
      loadClassroomMessages(studentClassroomId);
    } catch (err) {
      console.error("Failed to send message", err);
    }
  };

  const loadStudentFocusHistory = async (studentId: number) => {
    try {
      setIsLoadingFocusHistory(true);
      const res = await api.getStudentFocusHistory(studentId);
      setFocusHistoryData(res.data || []);
    } catch (err) {
      console.error("Failed to load student focus history", err);
    } finally {
      setIsLoadingFocusHistory(false);
    }
  };

  const loadStudentAttendanceHistory = async (studentId: number) => {
    try {
      setLoadingAttendance(true);
      const res = await api.getStudentAttendanceHistory(studentId);
      setStudentAttendanceHistory(res.data);
    } catch (err) {
      console.error("Failed to load student attendance history:", err);
    } finally {
      setLoadingAttendance(false);
    }
  };

  const handleHomeworkSubmit = async (classworkId: number, file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('completed', 'true');
      await api.submitClasswork(classworkId, formData);
      alert("Homework submitted successfully!");
      loadClassworkForStudent();
    } catch (err) {
      console.error("Failed to submit homework", err);
      alert("Failed to submit homework.");
    }
  };

  const handleHomeworkUnsubmit = async (classworkId: number) => {
    try {
      await api.unsubmitClasswork(classworkId);
      alert("Homework unsubmitted.");
      loadClassworkForStudent();
    } catch (err) {
      console.error("Failed to unsubmit homework", err);
      alert("Failed to unsubmit homework.");
    }
  };

  const handleAutoSubmitQuiz = () => {
    submitQuizExecution(quizAnswers);
  };

  const handleSubmitQuiz = () => {
    if (confirm("Are you sure you want to submit this quiz?")) {
      submitQuizExecution(quizAnswers);
    }
  };

  const submitQuizExecution = async (answers: Record<number, string>) => {
    if (!activeQuiz) return;
    try {
      setIsSubmittingQuiz(true);
      const questions = JSON.parse(activeQuiz.quiz_questions_json || '[]');
      
      let correctCount = 0;
      questions.forEach((q: any, idx: number) => {
        const studentAns = answers[idx];
        if (studentAns && studentAns.toUpperCase() === q.correct_answer.toUpperCase()) {
          correctCount += 1;
        }
      });

      const formData = new FormData();
      formData.append('completed', 'true');
      formData.append('answers_json', JSON.stringify(answers));
      formData.append('grade', String(correctCount));

      await api.submitClasswork(activeQuiz.id, formData);
      alert(`Quiz submitted! Your Score: ${correctCount} / ${questions.length}`);
      setActiveQuiz(null);
      setQuizAnswers({});
      loadClassworkForStudent();
    } catch (err) {
      console.error("Failed to submit quiz", err);
      alert("Failed to submit quiz solution.");
    } finally {
      setIsSubmittingQuiz(false);
    }
  };

  // Helper function to normalize image/file URLs
  const normalizeImageUrl = (url: string | null | undefined): string | null => {
    if (!url) return null;
    // If it's already a full URL, return as-is
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    // If it starts with /uploads or /curriculum_pdfs, construct the full URL
    if (url.startsWith('/uploads') || url.startsWith('/curriculum_pdfs')) {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
      const baseUrl = API_BASE_URL.replace('/api', '') || window.location.origin;
      return baseUrl + url;
    }
    return url;
  };

  const loadDashboard = async () => {
    try {
      setIsLoading(true);
      const response = await api.getDashboard();
      const dashboardData = response.data;
      // Normalize thumbnail URLs for courses
      if (dashboardData?.courses) {
        dashboardData.courses = dashboardData.courses.map((course: any) => ({
          ...course,
          thumbnail: normalizeImageUrl(course.thumbnail)
        }));
      }
      setData(dashboardData);
    } catch (err: any) {
      setError(err.response?.data?.message || t('errorOccurred', language));
    } finally {
      setIsLoading(false);
    }
  };

  const loadStudentDetail = async (studentId: number) => {
    try {
      setIsLoadingDetail(true);
      setSelectedStudentId(String(studentId));
      const response = await api.getInsightsStudent(String(studentId));
      setStudentDetail(response.data);
    } catch (err: any) {
      setError(err.response?.data?.message || t('errorOccurred', language));
      setSelectedStudentId(null);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const closeStudentDetail = () => {
    setSelectedStudentId(null);
    setStudentDetail(null);
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

  if (error) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Alert type="error">{error}</Alert>
        </div>
      </Layout>
    );
  }

  // Parent/Teacher View
  if (data?.students && data.students.length > 0) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <motion.div
            initial="initial"
            animate="animate"
            variants={staggerContainer as any}
            className="mb-8"
          >
            <motion.h1
              variants={fadeInUp as any}
              className="text-4xl font-extrabold text-gray-900 dark:text-white mb-2 bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent"
            >
              {t('dashboard', language)}
            </motion.h1>
            <motion.p
              variants={fadeInUp as any}
              className="text-lg text- gray-600 dark:text-gray-400"
            >
              Your Students Overview
            </motion.p>
          </motion.div>

          {/* Student List */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {data.students.map((student) => (
              <motion.div
                key={student.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ scale: 1.02 }}
                onClick={() => loadStudentDetail(student.id)}
                className="cursor-pointer"
              >
                <Card className="hover:shadow-xl transition-all bg-white dark:bg-gray-800 border-l-4 border-blue-500">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="h-16 w-16 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white font-bold text-2xl shadow-lg">
                      {student.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-xl text-gray-900 dark:text-white">{student.name}</h3>
                      <p className="text-gray-500 dark:text-gray-400 text-sm">{student.email}</p>
                    </div>
                    <ChevronRight className="h-6 w-6 text-gray-400" />
                  </div>

                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between items-center p-3 bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-900/30 rounded-lg">
                      <span className="text-gray-700 dark:text-gray-300 font-medium flex items-center gap-2">
                        <Award className="h-4 w-4" />
                        Avg Grade
                      </span>
                      <span className={`font-bold text-lg ${student.averageGrade >= 80 ? 'text-green-600 dark:text-green-400' : student.averageGrade >= 60 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
                        {student.averageGrade}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-gradient-to-r from-violet-50 to-violet-100 dark:from-violet-900/20 dark:to-violet-900/30 rounded-lg">
                      <span className="text-gray-700 dark:text-gray-300 font-medium flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Time Spent
                      </span>
                      <span className="font-bold text-lg text-violet-600 dark:text-violet-400">{student.totalTimeSpent}m</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-gradient-to-r from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-900/30 rounded-lg">
                      <span className="text-gray-700 dark:text-gray-300 font-medium flex items-center gap-2">
                        <BookOpen className="h-4 w-4" />
                        Enrolled Courses
                      </span>
                      <span className="font-bold text-lg text-green-600 dark:text-green-400">{student.coursesCount}</span>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>


          {/* Student Detail Modal - Using Reusable Component */}
          <AnimatePresence>
            {selectedStudentId && (
              <StudentInsightsModal
                studentDetail={studentDetail}
                isLoading={isLoadingDetail}
                onClose={closeStudentDetail}
              />
            )}
          </AnimatePresence>
        </div>
      </Layout>
    );
  }

  // Student View (Regular Dashboard)
  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-gray-900 dark:text-gray-100">
        <motion.div
          initial="initial"
          animate="animate"
          variants={staggerContainer as any}
          className="mb-8"
        >
          <motion.h1
            variants={fadeInUp as any}
            className="text-4xl font-extrabold text-gray-900 dark:text-white mb-2 bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent"
          >
            {t('dashboard', language)}
          </motion.h1>
          <motion.p
            variants={fadeInUp as any}
            className="text-lg text-gray-600 dark:text-gray-400"
          >
            {t('continueLearning', language)}
          </motion.p>
        </motion.div>

        {/* Tab Navigation for Students */}
        {studentClassroomId && (
          <div className="flex gap-2 mb-8 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
            <button
              onClick={() => setActiveTabStudent('learning')}
              className={`px-6 py-3 font-medium transition-colors whitespace-nowrap ${
                activeTabStudent === 'learning'
                  ? 'text-blue-500 border-b-2 border-blue-500'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              My Learning Dashboard
            </button>
            <button
              onClick={() => setActiveTabStudent('classroom')}
              className={`px-6 py-3 font-medium transition-colors whitespace-nowrap ${
                activeTabStudent === 'classroom'
                  ? 'text-blue-500 border-b-2 border-blue-500'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              My Moodle Classroom ({studentClassroomName})
            </button>
          </div>
        )}

        {activeTabStudent === 'learning' ? (
          <>
            {/* Stats Cards */}
            <motion.div
              initial="initial"
              animate="animate"
              variants={staggerContainer as any}
              className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8"
            >
              {[
                { icon: BookOpen, color: 'text-blue-500', bg: 'bg-blue-100 dark:bg-blue-900/30', label: t('myCourses', language), value: data?.courses.length || 0 },
                { icon: TrendingUp, color: 'text-green-500', bg: 'bg-green-100 dark:bg-green-900/30', label: t('progress', language), value: `${Math.round(data?.progress || 0)}%` },
                { icon: Clock, color: 'text-violet-500', bg: 'bg-violet-100 dark:bg-violet-900/30', label: t('upcomingLessons', language), value: data?.upcomingLessons.length || 0 },
              ].map((stat, index) => {
                const Icon = stat.icon;
                return (
                  <motion.div key={index} variants={fadeInUp as any}>
                    <Card hover className="relative overflow-hidden group">
                      <div className="absolute inset-0 bg-gradient-to-br from-transparent to-gray-50 dark:to-gray-700/50 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                      <div className="relative flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                            {stat.label}
                          </p>
                          <motion.p
                            initial={{ scale: 0.8 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: index * 0.1 + 0.3, type: "spring" }}
                            className="text-3xl font-bold text-gray-900 dark:text-white"
                          >
                            {stat.value}
                          </motion.p>
                        </div>
                        <motion.div
                          whileHover={{ rotate: [0, -10, 10, 0], scale: 1.1 }}
                          transition={{ duration: 0.5 }}
                          className={`w-14 h-14 ${stat.bg} rounded-xl flex items-center justify-center`}
                        >
                          <Icon className={`h-7 w-7 ${stat.color}`} />
                        </motion.div>
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </motion.div>

            {/* Continue Learning */}
            <motion.div
              initial="initial"
              whileInView="animate"
              viewport={{ once: true, margin: "-100px" }}
              variants={staggerContainer as any}
              className="mb-8"
            >
              <motion.div
                variants={fadeInUp as any}
                className="flex items-center justify-between mb-6"
              >
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {t('continueLearning', language)}
                </h2>
                <motion.div whileHover={{ x: 5 }} whileTap={{ scale: 0.95 }}>
                  <Link
                    to="/courses"
                    className="text-sm text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1 transition-colors"
                  >
                    {t('viewAll', language)}
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </motion.div>
              </motion.div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {data?.courses.slice(0, 3).map((course, index) => (
                  <motion.div
                    key={course.id}
                    variants={fadeInUp as any}
                    whileHover={{ y: -8 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <Link to={`/courses/${course.id}`}>
                      <Card hover className="cursor-pointer h-full overflow-hidden group">
                        <div className="aspect-video bg-gradient-to-br from-blue-400 to-violet-500 rounded-lg mb-4 flex items-center justify-center relative overflow-hidden">
                          {course.thumbnail ? (
                            <motion.img
                              src={course.thumbnail}
                              alt={course.title}
                              className="w-full h-full object-cover rounded-lg"
                              whileHover={{ scale: 1.1 }}
                              transition={{ duration: 0.3 }}
                            />
                          ) : (
                            <BookOpen className="h-12 w-12 text-white" />
                          )}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors"></div>
                        </div>
                        <h3 className="font-semibold text-gray-900 dark:text-white mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {course.title}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                          {course.instructor}
                        </p>
                        <div className="flex items-center justify-between">
                          <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2 mr-2 overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${course.progress}%` }}
                              transition={{ delay: index * 0.1 + 0.5, duration: 0.8, ease: "easeOut" }}
                              className="bg-gradient-to-r from-blue-500 to-violet-500 h-2 rounded-full"
                            />
                          </div>
                          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                            {Math.round(course.progress)}%
                          </span>
                        </div>
                      </Card>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Recent Activity */}
            {data?.recentActivity && data.recentActivity.length > 0 && (
              <Card>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                  {t('recentActivity', language)}
                </h2>
                <div className="space-y-3">
                  {data.recentActivity.map((activity: any, index: number) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 p-3 rounded-lg bg-gray-55 dark:bg-gray-700/50"
                    >
                      <Play className="h-5 w-5 text-blue-500" />
                      <div className="flex-1">
                        <p className="text-sm text-gray-900 dark:text-white">
                          {activity.description}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {activity.timestamp}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        ) : (
          /* Moodle Classroom Portal View */
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Sub-menu sidebar */}
            <div className="lg:col-span-1 space-y-2">
              {[
                { id: 'materials', label: 'Coursework & materials', icon: BookOpen },
                { id: 'messaging', label: 'Teacher Inbox & Chat', icon: MessageSquare },
                { id: 'focus', label: 'My Focus Analytics', icon: TrendingUp },
                { id: 'attendance', label: 'My Attendance Logs', icon: CheckCircle }
              ].map(subTab => {
                const Icon = subTab.icon;
                return (
                  <button
                    key={subTab.id}
                    onClick={() => setClassroomSubTabStudent(subTab.id as any)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all text-sm ${
                      classroomSubTabStudent === subTab.id
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span>{subTab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Sub-tab content panel */}
            <div className="lg:col-span-3">
              <Card className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-md border border-gray-200 dark:border-gray-700 p-6 min-h-[400px]">
                {/* MATERIALS SUBTAB */}
                {classroomSubTabStudent === 'materials' && (
                  <div className="space-y-6">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-3">
                      Course Materials & Tasks
                    </h3>

                    {/* PDF/Video Resources section */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">Shared Study Resources</h4>
                      {isLoadingClasswork ? (
                        <Loading text="Loading coursework..." />
                      ) : classworkItems.filter(item => ['video', 'pdf', 'document'].includes(item.classwork_type)).length === 0 ? (
                        <p className="text-sm text-gray-550 italic">No study resources shared by the teacher yet.</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {classworkItems
                            .filter(item => ['video', 'pdf', 'document'].includes(item.classwork_type))
                            .map(item => (
                              <div key={item.id} className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-100 dark:border-gray-800 flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="p-2.5 bg-blue-500/10 text-blue-500 rounded-lg">
                                    <BookOpen className="h-5 w-5" />
                                  </div>
                                  <div>
                                    <p className="text-sm font-bold text-gray-900 dark:text-white truncate max-w-[170px]">{item.title}</p>
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

                    {/* Homework section */}
                    <div className="space-y-4 pt-4 border-t border-gray-150 dark:border-gray-700/50">
                      <h4 className="text-sm font-bold text-gray-805 dark:text-gray-200">Homework Assignments</h4>
                      {isLoadingClasswork ? (
                        <Loading text="Loading tasks..." />
                      ) : classworkItems.filter(item => item.classwork_type === 'homework').length === 0 ? (
                        <p className="text-sm text-gray-500 italic">No homework assignments active.</p>
                      ) : (
                        <div className="space-y-3">
                          {classworkItems
                            .filter(item => item.classwork_type === 'homework')
                            .map(item => {
                              const isCompleted = item.completed;
                              return (
                                <div key={item.id} className="p-4 bg-gray-55/30 dark:bg-gray-700/30 rounded-xl border border-gray-150 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                  <div className="flex-1">
                                    <p className="text-base font-bold text-gray-900 dark:text-white">{item.title}</p>
                                    <p className="text-xs text-gray-500 mt-1">{item.description}</p>
                                    
                                    {item.resource_url && (
                                      <div className="mt-2 flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 font-semibold">
                                        <FileText className="h-3.5 w-3.5" />
                                        <a
                                          href={normalizeImageUrl(item.resource_url) || '#'}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="hover:underline"
                                        >
                                          Attachment: {item.resource_url.split('/').pop()}
                                        </a>
                                      </div>
                                    )}

                                    <div className="flex items-center gap-4 mt-2">
                                      <span className="text-xs font-semibold text-gray-650 dark:text-gray-400">Max Grade: {item.max_grade || 10}</span>
                                      {item.due_date && <span className="text-xs text-gray-550">Due: {new Date(item.due_date).toLocaleDateString()}</span>}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-3">
                                    {isCompleted ? (
                                      <div className="flex flex-col items-end gap-1.5">
                                        <span className="text-xs text-green-600 dark:text-green-400 font-bold flex items-center gap-1">
                                          <CheckCircle className="w-4 h-4" />
                                          Submitted
                                        </span>
                                        {item.submission_file_url && (
                                          <div className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                                            <FileText className="w-3.5 h-3.5" />
                                            <a
                                              href={normalizeImageUrl(item.submission_file_url) || '#'}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="hover:underline font-semibold"
                                            >
                                              My Submission
                                            </a>
                                          </div>
                                        )}
                                        {item.grade !== null && (
                                          <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded font-bold">
                                            Score: {item.grade} / {item.max_grade || 10}
                                          </span>
                                        )}
                                        <button
                                          onClick={() => handleHomeworkUnsubmit(item.id)}
                                          className="text-xs text-red-500 hover:underline mt-1"
                                        >
                                          Unsubmit
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex flex-col items-end gap-2 w-full sm:w-auto">
                                        {selectedFiles[item.id] ? (
                                          <div className="flex flex-col gap-1.5 w-full sm:min-w-[220px]">
                                            <div className="flex items-center justify-between gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-lg">
                                              <div className="flex items-center gap-1.5 min-w-0">
                                                <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                                                <span className="text-xs text-gray-700 dark:text-gray-300 font-medium truncate max-w-[120px]">
                                                  {selectedFiles[item.id].name}
                                                </span>
                                              </div>
                                              <button
                                                onClick={() => {
                                                  const updated = { ...selectedFiles };
                                                  delete updated[item.id];
                                                  setSelectedFiles(updated);
                                                }}
                                                className="text-xs text-red-500 hover:text-red-700 font-bold shrink-0"
                                              >
                                                Remove
                                              </button>
                                            </div>
                                            <div className="flex gap-2">
                                              <Button
                                                size="sm"
                                                className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
                                                onClick={() => {
                                                  handleHomeworkSubmit(item.id, selectedFiles[item.id]);
                                                  const updated = { ...selectedFiles };
                                                  delete updated[item.id];
                                                  setSelectedFiles(updated);
                                                }}
                                              >
                                                Submit Solution
                                              </Button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-3 text-center hover:bg-gray-100 dark:hover:bg-gray-700/20 transition-all cursor-pointer relative w-full sm:min-w-[220px]">
                                            <input
                                              type="file"
                                              onChange={e => {
                                                if (e.target.files && e.target.files[0]) {
                                                  setSelectedFiles({ ...selectedFiles, [item.id]: e.target.files[0] });
                                                }
                                              }}
                                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                            />
                                            <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 font-semibold">
                                              <Upload className="w-3.5 h-3.5 text-blue-500" />
                                              <span>Click or drag file to solve</span>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}

                        </div>
                      )}
                    </div>

                    {/* Quizzes section */}
                    <div className="space-y-4 pt-4 border-t border-gray-150 dark:border-gray-700/50">
                      <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">Active Quizzes</h4>
                      {isLoadingClasswork ? (
                        <Loading text="Loading quizzes..." />
                      ) : classworkItems.filter(item => item.classwork_type === 'quiz').length === 0 ? (
                        <p className="text-sm text-gray-500 italic">No timed quizzes active.</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {classworkItems
                            .filter(item => item.classwork_type === 'quiz')
                            .map(item => {
                              const isCompleted = item.completed;
                              return (
                                <div key={item.id} className="p-4 bg-gray-50 dark:bg-gray-700/30 rounded-xl border border-gray-150 dark:border-gray-800 flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-bold text-gray-900 dark:text-white">{item.title}</p>
                                    <p className="text-xs text-gray-500 mt-1">{item.timer_minutes} minutes limit</p>
                                    {isCompleted && item.grade !== null && (
                                      <span className="inline-block mt-2 text-xs bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 px-2 py-0.5 rounded font-bold">
                                        Score: {item.grade} / {item.max_grade || 10}
                                      </span>
                                    )}
                                  </div>

                                  {!isCompleted && (
                                    <Button
                                      size="sm"
                                      className="bg-purple-650 hover:bg-purple-700 text-white"
                                      onClick={() => setActiveQuiz(item)}
                                    >
                                      Take Quiz
                                    </Button>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* MESSAGING SUBTAB */}
                {classroomSubTabStudent === 'messaging' && (
                  <div className="space-y-6">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-3">
                      Teacher Chat & announcements
                    </h3>

                    <div className="flex flex-col justify-between border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden h-[450px]">
                      {/* Chat History */}
                      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 dark:bg-gray-900/10">
                        {loadingMessages ? (
                          <Loading text="Loading classroom inbox..." />
                        ) : classroomMessages.length === 0 ? (
                          <p className="text-center text-sm text-gray-450 italic py-16">No announcements or messages found.</p>
                        ) : (
                          classroomMessages.map((msg: any) => {
                            // Check if sender is teacher
                            const isTeacherSender = msg.sender?.role === 'teacher';
                            return (
                              <div key={msg.id} className={`flex ${isTeacherSender ? 'justify-start' : 'justify-end'}`}>
                                <div className={`max-w-[75%] p-3 rounded-2xl text-sm ${
                                  isTeacherSender
                                    ? 'bg-white dark:bg-gray-700 text-gray-950 dark:text-white border border-gray-250 dark:border-gray-600 rounded-tl-none'
                                    : 'bg-blue-600 text-white rounded-tr-none'
                                }`}>
                                  <p className="font-bold text-[10px] opacity-75 mb-0.5">
                                    {isTeacherSender ? `أ/ ${msg.sender?.name} (Teacher)` : 'Me'}
                                  </p>
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

                      {/* Message Input */}
                      <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
                        <input
                          type="text"
                          className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-55 dark:bg-gray-750 text-gray-900 dark:text-white text-sm"
                          placeholder="Type a message to your teacher..."
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
                )}

                {/* FOCUS ANALYTICS SUBTAB */}
                {classroomSubTabStudent === 'focus' && (
                  <div className="space-y-6">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-3">
                      My Focus Rate Analytics
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      This graph displays your attention and focus rates monitored by the Computer Vision pipeline during physical classroom sessions.
                    </p>

                    {isLoadingFocusHistory ? (
                      <Loading text="Loading focus logs..." />
                    ) : focusHistoryData.length === 0 ? (
                      <p className="text-sm text-gray-500 italic text-center py-16">No focus sessions recorded yet.</p>
                    ) : (
                      <div className="space-y-6">
                        <div className="h-72 bg-gray-55/30 dark:bg-gray-900/10 p-3 rounded-xl border border-gray-150 dark:border-gray-800">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={focusHistoryData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
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

                        {/* List of past sessions */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">Session Details Logs</h4>
                          <div className="max-h-48 overflow-y-auto space-y-2.5 divide-y divide-gray-100 dark:divide-gray-800">
                            {focusHistoryData.map((session, sidx) => (
                              <div key={sidx} className="pt-2 flex items-center justify-between text-xs">
                                <div>
                                  <p className="font-bold text-gray-900 dark:text-white">{session.lesson_title} ({session.course_title})</p>
                                  <p className="text-gray-500 font-semibold mt-0.5">Taught by {session.teacher_name} • {new Date(session.started_at).toLocaleString()}</p>
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
                      </div>
                    )}
                  </div>
                )}

                {/* ATTENDANCE SUBTAB */}
                {classroomSubTabStudent === 'attendance' && (
                  <div className="space-y-6">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-3 flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-indigo-500" /> My Attendance Logs
                    </h3>
                    <p className="text-sm text-gray-650 dark:text-gray-400">
                      View your physical classroom attendance logs and overall attendance rate for each enrolled classroom.
                    </p>

                    {loadingAttendance ? (
                      <Loading text="Loading attendance history..." />
                    ) : !studentAttendanceHistory || !studentAttendanceHistory.stats || studentAttendanceHistory.stats.length === 0 ? (
                      <p className="text-sm text-gray-500 italic text-center py-16">No attendance records found yet.</p>
                    ) : (
                      <div className="space-y-6">
                        {/* Stats Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {studentAttendanceHistory.stats.map((stat: any, idx: number) => (
                            <Card key={idx} className="bg-gray-55/30 dark:bg-gray-900/10 border border-gray-150 dark:border-gray-800 p-4">
                              <div className="flex justify-between items-center">
                                <div>
                                  <p className="text-xs text-gray-550 font-bold uppercase tracking-wider">{stat.classroom_name}</p>
                                  <p className="text-xs text-gray-450 dark:text-gray-400 mt-0.5">Room: {stat.room_number || 'N/A'}</p>
                                </div>
                                <span className={`text-2xl font-bold ${
                                  stat.attendance_rate >= 90 ? 'text-green-500' :
                                  stat.attendance_rate >= 75 ? 'text-yellow-500' :
                                  'text-red-500'
                                }`}>
                                  {stat.attendance_rate}%
                                </span>
                              </div>
                              <div className="mt-3 flex items-center gap-3">
                                <div className="flex-1 bg-gray-250 dark:bg-gray-750 rounded-full h-1.5">
                                  <div 
                                    className="bg-indigo-50 h-1.5 rounded-full transition-all duration-500" 
                                    style={{ width: `${stat.attendance_rate}%` }}
                                  />
                                </div>
                                <span className="text-xs text-gray-505 font-bold">{stat.present_days} / {stat.total_days} days present</span>
                              </div>
                            </Card>
                          ))}
                        </div>

                        {/* Logs list */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-bold text-gray-850 dark:text-gray-200">Chronological Check-in Logs</h4>
                          <div className="max-h-60 overflow-y-auto space-y-2.5 divide-y divide-gray-100 dark:divide-gray-850">
                            {studentAttendanceHistory.logs.map((log: any) => (
                              <div key={log.id} className="pt-2 flex items-center justify-between text-xs">
                                <div>
                                  <p className="font-bold text-gray-800 dark:text-gray-200">{log.classroom_name}</p>
                                  <p className="text-gray-500 font-semibold mt-0.5">{new Date(log.timestamp).toLocaleString()}</p>
                                </div>
                                <span className="px-2.5 py-1 rounded-full font-bold text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 uppercase tracking-wide">
                                  {log.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        {/* Interactive Timed Quiz Taking Interface Overlay */}
        <AnimatePresence>
          {activeQuiz !== null && (
            <div className="fixed inset-0 z-50 bg-[#0B0F19] text-gray-100 flex flex-col p-6 animate-in fade-in duration-300">
              {/* Header */}
              <header className="flex justify-between items-center mb-6 bg-gray-900/50 p-4 rounded-xl border border-gray-800">
                <div>
                  <h3 className="text-xl font-bold text-purple-400">{activeQuiz.title}</h3>
                  <p className="text-xs text-gray-400 mt-1">{activeQuiz.description}</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 bg-purple-500/10 px-4 py-2 rounded-xl border border-purple-500/30">
                    <Clock className="w-5 h-5 text-purple-400 animate-pulse" />
                    <span className="font-mono text-lg font-bold text-purple-400">
                      {Math.floor(quizTimerSeconds / 60)}:{(quizTimerSeconds % 60).toString().padStart(2, '0')}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm("Are you sure you want to exit? Your progress will not be saved.")) {
                        setActiveQuiz(null);
                      }
                    }}
                    className="p-2 hover:bg-gray-800 rounded-full transition-colors"
                  >
                    <X className="w-6 h-6 text-gray-400" />
                  </button>
                </div>
              </header>

              {/* Questions Area */}
              <div className="flex-1 overflow-y-auto max-w-3xl mx-auto w-full space-y-6 pb-20">
                {(() => {
                  const questions = JSON.parse(activeQuiz.quiz_questions_json || '[]');
                  if (questions.length === 0) {
                    return <p className="text-gray-400 italic text-center py-12">This quiz has no questions.</p>;
                  }
                  return questions.map((q: any, qidx: number) => (
                    <Card key={qidx} className="bg-gray-900/40 border border-gray-800 p-5 space-y-3">
                      <h4 className="font-bold text-base text-gray-100">
                        {qidx + 1}. {q.question_text}
                      </h4>
                      <div className="grid grid-cols-1 gap-2.5">
                        {q.options.map((opt: string, oidx: number) => {
                          const optionLetter = ['A', 'B', 'C', 'D'][oidx];
                          const isSelected = quizAnswers[qidx] === optionLetter;
                          return (
                            <button
                              key={oidx}
                              onClick={() => setQuizAnswers({ ...quizAnswers, [qidx]: optionLetter })}
                              className={`w-full text-left p-3 rounded-xl border text-sm transition-all flex items-center justify-between ${
                                isSelected
                                  ? 'bg-purple-600/20 border-purple-500 text-purple-300 font-bold'
                                  : 'bg-gray-900/20 border-gray-800 text-gray-300 hover:bg-gray-800'
                              }`}
                            >
                              <span>{optionLetter}. {opt}</span>
                              <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                isSelected ? 'border-purple-500 bg-purple-500' : 'border-gray-600'
                              }`}>
                                {isSelected && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </Card>
                  ));
                })()}
              </div>

              {/* Footer action */}
              <div className="bg-gray-900/80 border-t border-gray-800 p-4 fixed bottom-0 left-0 right-0 flex justify-center backdrop-blur-md">
                <Button
                  disabled={isSubmittingQuiz}
                  className="max-w-md w-full py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl shadow-lg shadow-purple-500/20"
                  onClick={handleSubmitQuiz}
                >
                  <CheckCircle className="h-5 w-5 mr-2" />
                  <span>Submit Quiz Answers</span>
                </Button>
              </div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </Layout>
  );
};
