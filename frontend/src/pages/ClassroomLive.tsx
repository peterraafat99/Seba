import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/utils/api';
import { Activity, Users, AlertTriangle, ArrowLeft, StopCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart, CartesianGrid } from 'recharts';

export function ClassroomLive() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const [metrics, setMetrics] = useState({ total_detected: 0, focused_count: 0, distracted_count: 0, focus_rate: 0 });
  const [students, setStudents] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>('connecting');
  
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Connect to WebSocket
    const wsUrl = `ws://127.0.0.1:8000/api/cv/ws/${id}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setStatus('connected');
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'update') {
        setMetrics(data.metrics);
        setStudents(data.students);
        
        // Add to history for chart
        setHistory(prev => {
          const newPoint = { 
            time: new Date(data.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' }), 
            rate: data.metrics.focus_rate 
          };
          const newHistory = [...prev, newPoint];
          if (newHistory.length > 30) newHistory.shift(); // Keep last 30 data points
          return newHistory;
        });
      }
    };

    ws.onerror = () => setStatus('error');
    ws.onclose = () => setStatus('disconnected');

    return () => {
      ws.close();
    };
  }, [id]);

  const handleStopSession = async () => {
    if (!id) return;
    try {
      await api.stopCvSession(id);
      wsRef.current?.close();
      navigate('/school');
    } catch (error) {
      console.error("Failed to stop session", error);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F19] text-gray-100 p-6 font-sans">
      {/* Header */}
      <header className="flex justify-between items-center mb-8 bg-gray-900/50 p-4 rounded-2xl border border-gray-800 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/school')}
            className="p-2 hover:bg-gray-800 rounded-full transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-gray-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-400">
              Live Classroom Monitor
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="relative flex h-3 w-3">
                {status === 'connected' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
                <span className={`relative inline-flex rounded-full h-3 w-3 ${status === 'connected' ? 'bg-green-500' : 'bg-red-500'}`}></span>
              </span>
              <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                {status === 'connected' ? 'Streaming Live' : 'Connection Lost'}
              </span>
            </div>
          </div>
        </div>
        <button 
          onClick={handleStopSession}
          className="flex items-center gap-2 px-5 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/50 rounded-xl font-medium transition-all"
        >
          <StopCircle className="w-5 h-5" />
          End Session
        </button>
      </header>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <MetricCard 
          title="Overall Focus Rate" 
          value={`${metrics.focus_rate}%`} 
          icon={<Activity className="w-6 h-6 text-blue-400" />}
          colorClass={metrics.focus_rate > 75 ? "text-green-400" : metrics.focus_rate > 50 ? "text-yellow-400" : "text-red-400"}
        />
        <MetricCard 
          title="Total Detected" 
          value={metrics.total_detected.toString()} 
          icon={<Users className="w-6 h-6 text-purple-400" />}
          colorClass="text-gray-100"
        />
        <MetricCard 
          title="Currently Focused" 
          value={metrics.focused_count.toString()} 
          icon={<Activity className="w-6 h-6 text-green-400" />}
          colorClass="text-green-400"
        />
        <MetricCard 
          title="Distracted" 
          value={metrics.distracted_count.toString()} 
          icon={<AlertTriangle className="w-6 h-6 text-red-400" />}
          colorClass={metrics.distracted_count > 0 ? "text-red-400" : "text-gray-400"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Chart */}
        <div className="lg:col-span-2 bg-gray-900/50 border border-gray-800 rounded-3xl p-6 backdrop-blur-md">
          <h2 className="text-lg font-semibold text-gray-300 mb-6">Focus Trend (Last 60s)</h2>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="colorRate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                <XAxis dataKey="time" stroke="#4b5563" tick={{fill: '#9ca3af', fontSize: 12}} />
                <YAxis domain={[0, 100]} stroke="#4b5563" tick={{fill: '#9ca3af', fontSize: 12}} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                  itemStyle={{ color: '#e5e7eb' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="rate" 
                  stroke="#3b82f6" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorRate)" 
                  animationDuration={300}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Student Grid */}
        <div className="bg-gray-900/50 border border-gray-800 rounded-3xl p-6 backdrop-blur-md overflow-hidden flex flex-col h-full">
          <h2 className="text-lg font-semibold text-gray-300 mb-6 flex justify-between items-center">
            <span>Live Analysis</span>
            <span className="text-sm font-normal text-gray-500 bg-gray-800 px-3 py-1 rounded-full">
              {students.length} faces tracked
            </span>
          </h2>
          <div className="overflow-y-auto pr-2 space-y-3 flex-1" style={{ maxHeight: '20rem' }}>
            <AnimatePresence>
              {students.map((student, idx) => (
                <StudentCard key={student.student_id + idx} student={student} />
              ))}
            </AnimatePresence>
            {students.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
                <Users className="w-10 h-10 opacity-50" />
                <p>Waiting for camera feed...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon, colorClass }: any) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-3xl p-6 flex items-center gap-5 backdrop-blur-md">
      <div className="p-4 bg-gray-800/80 rounded-2xl border border-gray-700 shadow-inner">
        {icon}
      </div>
      <div>
        <p className="text-sm text-gray-400 font-medium tracking-wide">{title}</p>
        <p className={`text-3xl font-bold mt-1 ${colorClass}`}>
          {value}
        </p>
      </div>
    </div>
  );
}

function StudentCard({ student }: { student: any }) {
  const isFocused = student.status === 'FOCUSED';
  
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.2 }}
      className={`p-4 rounded-2xl border ${
        isFocused 
          ? 'bg-green-500/5 border-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.05)]' 
          : 'bg-red-500/10 border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.15)]'
      } flex justify-between items-center backdrop-blur-sm`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${isFocused ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
        <div>
          <p className="font-semibold text-gray-200">
            {student.student_id === 'UNKNOWN' ? 'Unidentified Student' : `Student ID: ${student.student_id}`}
          </p>
          <p className="text-xs text-gray-500 mt-1 font-mono">
            P: {student.pose.pitch}° | Y: {student.pose.yaw}°
          </p>
        </div>
      </div>
      <div className={`text-xs font-bold px-3 py-1.5 rounded-lg uppercase tracking-wider ${
        isFocused ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
      }`}>
        {student.status}
      </div>
    </motion.div>
  );
}
