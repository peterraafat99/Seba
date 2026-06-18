import { useEffect, useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Send,
  ThumbsUp,
  ThumbsDown,
  CheckCircle2,
  BookOpen, // Icon for Content Tab
  Play,     // Icon for Video Tab
  HelpCircle, // Icon for Quiz Tab
  MessageSquare, // Icon for Chat Tab
  Sparkles,
  RefreshCw,
  Camera,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  X,
  PlayCircle
} from 'lucide-react';
import ReactPlayer from 'react-player';

// --- FOR MARKDOWN & MATH ---
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

import { Layout } from '@/components/layout/Layout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loading } from '@/components/ui/Loading';
import { Alert } from '@/components/ui/Alert';
import { api } from '@/utils/api';
import { t } from '@/utils/language';
import { useLanguage } from '@/contexts/LanguageContext';

import { DIAGRAM_REGISTRY } from '@/components/lessons/diagrams';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  helpful?: boolean;
  type?: 'text' | 'quiz_widget';
  data?: any;
  audioBase64?: string;
}

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
}
interface QuizData {
  title?: string;
  difficulty?: string;
  questions: QuizQuestion[];
}

interface Lesson {
  id: string;
  title: string;
  videoUrl: string;
  description: string; // Short description for Video Tab
  content?: string;    // Long content for Content Tab (legacy)
  content_en?: string; // English content
  content_ar?: string; // Arabic content
  diagramId?: string;  // ID to lookup in Registry
  courseId: string;
  courseTitle: string;
  nextLessonId?: string;
  previousLessonId?: string;
  quiz?: {
    questions: QuizQuestion[];
  };
}

