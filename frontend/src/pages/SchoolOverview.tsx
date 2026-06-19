import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/utils/api';
import { School, Users, Camera, Activity, Play, Settings } from 'lucide-react';
import { motion } from 'framer-motion';
import { TrackingConfigModal } from '@/components/TrackingConfigModal';
import { Layout } from '@/components/layout/Layout';

export function SchoolOverview() {
  const navigate = useNavigate();
  const [classrooms, setClassrooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [selectedClassroom, setSelectedClassroom] = useState<any>(null);

  // Scoped multi-school states:
  const [schools, setSchools] = useState<any[]>([]);
  const [activeSchoolId, setActiveSchoolId] = useState<number | null>(null);

  const userString = localStorage.getItem('user');
  const user = userString ? JSON.parse(userString) : null;
  const isSuperAdmin = user?.role === 'super_admin';

  const fetchClassrooms = async (schoolId: number) => {
    try {
      const response = await api.getClassrooms(schoolId);
      setClassrooms(response.data);
    } catch (error) {
      console.error("Error fetching classrooms:", error);
    }
  };

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      if (isSuperAdmin) {
        const schoolsResponse = await api.getSchools();
        setSchools(schoolsResponse.data);
        if (schoolsResponse.data.length > 0) {
          const firstSchoolId = schoolsResponse.data[0].id;
          setActiveSchoolId(firstSchoolId);
          await fetchClassrooms(firstSchoolId);
        }
      } else {
        const targetSchoolId = user?.school_id || 1;
        setActiveSchoolId(targetSchoolId);
        await fetchClassrooms(targetSchoolId);
      }
    } catch (error) {
      console.error("Error fetching school overview data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchData = async () => {
    if (activeSchoolId !== null) {
      await fetchClassrooms(activeSchoolId);
    }
  };

  const handleSchoolChange = async (schoolId: number) => {
    try {
      setLoading(true);
      setActiveSchoolId(schoolId);
      await fetchClassrooms(schoolId);
    } catch (error) {
      console.error("Error changing school:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartSession = async (classroomId: number) => {
    try {
      const room = classrooms.find(r => r.id === classroomId);
      const cameraSource = room?.camera_source || '0';
      const sessionType = room?.is_exam_room ? 'exam' : 'class';
      
      let nfcOnly = false;
      if (room?.exam_config_json) {
        try {
          const parsed = typeof room.exam_config_json === 'string'
            ? JSON.parse(room.exam_config_json)
            : room.exam_config_json;
          nfcOnly = !!parsed.nfc_only;
        } catch (e) {
          console.error("Failed to parse exam_config_json:", e);
        }
      }

      await api.startCvSession(classroomId, sessionType, cameraSource, undefined, undefined, undefined, nfcOnly);
      navigate(`/school/classroom/${classroomId}/live`);
    } catch (error) {
      console.error("Failed to start session:", error);
      alert("Failed to start CV session. Ensure the backend is running and the camera is available.");
    }
  };

  const handleOpenConfig = (room: any) => {
    setSelectedClassroom(room);
    setConfigModalOpen(true);
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-gray-900 dark:text-gray-100">
        <header className="mb-12 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight flex items-center gap-4">
              <School className="w-10 h-10 text-indigo-500" />
              {isSuperAdmin ? "Super Admin Campus Overview" : "School Campus Overview"}
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-2 text-lg">
              Manage physical classrooms and initiate real-time AI monitoring sessions.
            </p>
          </div>

          {isSuperAdmin && schools.length > 0 && (
            <div className="flex items-center gap-2 bg-white dark:bg-gray-800 p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
              <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">School:</span>
              <select
                value={activeSchoolId || ''}
                onChange={(e) => handleSchoolChange(Number(e.target.value))}
                className="bg-transparent border-none outline-none font-bold text-indigo-600 dark:text-indigo-400 cursor-pointer"
              >
                {schools.map((s) => (
                  <option key={s.id} value={s.id} className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </header>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
          </div>
        ) : classrooms.length === 0 ? (
          <div className="text-center py-20">
            <Camera className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-400 dark:text-gray-500">No Classrooms Found</h2>
            <p className="text-gray-400 dark:text-gray-600 mt-2">Create a classroom via the admin API to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {classrooms.map((room) => (
              <motion.div
                key={room.id}
                whileHover={{ y: -5, scale: 1.02 }}
                className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden border border-gray-100 dark:border-gray-700 transition-all"
              >
                <div className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h2 className="text-2xl font-bold">{room.name}</h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Room: {room.room_number || 'N/A'}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleOpenConfig(room)}
                        className="p-3 bg-gray-100 dark:bg-gray-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 rounded-lg transition-colors group"
                        title="Configure Tracking Thresholds"
                      >
                        <Settings className="w-5 h-5 text-gray-400 group-hover:text-indigo-500 transition-colors" />
                      </button>
                      <div className="p-3 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                        <Camera className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-3 mb-6">
                    <div className="flex items-center gap-3 text-gray-600 dark:text-gray-300">
                      <Users className="w-5 h-5" />
                      <span>Capacity: {room.capacity || 30} students</span>
                    </div>
                    <div className="flex items-center gap-3 text-gray-600 dark:text-gray-300">
                      <Activity className="w-5 h-5" />
                      <span>Mode: {room.is_exam_room ? 'Exam Proctoring' : 'Classroom Monitoring'}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleStartSession(room.id)}
                    className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl font-medium shadow-lg shadow-indigo-500/30 flex items-center justify-center gap-2 transition-all"
                  >
                    <Play className="w-5 h-5 fill-current" />
                    Start Live Monitoring
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Tracking Configuration Modal */}
      <TrackingConfigModal
        isOpen={configModalOpen}
        onClose={() => setConfigModalOpen(false)}
        classroom={selectedClassroom}
        onSaved={fetchData}
      />
    </Layout>
  );
}
