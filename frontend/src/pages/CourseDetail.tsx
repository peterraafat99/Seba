import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  Clock, Users, BookOpen, Play, ChevronRight, Video, FileText, Plus, 
  Check, CheckCircle2, Circle, Upload, X, Download, Calendar, Award, ChevronDown, Trash2
} from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';
import { Alert } from '@/components/ui/Alert';
import { api } from '@/utils/api';
import { t } from '@/utils/language';
import { useLanguage } from '@/contexts/LanguageContext';

interface Lesson {
  id: string;
  title: string;
  duration: number;
  completed: boolean;
  order: number;
  term?: string;
}

interface Course {
  id: string;
  title: string;
  description: string;
  instructor: string;
  duration: number;
  enrolled: number;
  thumbnail?: string;
  isEnrolled?: boolean;
  progress?: number;
  lessons: Lesson[];
}

export const CourseDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [course, setCourse] = useState<Course | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const { language } = useLanguage();

  const [activeTab, setActiveTab] = useState<'syllabus' | 'classwork'>('syllabus');
  const [classwork, setClasswork] = useState<any[]>([]);
  const [loadingClasswork, setLoadingClasswork] = useState(false);
  const [showAddClassworkModal, setShowAddClassworkModal] = useState(false);
  const [newClassworkForm, setNewClassworkForm] = useState({
    title: '',
    description: '',
    classwork_type: 'homework',
    resource_url: '',
    max_grade: 10,
    due_date: ''
  });
  const [submittingClasswork, setSubmittingClasswork] = useState(false);
  const [expandedClassworkId, setExpandedClassworkId] = useState<number | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Record<number, File>>({});
  const [uploadingSubmissionId, setUploadingSubmissionId] = useState<number | null>(null);

  const userStr = localStorage.getItem('user');
  const currentUser = userStr ? JSON.parse(userStr) : null;
  const isTeacherOrAdmin = currentUser && ['teacher', 'admin', 'school_admin', 'super_admin'].includes(currentUser.role);

  useEffect(() => {
    if (id) {
      loadCourse();
      loadClasswork();
    }
  }, [id]);

  const loadClasswork = async () => {
    try {
      setLoadingClasswork(true);
      const res = await api.getClasswork(id!);
      setClasswork(res.data);
    } catch (err) {
      console.error("Failed to load classwork", err);
    } finally {
      setLoadingClasswork(false);
    }
  };

  const handleAddClasswork = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmittingClasswork(true);
      await api.createClasswork(id!, {
        title: newClassworkForm.title,
        description: newClassworkForm.description || undefined,
        classwork_type: newClassworkForm.classwork_type,
        resource_url: newClassworkForm.resource_url || undefined,
        max_grade: newClassworkForm.max_grade ? Number(newClassworkForm.max_grade) : undefined,
        due_date: newClassworkForm.due_date || undefined
      });
      setShowAddClassworkModal(false);
      setNewClassworkForm({
        title: '',
        description: '',
        classwork_type: 'homework',
        resource_url: '',
        max_grade: 10,
        due_date: ''
      });
      await loadClasswork();
    } catch (err) {
      console.error("Failed to create classwork", err);
    } finally {
      setSubmittingClasswork(false);
    }
  };

  const handleToggleCompleted = async (cwId: number, currentCompleted: boolean) => {
    try {
      if (currentCompleted) {
        await api.unsubmitClasswork(cwId);
      } else {
        const formData = new FormData();
        formData.append('completed', 'true');
        await api.submitClasswork(cwId, formData);
      }
      await loadClasswork();
    } catch (err) {
      console.error("Failed to toggle completion", err);
    }
  };

  const handleFileUpload = async (cwId: number) => {
    const file = selectedFiles[cwId];
    if (!file) return;
    
    try {
      setUploadingSubmissionId(cwId);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('completed', 'true');
      await api.submitClasswork(cwId, formData);
      
      const updatedFiles = { ...selectedFiles };
      delete updatedFiles[cwId];
      setSelectedFiles(updatedFiles);
      
      await loadClasswork();
    } catch (err) {
      console.error("Failed to upload solution file", err);
    } finally {
      setUploadingSubmissionId(null);
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

  const loadCourse = async () => {
    try {
      setIsLoading(true);
      const response = await api.getCourse(id!);
      const courseData = response.data;
      // Normalize thumbnail URL
      if (courseData.thumbnail) {
        courseData.thumbnail = normalizeImageUrl(courseData.thumbnail);
      }
      setCourse(courseData);
    } catch (err: any) {
      setError(err.response?.data?.message || t('errorOccurred', language));
    } finally {
      setIsLoading(false);
    }
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

  if (error || !course) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Alert type="error">{error || 'Course not found'}</Alert>
        </div>
      </Layout>
    );
  }

  const handleEnroll = async () => {
    try {
      setIsEnrolling(true);
      await api.enrollInCourse(id!);
      await loadCourse(); // Reload to update enrollment status
    } catch (err: any) {
      setError(err.response?.data?.detail || t('errorOccurred', language));
    } finally {
      setIsEnrolling(false);
    }
  };

  const nextLesson = course.lessons.find((l) => !l.completed);
  const completedCount = course.lessons.filter((l) => l.completed).length;
  const progress = course.progress !== undefined
    ? course.progress
    : (course.lessons.length > 0 ? (completedCount / course.lessons.length) * 100 : 0);
  const isCompleted = progress >= 100 && course.lessons.length > 0;

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Course Header */}
        <div className="mb-8">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="md:w-1/3">
              <div className="aspect-video bg-gradient-to-br from-blue-400 to-violet-500 rounded-xl overflow-hidden">
                {course.thumbnail ? (
                  <img
                    src={course.thumbnail}
                    alt={course.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <BookOpen className="h-16 w-16 text-white" />
                  </div>
                )}
              </div>
            </div>
            <div className="md:w-2/3">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">
                {course.title}
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                {course.description}
              </p>
              <div className="flex flex-wrap gap-4 mb-4">
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <Users className="h-4 w-4" />
                  <span>{course.instructor}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <Clock className="h-4 w-4" />
                  <span>
                    {Math.floor(course.duration / 60)}h {course.duration % 60}m
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <Users className="h-4 w-4" />
                  <span>{course.enrolled} {t('enrolled', language)}</span>
                </div>
              </div>
              {course.isEnrolled && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {t('progress', language)}
                    </span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {isNaN(progress) ? 0 : Math.round(progress)}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${isNaN(progress) ? 0 : Math.min(100, Math.max(0, progress))}%` }}
                    />
                  </div>
                </div>
              )}
              {!course.isEnrolled ? (
                <Button onClick={handleEnroll} isLoading={isEnrolling}>
                  <Play className="h-4 w-4 mr-2" />
                  {t('enroll', language)}
                </Button>
              ) : nextLesson ? (
                <Link to={`/lessons/${nextLesson.id}`}>
                  <Button>
                    <Play className="h-4 w-4 mr-2" />
                    {t('continueCourse', language)}
                  </Button>
                </Link>
              ) : isCompleted ? (
                <Button disabled>{t('course', language)} {t('completed', language)}</Button>
              ) : (
                <Link to={`/lessons/${course.lessons[0]?.id}`}>
                  <Button>
                    <Play className="h-4 w-4 mr-2" />
                    {t('startCourse', language) || 'Start Course'}
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 border-b border-gray-250 dark:border-gray-700 overflow-x-auto">
          <button
            onClick={() => setActiveTab('syllabus')}
            className={`px-6 py-3 font-semibold transition-colors whitespace-nowrap ${activeTab === 'syllabus'
              ? 'text-blue-500 border-b-2 border-blue-500'
              : 'text-gray-650 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
          >
            {language === 'ar' ? 'المقرر الدراسي' : 'Syllabus & Lessons'}
          </button>
          <button
            onClick={() => setActiveTab('classwork')}
            className={`px-6 py-3 font-semibold transition-colors whitespace-nowrap ${activeTab === 'classwork'
              ? 'text-blue-500 border-b-2 border-blue-500'
              : 'text-gray-650 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
          >
            {language === 'ar' ? 'المهام الدراسية' : 'Classwork'}
          </button>
        </div>

        {/* Syllabus Tab Content */}
        {activeTab === 'syllabus' && (
          <Card>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              {t('lessons', language)}
            </h2>
            {Object.entries(
              course.lessons.reduce((groups, lesson) => {
                const term = lesson.term || 'General';
                if (!groups[term]) groups[term] = [];
                groups[term].push(lesson);
                return groups;
              }, {} as Record<string, Lesson[]>)
            ).sort().map(([term, lessons]) => (
              <div key={term} className="mb-8 last:mb-0">
                {term !== 'General' && (
                  <h3 className="text-lg font-bold text-gray-800 dark:text-gray-200 mb-3 border-b border-gray-200 dark:border-gray-700 pb-2">
                    {term}
                  </h3>
                )}
                <div className="space-y-2">
                  {lessons.map((lesson) => (
                    <Link
                      key={lesson.id}
                      to={`/lessons/${lesson.id}`}
                      className="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-55 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-medium">
                          {lesson.order}
                        </div>
                        <div className="flex-1">
                          <h3 className="font-medium text-gray-900 dark:text-white">
                            {lesson.title}
                          </h3>
                          <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {lesson.duration} min
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {lesson.completed && (
                          <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                            {t('completed', language)}
                          </span>
                        )}
                        <ChevronRight className="h-5 w-5 text-gray-400" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        )}

        {/* Classwork Tab Content */}
        {activeTab === 'classwork' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                {language === 'ar' ? 'المهام والأنشطة الدراسية' : 'Course Classwork & Assignments'}
              </h2>
              {isTeacherOrAdmin && (
                <Button onClick={() => setShowAddClassworkModal(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  {language === 'ar' ? 'إضافة مهمة جديدة' : 'Add Classwork'}
                </Button>
              )}
            </div>

            {loadingClasswork ? (
              <Loading text={t('loading', language)} />
            ) : classwork.length === 0 ? (
              <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm animate-in fade-in duration-500">
                <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <h4 className="text-lg font-bold text-gray-900 dark:text-white">
                  {language === 'ar' ? 'لا يوجد مهام دراسية' : 'No Classwork Yet'}
                </h4>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {language === 'ar' ? 'لم يقم المعلم بنشر أي مهام أو ملفات بعد.' : 'The instructor hasn\'t published any classwork materials yet.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {classwork.map((item) => {
                  const isExpanded = expandedClassworkId === item.id;
                  
                  const typeColors = {
                    homework: { bg: 'bg-rose-500/10 text-rose-500 border-rose-500/20', icon: Award, label: language === 'ar' ? 'واجب منزلي' : 'Homework' },
                    pdf: { bg: 'bg-sky-500/10 text-sky-500 border-sky-500/20', icon: FileText, label: 'PDF' },
                    video: { bg: 'bg-amber-500/10 text-amber-500 border-amber-500/20', icon: Video, label: language === 'ar' ? 'فيديو تعليمي' : 'Video Tutorial' },
                    quiz: { bg: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20', icon: CheckCircle2, label: language === 'ar' ? 'اختبار' : 'Quiz' },
                    document: { bg: 'bg-violet-500/10 text-violet-500 border-violet-500/20', icon: BookOpen, label: language === 'ar' ? 'ملف مستند' : 'Document' }
                  };
                  
                  const typeMeta = typeColors[item.classwork_type as keyof typeof typeColors] || typeColors.document;
                  const TypeIcon = typeMeta.icon;
                  
                  return (
                    <div
                      key={item.id}
                      className={`border rounded-xl transition-all overflow-hidden ${
                        item.completed
                          ? 'border-green-250 dark:border-green-800/40 bg-green-500/5 dark:bg-green-500/5'
                          : 'border-gray-250 dark:border-gray-700 bg-white dark:bg-gray-800 hover:shadow-md'
                      }`}
                    >
                      {/* Header */}
                      <div
                        onClick={() => setExpandedClassworkId(isExpanded ? null : item.id)}
                        className="p-4 flex items-center justify-between cursor-pointer select-none"
                      >
                        <div className="flex items-center gap-4 flex-1">
                          {!isTeacherOrAdmin && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleCompleted(item.id, item.completed);
                              }}
                              className="focus:outline-none"
                            >
                              {item.completed ? (
                                <CheckCircle2 className="h-6 w-6 text-green-500 fill-green-500/10" />
                              ) : (
                                <Circle className="h-6 w-6 text-gray-400 hover:text-blue-500" />
                              )}
                            </button>
                          )}
                          
                          <div className={`p-2.5 rounded-lg border ${typeMeta.bg}`}>
                            <TypeIcon className="h-5 w-5" />
                          </div>
                          
                          <div>
                            <h3 className="font-bold text-gray-900 dark:text-white text-base">
                              {item.title}
                            </h3>
                            <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-500">
                              <span className="font-semibold">{typeMeta.label}</span>
                              {item.due_date && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3.5 w-3.5" />
                                  {language === 'ar' ? 'تاريخ التسليم:' : 'Due:'} {item.due_date}
                                </span>
                              )}
                              {item.max_grade && (
                                <span className="flex items-center gap-1 font-semibold text-indigo-500">
                                  <Award className="h-3.5 w-3.5" />
                                  {item.max_grade} {language === 'ar' ? 'درجة' : 'marks'}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          {item.completed && (
                            <span className="hidden sm:inline-block px-2.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-bold rounded-full">
                              {language === 'ar' ? 'تم التسليم' : 'Turned In'}
                            </span>
                          )}
                          <ChevronDown className={`h-5 w-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </div>
                      
                      {/* Expanded Section */}
                      {isExpanded && (
                        <div className="px-6 pb-6 pt-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/20 text-sm">
                          <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-6 whitespace-pre-line">
                            {item.description || (language === 'ar' ? 'لا يوجد وصف متاح.' : 'No description provided.')}
                          </p>
                          
                          {item.resource_url && (
                            <div className="mb-6">
                              <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-2.5">
                                {language === 'ar' ? 'المرفقات والروابط' : 'Attachments & Resources'}
                              </h4>
                              <a
                                href={normalizeImageUrl(item.resource_url) || '#'}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-3 p-3.5 border border-gray-250 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 hover:bg-blue-50/20 dark:hover:bg-blue-900/10 text-blue-600 dark:text-blue-400 transition-colors"
                              >
                                <TypeIcon className="h-5 w-5" />
                                <div className="text-left">
                                  <div className="text-sm font-semibold truncate max-w-[250px] sm:max-w-[400px]">
                                    {item.title} Resource
                                  </div>
                                  <div className="text-xs text-gray-550 truncate max-w-[200px]">
                                    {item.resource_url}
                                  </div>
                                </div>
                                <Download className="h-4.5 w-4.5 ml-2 text-gray-400" />
                              </a>
                            </div>
                          )}
                          
                          {!isTeacherOrAdmin && item.classwork_type === 'homework' && (
                            <div className="border-t border-gray-200 dark:border-gray-700 pt-5 mt-4 animate-in fade-in duration-300">
                              <h4 className="font-bold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-1.5">
                                <Award className="h-4.5 w-4.5 text-indigo-500" />
                                <span>{language === 'ar' ? 'عملك الحالي' : 'Your Solution'}</span>
                              </h4>
                              
                              {item.submission_file_url ? (
                                <div className="space-y-4">
                                  <div className="flex items-center justify-between p-3.5 bg-white dark:bg-gray-850 rounded-xl border border-gray-200 dark:border-gray-750 shadow-sm">
                                    <div className="flex items-center gap-3">
                                      <FileText className="h-8 w-8 text-rose-500" />
                                      <div className="text-left">
                                        <a
                                          href={normalizeImageUrl(item.submission_file_url) || '#'}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="font-semibold text-blue-500 hover:underline"
                                        >
                                          {item.submission_file_url.split('/').pop()}
                                        </a>
                                        <div className="text-xs text-gray-500 mt-0.5">
                                          {language === 'ar' ? 'تم الرفع:' : 'Uploaded:'} {item.submitted_at ? new Date(item.submitted_at).toLocaleString() : 'N/A'}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {item.grade !== null && (
                                        <span className="text-sm font-bold text-indigo-650 bg-indigo-50 dark:bg-indigo-950/30 px-3 py-1 rounded-lg">
                                          {language === 'ar' ? 'الدرجة:' : 'Grade:'} {item.grade} / {item.max_grade}
                                        </span>
                                      )}
                                      <button
                                        onClick={() => handleToggleCompleted(item.id, true)}
                                        className="p-2 hover:bg-red-50 dark:hover:bg-red-950/20 text-red-500 rounded-lg transition-colors"
                                        title={language === 'ar' ? 'إلغاء التسليم' : 'Unsubmit'}
                                      >
                                        <Trash2 className="h-5 w-5" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-4">
                                  <p className="text-xs text-gray-500">
                                    {language === 'ar'
                                      ? 'يرجى اختيار ملف الحل الخاص بك والضغط على تسليم.'
                                      : 'Please select your solution file (PDF, Word, Code, etc.) and click Turn In.'}
                                  </p>
                                  <div className="flex flex-col sm:flex-row items-center gap-3">
                                    <div className="relative flex-1 w-full">
                                      <input
                                        type="file"
                                        accept=".pdf,.docx,.doc,.ipynb,.py,.zip,.rar"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (file) {
                                            setSelectedFiles({ ...selectedFiles, [item.id]: file });
                                          }
                                        }}
                                        className="hidden"
                                        id={`solution-file-${item.id}`}
                                      />
                                      <label
                                        htmlFor={`solution-file-${item.id}`}
                                        className="flex items-center justify-between px-4 py-2.5 border border-dashed border-gray-300 dark:border-gray-650 rounded-xl bg-white dark:bg-gray-800 text-sm cursor-pointer hover:bg-gray-50 hover:border-blue-400 dark:hover:bg-gray-750 transition-colors w-full"
                                      >
                                        <span className="text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                                          {selectedFiles[item.id]?.name || (language === 'ar' ? 'اختر ملف الحل...' : 'Select solution file...')}
                                        </span>
                                        <Upload className="h-4.5 w-4.5 text-gray-400 flex-shrink-0" />
                                      </label>
                                    </div>
                                    
                                    <Button
                                      onClick={() => handleFileUpload(item.id)}
                                      disabled={!selectedFiles[item.id] || uploadingSubmissionId === item.id}
                                      isLoading={uploadingSubmissionId === item.id}
                                      className="w-full sm:w-auto"
                                    >
                                      {language === 'ar' ? 'تسليم الحل' : 'Turn In Solution'}
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Add Classwork Modal (Teachers/Admins only) */}
        {showAddClassworkModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl border border-gray-200 dark:border-gray-700"
            >
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                {language === 'ar' ? 'إضافة مهمة دراسية جديدة' : 'Add New Classwork'}
              </h3>
              
              <form onSubmit={handleAddClasswork} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                    {language === 'ar' ? 'نوع المهمة الدراسية' : 'Classwork Type'}
                  </label>
                  <select
                    className="w-full p-2.5 border border-gray-300 dark:border-gray-650 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    value={newClassworkForm.classwork_type}
                    onChange={(e) => setNewClassworkForm({ ...newClassworkForm, classwork_type: e.target.value })}
                  >
                    <option value="homework">{language === 'ar' ? 'واجب منزلي' : 'Homework Assignment'}</option>
                    <option value="pdf">PDF Handbook / Cheat sheet</option>
                    <option value="video">{language === 'ar' ? 'فيديو تعليمي' : 'Video Tutorial'}</option>
                    <option value="quiz">{language === 'ar' ? 'اختبار' : 'Quiz'}</option>
                    <option value="document">{language === 'ar' ? 'مستند / ملف' : 'Document / Note'}</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {language === 'ar' ? 'العنوان' : 'Title'}
                  </label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-650 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    value={newClassworkForm.title}
                    onChange={(e) => setNewClassworkForm({ ...newClassworkForm, title: e.target.value })}
                    required
                    placeholder={language === 'ar' ? 'مثال: واجب الدرس الأول في لغة HTML' : 'e.g. HTML Lesson 1 Exercises'}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                    {language === 'ar' ? 'الوصف والتعليمات' : 'Description & Instructions'}
                  </label>
                  <textarea
                    value={newClassworkForm.description}
                    onChange={(e) => setNewClassworkForm({ ...newClassworkForm, description: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-650 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    rows={4}
                    placeholder={language === 'ar' ? 'اكتب تعليمات المهمة للطلاب بالتفصيل...' : 'Write detailed instructions for the students...'}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {newClassworkForm.classwork_type === 'homework' && (
                    <div className="space-y-1">
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                        {language === 'ar' ? 'الدرجة القصوى' : 'Maximum Grade'}
                      </label>
                      <input
                        type="number"
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-655 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        value={newClassworkForm.max_grade}
                        onChange={(e) => setNewClassworkForm({ ...newClassworkForm, max_grade: parseInt(e.target.value) || 10 })}
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {language === 'ar' ? 'تاريخ التسليم' : 'Due Date'}
                    </label>
                    <input
                      type="text"
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-650 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      value={newClassworkForm.due_date}
                      onChange={(e) => setNewClassworkForm({ ...newClassworkForm, due_date: e.target.value })}
                      placeholder="e.g. 2026-06-30 or June 30"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {language === 'ar' ? 'رابط المرفقات (URL)' : 'Resource Attachment Link (URL)'}
                  </label>
                  <input
                    type="url"
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-650 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    value={newClassworkForm.resource_url}
                    onChange={(e) => setNewClassworkForm({ ...newClassworkForm, resource_url: e.target.value })}
                    placeholder="https://example.com/file.pdf"
                  />
                </div>

                <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <Button type="submit" className="flex-1" isLoading={submittingClasswork}>
                    {language === 'ar' ? 'نشر المهمة' : 'Publish Classwork'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowAddClassworkModal(false);
                      setNewClassworkForm({
                        title: '',
                        description: '',
                        classwork_type: 'homework',
                        resource_url: '',
                        max_grade: 10,
                        due_date: ''
                      });
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
      </div>
    </Layout>
  );
};