export const Lesson = () => {
  const { id } = useParams<{ id: string }>();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // TABS: Added 'content' to the list
  const [activeTab, setActiveTab] = useState<'video' | 'content' | 'quiz' | 'chat'>('video');

  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [isActiveLearning, setIsActiveLearning] = useState(false);
  const [activeLearningMessages, setActiveLearningMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState<number | null>(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  
  // Multimodal states & refs
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
  const [recordedAudioBlob, setRecordedAudioBlob] = useState<Blob | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<any>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const { language } = useLanguage();
  const navigate = useNavigate();

  const [activeQuiz, setActiveQuiz] = useState<QuizData | null>(null);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [modelBackend, setModelBackend] = useState<'ollama' | 'gemini'>(() => {
    return (localStorage.getItem('modelBackend') as 'ollama' | 'gemini') || 'ollama';
  });

  useEffect(() => {
    localStorage.setItem('modelBackend', modelBackend);
  }, [modelBackend]);

  // Track session time every 10 seconds
  useEffect(() => {
    if (!id) return;
    const interval = setInterval(() => {
      api.trackLessonTime(id, 10).catch(err => console.error("Tracking failed", err));
    }, 10000);
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    if (id) {
      loadLesson();
      startSession();
    }
    return () => {
      if (sessionStarted && id) {
        endSession();
      }
    };
  }, [id]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [chatMessages, activeLearningMessages]);

  useEffect(() => {
    return () => {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    };
  }, []);

  const loadLesson = async () => {
    try {
      setIsLoading(true);
      const response = await api.getLesson(id!);
      setLesson(response.data);
      if (response.data.quiz) {
        setActiveQuiz({
          title: "Standard Quiz",
          questions: response.data.quiz.questions
        });
      }
    } catch (err: any) {
      setError(err.response?.data?.message || t('errorOccurred', language));
    } finally {
      setIsLoading(false);
    }
  };
  const handleGenerateQuiz = async () => {
    setIsGeneratingQuiz(true);
    setQuizSubmitted(false);
    setQuizAnswers({});
    setQuizScore(null);
    setActiveTab('quiz');

    try {
      const response = await api.generateQuiz(id!, modelBackend);
      const backendQuiz = response.data;

      const formattedQuiz: QuizData = {
        title: backendQuiz.title,
        difficulty: backendQuiz.difficulty,
        questions: backendQuiz.questions.map((q: any) => ({
          id: q.id.toString(),
          question: q.text,
          options: q.options,
          correctAnswer: q.correct_option_index
        }))
      };

      setActiveQuiz(formattedQuiz);
    } catch (err) {
      console.error("Failed to generate quiz", err);
    } finally {
      setIsGeneratingQuiz(false);
    }
  };
  const startSession = async () => {
    try {
      await api.startSession(id!);
      setSessionStarted(true);
    } catch (err) {
      console.error('Failed to start session:', err);
    }
  };

  const endSession = async () => {
    try {
      await api.endSession(id!, Math.floor(videoProgress));
    } catch (err) {
      console.error('Failed to end session:', err);
    }
  };

  const toggleActiveLearning = async () => {
    if (!lesson) return;
    const newMode = !isActiveLearning;
    setIsActiveLearning(newMode);
    
    if (newMode && activeLearningMessages.length === 0) {
      setIsChatLoading(true);
      try {
        const res = await api.startActiveLearning(lesson.id, modelBackend);
        setActiveLearningMessages([{
          id: Date.now().toString(),
          role: 'assistant',
          content: res.data.message,
          timestamp: new Date()
        }]);
      } catch (err) {
        console.error(err);
      } finally {
        setIsChatLoading(false);
      }
    }
  };

  // Audio playback, recording, and image helpers
  const playBase64Audio = (base64Str: string) => {
    try {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      const binaryString = window.atob(base64Str);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes.buffer], { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;
      audio.play().catch(e => console.error("Audio playback failed:", e));
    } catch (err) {
      console.error("Failed to play base64 audio", err);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearSelectedImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  };

  const startRecording = async () => {
    try {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setRecordedAudioBlob(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Failed to start recording:", err);
      alert(language === 'ar' ? 'فشل الوصول إلى الميكروفون' : 'Failed to access microphone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    }
  };

  const clearRecordedAudio = () => {
    setRecordedAudioBlob(null);
  };

  const handleSendMessage = async () => {
    if (isChatLoading || !lesson) return;

    const hasText = !!chatInput.trim();
    const hasImage = !!selectedImage;
    const hasAudio = !!recordedAudioBlob;

    if (!hasText && !hasImage && !hasAudio) return;

    if (isActiveLearning) {
      if (!hasText) return;
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: chatInput,
        timestamp: new Date(),
      };
      setActiveLearningMessages((prev) => [...prev, userMessage]);
      setChatInput('');
      setIsChatLoading(true);
      try {
        const response = await api.sendActiveLearningMessage(lesson.id, userMessage.content, modelBackend);
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: response.data.message,
          timestamp: new Date()
        };
        setActiveLearningMessages((prev) => [...prev, assistantMessage]);
      } catch (err: any) {
        setActiveLearningMessages((prev) => [...prev, {
          id: (Date.now() + 1).toString(), role: 'assistant', content: "Error: " + (err.response?.data?.message || "Failed to send"), timestamp: new Date()
        }]);
      } finally {
        setIsChatLoading(false);
      }
      return;
    }

    // Multimodal chat
    let userMessageContent = chatInput;
    if (hasImage && !hasText) {
      userMessageContent = language === 'ar' ? "📷 تم إرسال صورة" : "📷 Sent an image";
    } else if (hasAudio && !hasText) {
      userMessageContent = language === 'ar' ? "🎤 تم إرسال رسالة صوتية" : "🎤 Sent a voice note";
    } else if (hasImage && hasText) {
      userMessageContent = `📷 [${language === 'ar' ? 'صورة مرفقة' : 'Image Attached'}] ${chatInput}`;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessageContent,
      timestamp: new Date(),
    };

    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput('');
    
    const tempImage = selectedImage;
    const tempAudio = recordedAudioBlob;
    
    setSelectedImage(null);
    setImagePreview(null);
    setRecordedAudioBlob(null);
    setIsChatLoading(true);

    try {
      const response = await api.sendMultimodalChat(
        lesson.id,
        chatInput,
        tempImage,
        tempAudio,
        voiceOutputEnabled,
        modelBackend
      );
      
      const responseData = response.data;
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseData.message || "",
        timestamp: new Date(),
        type: responseData.type || 'text',
        data: responseData.data || null,
        audioBase64: responseData.audio_base64 || undefined
      };
      
      setChatMessages((prev) => [...prev, assistantMessage]);

      if (voiceOutputEnabled && responseData.audio_base64) {
        playBase64Audio(responseData.audio_base64);
      }
    } catch (err: any) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: err.response?.data?.message || t('errorOccurred', language),
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleQuizSubmit = async () => {
    if (!activeQuiz) return;
    let correctCount = 0;
    const totalQuestions = activeQuiz.questions.length;

    activeQuiz.questions.forEach((question) => {
      if (quizAnswers[question.id] === question.correctAnswer) {
        correctCount++;
      }
    });

    const calculatedScore = totalQuestions > 0
      ? Math.round((correctCount / totalQuestions) * 100)
      : 0;
    setQuizScore(calculatedScore);
    setQuizSubmitted(true);

    try {
      // FIXED: Always submit quiz results with calculated score
      await api.submitQuiz(id!, quizAnswers, calculatedScore);
    } catch (err) {
      console.log("Background sync failed, but user saw score so it's fine.");
    }
  };

  const handleFeedback = async (messageId: string, helpful: boolean) => {
    try {
      await api.feedbackChat(messageId, helpful);
      setChatMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, helpful } : msg))
      );
    } catch (err) {
      console.error('Failed to submit feedback:', err);
    }
  };

  const handleCompleteLesson = async () => {
    try {
      await api.logLesson(id!, { completed: true });
      await api.feedbackLesson(id!, '', true);
      if (lesson?.nextLessonId) {
        navigate(`/lessons/${lesson.nextLessonId}`);
      } else {
        navigate(`/courses/${lesson?.courseId}`);
      }
    } catch (err) {
      console.error('Failed to complete lesson:', err);
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

  if (error || !lesson) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Alert type="error">{error || 'Lesson not found'}</Alert>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <Link
            to={`/courses/${lesson.courseId}`}
            className="text-sm text-blue-500 hover:underline mb-2 inline-flex items-center gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            {lesson.courseTitle}
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            {lesson.title}
          </h1>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">

          {/* 1. Video Tab */}
          <button
            onClick={() => setActiveTab('video')}
            className={`px-4 py-2 font-medium transition-colors whitespace-nowrap flex items-center gap-2 ${activeTab === 'video'
              ? 'text-blue-500 border-b-2 border-blue-500'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
          >
            <Play className="w-4 h-4" />
            {t('video', language)}
          </button>

          {/* 2. Content Tab (Only if content exists) */}
          {(lesson.content || lesson.content_en || lesson.content_ar) && (
            <button
              onClick={() => setActiveTab('content')}
              className={`px-4 py-2 font-medium transition-colors whitespace-nowrap flex items-center gap-2 ${activeTab === 'content'
                ? 'text-blue-500 border-b-2 border-blue-500'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
            >
              <BookOpen className="w-4 h-4" />
              {t('lessonContent' as any, language) || 'Notes'}
            </button>
          )}


          {/* 3. Quiz Tab - Always Visible */}
          <button
            onClick={() => setActiveTab('quiz')}
            className={`px-4 py-2 font-medium transition-colors whitespace-nowrap flex items-center gap-2 ${activeTab === 'quiz'
              ? 'text-blue-500 border-b-2 border-blue-500'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
          >
            <HelpCircle className="w-4 h-4" />
            {t('quiz', language)}
          </button>


          {/* 4. Chat Tab */}
          <button
            onClick={() => setActiveTab('chat')}
            className={`px-4 py-2 font-medium transition-colors whitespace-nowrap flex items-center gap-2 ${activeTab === 'chat'
              ? 'text-blue-500 border-b-2 border-blue-500'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
          >
            <MessageSquare className="w-4 h-4" />
            {t('studyAssistant' as any, language)}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content Area */}
          <div className="lg:col-span-2">

            {/* ========================================================= */}
            {/* TAB 1: VIDEO (Video + Description only) */}
            {/* ========================================================= */}
            {activeTab === 'video' && (
              <Card padding="none" className="overflow-hidden">
                <div className="aspect-video bg-black">
                  <ReactPlayer
                    url={lesson.videoUrl}
                    width="100%"
                    height="100%"
                    controls
                    onProgress={(state) => setVideoProgress(state.playedSeconds)}
                  />
                </div>
                <div className="p-6">
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                    {t('video', language)}
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    {lesson.description}
                  </p>

                  <Button onClick={handleCompleteLesson} className="w-full">
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    {t('completeLesson', language)}
                  </Button>
                </div>
              </Card>
            )}

            {/* ========================================================= */}
            {/* TAB 2: CONTENT (JSON Text + Registry Diagram) */}
            {/* ========================================================= */}
            {activeTab === 'content' && (lesson.content || lesson.content_en || lesson.content_ar) && (
              <Card>
                <div className="p-6">
                  <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-6 pb-4 border-b-2 border-blue-500">
                    {t('lessonContent' as any, language) || 'Lecture Notes'}
                  </h2>

                  <div className="prose prose-lg dark:prose-invert max-w-none 
                    prose-headings:text-gray-900 dark:prose-headings:text-white
                    prose-headings:font-bold prose-headings:border-b prose-headings:border-gray-200 dark:prose-headings:border-gray-700 prose-headings:pb-2 prose-headings:mb-4
                    prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl
                    prose-p:text-gray-700 dark:prose-p:text-gray-300 prose-p:leading-relaxed prose-p:mb-4
                    prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:underline hover:prose-a:text-blue-800
                    prose-strong:text-gray-900 dark:prose-strong:text-white prose-strong:font-semibold
                    prose-ul:my-4 prose-ul:list-disc prose-ul:pl-6
                    prose-ol:my-4 prose-ol:list-decimal prose-ol:pl-6
                    prose-li:text-gray-700 dark:prose-li:text-gray-300 prose-li:mb-2
                    prose-code:bg-gray-100 dark:prose-code:bg-gray-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm
                    prose-pre:bg-gray-900 dark:prose-pre:bg-gray-950 prose-pre:p-4 prose-pre:rounded-lg prose-pre:overflow-x-auto
                    prose-blockquote:border-l-4 prose-blockquote:border-blue-500 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-gray-600 dark:prose-blockquote:text-gray-400
                    prose-hr:border-gray-300 dark:prose-hr:border-gray-700 prose-hr:my-8
                  ">
                    <ReactMarkdown
                      remarkPlugins={[remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {(() => {
                        // Language-aware content selection
                        if (language === 'ar' && lesson.content_ar) {
                          return lesson.content_ar;
                        } else if (language === 'en' && lesson.content_en) {
                          return lesson.content_en;
                        } else if (lesson.content_en) {
                          return lesson.content_en;
                        } else if (lesson.content) {
                          return lesson.content;
                        } else {
                          return lesson.content_ar || "No content available.";
                        }
                      })()}
                    </ReactMarkdown>
                  </div>

                  {/* The Diagram (Rendered from Registry if ID exists) */}
                  {lesson.diagramId && DIAGRAM_REGISTRY[lesson.diagramId] && (
                    <div className="mt-8 border-t-2 border-gray-100 dark:border-gray-700 pt-8">
                      <h3 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
                        <span className="w-1 h-8 bg-blue-500 rounded"></span>
                        {t('visualAid' as any, language) || 'Visual Aid'}
                      </h3>
                      {(() => {
                        const DiagramComponent = DIAGRAM_REGISTRY[lesson.diagramId!];
                        return <DiagramComponent />;
                      })()}
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* ========================================================= */}
            {/* TAB 3: QUIZ (Updated for AI)                              */}
            {/* ========================================================= */}
            {activeTab === 'quiz' && (
              <Card>
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                      {activeQuiz?.title || t('quiz', language)}
                    </h2>
                    {activeQuiz?.difficulty && (
                      <span className={`text-xs px-2 py-1 rounded-full ${activeQuiz.difficulty === 'EASY' ? 'bg-green-100 text-green-800' :
                        activeQuiz.difficulty === 'HARD' ? 'bg-red-100 text-red-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                        {activeQuiz.difficulty}
                      </span>
                    )}
                  </div>

                  {/* THE MAGIC BUTTON */}
                  <Button
                    variant="outline"
                    onClick={handleGenerateQuiz}
                    disabled={isGeneratingQuiz}
                    className="flex items-center gap-2"
                  >
                    {isGeneratingQuiz ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-purple-500" />
                    )}
                    {t('generateNewQuiz' as any, language) || 'Generate AI Quiz'}
                  </Button>
                </div>

                {/* LOAD STATE */}
                {isGeneratingQuiz && (
                  <div className="py-12 text-center">
                    <Loading text="Analyzing your progress and generating questions..." />
                  </div>
                )}

                {/* QUIZ CONTENT (Using activeQuiz state instead of lesson.quiz) */}
                {!isGeneratingQuiz && activeQuiz && (
                  <>
                    {quizSubmitted && quizScore !== null ? (
                      // ... (Keep existing Score UI, just update text) ...
                      <div className="text-center py-8">
                        <div className="text-4xl font-bold text-blue-500 mb-2">{quizScore}%</div>
                        <Button onClick={() => { setQuizSubmitted(false); setQuizAnswers({}); }}>
                          Retry This Quiz
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {activeQuiz.questions.map((question, index) => (
                          <div key={question.id} className="border-b border-gray-200 dark:border-gray-700 pb-6 last:border-0">
                            <h3 className="font-medium text-gray-900 dark:text-white mb-3">
                              {index + 1}. {question.question}
                            </h3>
                            <div className="space-y-2">
                              {question.options.map((option, optIndex) => (
                                <label key={optIndex} className="flex items-center p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={question.id}
                                    value={optIndex}
                                    checked={quizAnswers[question.id] === optIndex}
                                    onChange={() => setQuizAnswers({ ...quizAnswers, [question.id]: optIndex })}
                                    className="mr-3"
                                  />
                                  <span className="text-gray-700 dark:text-gray-300">{option}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                        <Button onClick={handleQuizSubmit} className="w-full mt-4">
                          {t('submitQuiz', language)}
                        </Button>
                      </div>
                    )}
                  </>
                )}

                {/* EMPTY STATE (If no quiz exists) */}
                {!isGeneratingQuiz && !activeQuiz && (
                  <div className="text-center py-12">
                    <p className="text-gray-500 mb-4">No standard quiz available for this lesson.</p>
                    <Button onClick={handleGenerateQuiz}>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate Personalized Quiz
                    </Button>
                  </div>
                )}
              </Card>
            )}

            {/* ========================================================= */}
            {/* TAB 4: CHAT (Assistant) */}
            {/* ========================================================= */}
            {activeTab === 'chat' && (
              <Card padding="none" className="flex flex-col h-[600px]">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    {isActiveLearning ? <Sparkles className="h-5 w-5 text-purple-500 animate-pulse" /> : <MessageSquare className="h-5 w-5 text-blue-500" />}
                    {isActiveLearning ? "Active Learning Mode" : t('studyAssistant' as any, language)}
                  </h2>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={toggleActiveLearning}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-all border ${
                        isActiveLearning 
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-800 shadow-sm' 
                          : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 hover:border-gray-300 shadow-sm'
                      }`}
                    >
                      {isActiveLearning ? "Exit Active Mode" : "Start Active Learning"}
                    </button>
                    {/* Model switcher removed here, now placed in the global sidebar card */}
                  </div>
                </div>
                <div ref={chatContainerRef} className={`flex-1 overflow-y-auto p-4 space-y-4 ${isActiveLearning ? 'bg-purple-50/10 dark:bg-purple-950/5' : ''}`}>
                  {!isActiveLearning && chatMessages.length === 0 && (
                    <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                      {t('askQuestion', language)}
                    </div>
                  )}
                  {isActiveLearning && activeLearningMessages.length === 0 && (
                    <div className="text-center py-8">
                      <Sparkles className="w-8 h-8 text-purple-400 mx-auto mb-3 animate-pulse" />
                      <p className="text-purple-650 dark:text-purple-400 font-semibold text-sm">Starting your personalized lesson flow...</p>
                    </div>
                  )}
                  {((isActiveLearning ? activeLearningMessages : chatMessages) || []).map((message) => (
                    <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-lg p-3 ${message.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                        }`}>

                        <div className={`prose max-w-none text-sm ${message.role === 'user'
                          ? 'prose-invert text-white' // Force white text on blue background
                          : 'prose-gray dark:prose-invert text-gray-900 dark:text-white' // Standard for gray bubbles
                          }`}>
                          <ReactMarkdown
                            remarkPlugins={[remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                            components={{
                              // Fix Table Styling
                              table: ({ node, ...props }) => (
                                <div className="overflow-x-auto my-2 rounded-lg border border-gray-200 dark:border-gray-700">
                                  <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700" {...props} />
                                </div>
                              ),
                              th: ({ node, ...props }) => (
                                <th className="px-3 py-2 bg-gray-100 dark:bg-gray-800 font-semibold text-left text-gray-900 dark:text-white" {...props} />
                              ),
                              td: ({ node, ...props }) => (
                                <td className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 text-gray-700 dark:text-gray-300" {...props} />
                              ),
                              // Fix Image Handling - Catches ![Alt text] even without URL
                              img: ({ node, ...props }) => {
                                // If we have a real URL from the backend, show the actual image!
                                if (props.src) {
                                  return (
                                    <div className="my-6 flex flex-col items-center">
                                      <img
                                        {...props}
                                        className="rounded-xl shadow-lg max-w-full h-auto border-2 border-gray-100 dark:border-gray-800 transition-all hover:scale-[1.01]"
                                        loading="lazy"
                                        referrerPolicy="no-referrer" // Helps bypass some hotlink protections
                                      />
                                      {props.alt && (
                                        <p className="mt-2 text-xs text-gray-500 italic bg-gray-50 dark:bg-gray-800 px-3 py-1 rounded-full border border-gray-100 dark:border-gray-700">
                                          🔍 {props.alt}
                                        </p>
                                      )}
                                    </div>
                                  );
                                }

                                // Only show this if there is NO URL found
                                return (
                                  <div className="my-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center gap-3">
                                    <span className="text-xl">🖼️</span>
                                    <span className="text-sm italic">Finding diagram for: {props.alt}</span>
                                  </div>
                                );
                              },
                              p: ({ node, ...props }) => {
                                // This ensures that if the AI sends text [Image of...] without standard Markdown formatting, 
                                // we still don't show the raw text as a "Diagram:" box, but let it be handled by the backend.
                                return <p className="mb-4 last:mb-0 leading-relaxed" {...props} />;
                              }
                            }}
                          >
                            {message.content}
                          </ReactMarkdown>
                        </div>


                        {message.type === 'quiz_widget' && message.data && (
                          <div className="mt-4 p-4 bg-white dark:bg-gray-800 rounded-lg border border-purple-200 dark:border-purple-900 shadow-sm">
                            <div className="flex items-center gap-2 mb-2">
                              <Sparkles className="h-5 w-5 text-purple-500" />
                              <span className="font-semibold text-purple-700 dark:text-purple-400">Personalized Quiz Ready</span>
                            </div>
                            <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                              {message.data.title} ({message.data.difficulty})
                            </p>
                            <Button
                              size="sm"
                              className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                              onClick={() => {
                                // Load the data into the Quiz Tab and switch tabs
                                const backendQuiz = message.data;
                                const formattedQuiz: QuizData = {
                                  title: backendQuiz.title,
                                  difficulty: backendQuiz.difficulty,
                                  questions: backendQuiz.questions.map((q: any) => ({
                                    id: q.id.toString(),
                                    question: q.text,
                                    options: q.options,
                                    correctAnswer: q.correct_option_index
                                  }))
                                };
                                setActiveQuiz(formattedQuiz);
                                setQuizSubmitted(false);
                                setQuizAnswers({});
                                setQuizScore(null);
                                setActiveTab('quiz');
                              }}
                            >
                              Take Quiz Now
                            </Button>
                          </div>
                        )}
                        {message.role === 'assistant' && (
                          <div className="flex gap-2 mt-2 items-center">
                            {message.audioBase64 && (
                              <button
                                onClick={() => playBase64Audio(message.audioBase64!)}
                                className="p-1 rounded hover:bg-gray-205 dark:hover:bg-gray-600 text-blue-500"
                                title={language === 'ar' ? 'إعادة تشغيل الصوت' : 'Replay audio'}
                              >
                                <Volume2 className="h-3 w-3" />
                              </button>
                            )}
                            <button
                              onClick={() => handleFeedback(message.id, true)}
                              className={`p-1 rounded ${message.helpful === true
                                ? 'bg-green-500 text-white'
                                : 'hover:bg-gray-200 dark:hover:bg-gray-600'
                                }`}
                            >
                              <ThumbsUp className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => handleFeedback(message.id, false)}
                              className={`p-1 rounded ${message.helpful === false
                                ? 'bg-red-500 text-white'
                                : 'hover:bg-gray-200 dark:hover:bg-gray-600'
                                }`}
                            >
                              <ThumbsDown className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {isChatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3">
                        <p className="text-gray-600 dark:text-gray-400">
                          {t('thinking', language)}...
                        </p>
                      </div>
                    </div>
                  )}

                </div>
                <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                  {/* Previews for attached media */}
                  {(imagePreview || recordedAudioBlob) && (
                    <div className="flex flex-wrap gap-3 mb-3 p-2 bg-gray-50 dark:bg-gray-800/40 rounded-lg border border-gray-100 dark:border-gray-700/50">
                      {imagePreview && (
                        <div className="relative group w-16 h-16 rounded border border-gray-200 dark:border-gray-700 overflow-hidden bg-black/5 flex items-center justify-center">
                          <img src={imagePreview} alt="Preview" className="max-w-full max-h-full object-cover" />
                          <button
                            type="button"
                            onClick={clearSelectedImage}
                            className="absolute top-0.5 right-0.5 p-1 bg-black/60 hover:bg-black/85 text-white rounded-full transition-colors"
                            title="Remove image"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      
                      {recordedAudioBlob && (
                        <div className="relative flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded border border-blue-150 dark:border-blue-800/40 text-xs font-semibold">
                          <PlayCircle className="h-4 w-4 animate-pulse" />
                          <span>
                            {language === 'ar' ? 'مسجل صوتي جاهز' : 'Voice message ready'}
                          </span>
                          <button
                            type="button"
                            onClick={clearRecordedAudio}
                            className="p-0.5 bg-blue-200 hover:bg-blue-300 dark:bg-blue-900/60 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300 rounded-full transition-colors ml-1"
                            title="Remove audio"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Hidden image input */}
                  <input
                    type="file"
                    accept="image/*"
                    ref={imageInputRef}
                    onChange={handleImageChange}
                    className="hidden"
                  />

                  <div className="flex gap-2 items-center">
                    {isRecording ? (
                      <div className="flex-1 flex items-center justify-between bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-lg px-4 py-2 text-sm text-red-600 dark:text-red-400">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                          <span className="font-semibold">
                            {language === 'ar' ? 'جاري التسجيل...' : 'Recording...'}
                          </span>
                          <span className="font-mono bg-red-100 dark:bg-red-900/40 px-2 py-0.5 rounded text-xs">
                            {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={stopRecording}
                          className="border-red-200 hover:bg-red-100 text-red-600 dark:border-red-900 dark:hover:bg-red-950"
                        >
                          <MicOff className="h-4 w-4 mr-1.5" />
                          {language === 'ar' ? 'إيقاف' : 'Stop'}
                        </Button>
                      </div>
                    ) : (
                      <>
                        {/* Camera/Photo button (only in standard chat) */}
                        {!isActiveLearning && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => imageInputRef.current?.click()}
                            disabled={isChatLoading}
                            title={language === 'ar' ? 'إرفاق صورة' : 'Attach image'}
                          >
                            <Camera className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                          </Button>
                        )}

                        {/* Mic button (only in standard chat) */}
                        {!isActiveLearning && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={startRecording}
                            disabled={isChatLoading}
                            title={language === 'ar' ? 'تسجيل صوتي' : 'Record audio'}
                          >
                            <Mic className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                          </Button>
                        )}

                        {/* Speaker toggle */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setVoiceOutputEnabled(!voiceOutputEnabled)}
                          disabled={isChatLoading}
                          title={voiceOutputEnabled ? (language === 'ar' ? 'إيقاف نطق الإجابة' : 'Disable voice reply') : (language === 'ar' ? 'تفعيل نطق الإجابة' : 'Enable voice reply')}
                          className={voiceOutputEnabled ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800' : ''}
                        >
                          {voiceOutputEnabled ? (
                            <Volume2 className="h-4 w-4 text-blue-500 dark:text-blue-400" />
                          ) : (
                            <VolumeX className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                          )}
                        </Button>

                        <Input
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                          placeholder={t('askQuestion', language)}
                          disabled={isChatLoading}
                          className="flex-1"
                        />
                        <Button
                          onClick={handleSendMessage}
                          disabled={isChatLoading || (!chatInput.trim() && !selectedImage && !recordedAudioBlob)}
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <Card>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-500 animate-pulse" />
                AI Tutor Engine
              </h3>
              <div className="space-y-2">
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Applies to Chat, Active Learning, and Quizzes.
                  </span>
                  <select
                    value={modelBackend}
                    onChange={(e) => setModelBackend(e.target.value as 'ollama' | 'gemini')}
                    className="w-full text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-2.5 py-1.5 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-semibold shadow-sm transition-all hover:border-gray-300 dark:hover:border-gray-600 cursor-pointer"
                  >
                    <option value="ollama">Local Qwen (Ollama)</option>
                    <option value="gemini">Gemma 4 31B (Cloud API)</option>
                  </select>
                </div>
              </div>
            </Card>

            <Card>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
                {t('lesson', language)} {t('navigation', language)}
              </h3>
              <div className="space-y-2">
                {lesson.previousLessonId && (
                  <Link
                    to={`/lessons/${lesson.previousLessonId}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {t('previousLesson', language)}
                    </span>
                    <ChevronLeft className="h-4 w-4 text-gray-400" />
                  </Link>
                )}
                {lesson.nextLessonId && (
                  <Link
                    to={`/lessons/${lesson.nextLessonId}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {t('nextLesson', language)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  </Link>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
};