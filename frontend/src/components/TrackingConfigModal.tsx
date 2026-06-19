import React, { useState, useEffect } from 'react';
import { X, Sliders, Brain, Eye, Clock, AlertTriangle, Shield, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/utils/api';

interface TrackingConfig {
  pitch_threshold: number;
  yaw_threshold: number;
  distraction_timer_sec: number;
  is_exam_room: boolean;
  neighbor_yaw_threshold: number;
  rapid_change_count: number;
  rapid_change_window_sec: number;
  camera_source: string;
  nfc_only: boolean;
}

const DEFAULT_CONFIG: TrackingConfig = {
  pitch_threshold: 20,
  yaw_threshold: 30,
  distraction_timer_sec: 10,
  is_exam_room: false,
  neighbor_yaw_threshold: 25,
  rapid_change_count: 3,
  rapid_change_window_sec: 5,
  camera_source: '0',
  nfc_only: false,
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  classroom: any;
  onSaved?: () => void;
}

export function TrackingConfigModal({ isOpen, onClose, classroom, onSaved }: Props) {
  const [config, setConfig] = useState<TrackingConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (classroom) {
      try {
        const parsed = classroom.exam_config_json
          ? (typeof classroom.exam_config_json === 'string'
              ? JSON.parse(classroom.exam_config_json)
              : classroom.exam_config_json)
          : {};
        setConfig({
          ...DEFAULT_CONFIG,
          ...parsed,
          is_exam_room: classroom.is_exam_room ?? false,
          camera_source: classroom.camera_source ?? '0',
          nfc_only: parsed.nfc_only ?? false,
        });
      } catch {
        setConfig({
          ...DEFAULT_CONFIG,
          is_exam_room: classroom?.is_exam_room ?? false,
          camera_source: classroom?.camera_source ?? '0',
          nfc_only: false,
        });
      }
    }
  }, [classroom]);

  const handleSave = async () => {
    if (!classroom) return;
    setSaving(true);
    try {
      await api.updateClassroomConfig(classroom.id, config);
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onSaved?.();
        onClose();
      }, 1200);
    } catch (err) {
      console.error('Failed to save config:', err);
      alert('Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: keyof TrackingConfig, value: number | boolean | string) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-700"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sliders className="w-5 h-5 text-white" />
              <div>
                <h2 className="text-lg font-bold text-white">Pipeline Configuration</h2>
                <p className="text-xs text-indigo-200">{classroom?.name || 'Classroom'}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
              <X className="w-5 h-5 text-white" />
            </button>
          </div>

          <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
            {/* Exam Mode Toggle */}
            <div className="flex items-center justify-between p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white text-sm">Exam Proctoring Mode</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Enables neighbor-glance & rapid-scan detection</p>
                </div>
              </div>
              <button
                onClick={() => updateField('is_exam_room', !config.is_exam_room)}
                className={`relative w-12 h-6 rounded-full transition-colors ${config.is_exam_room ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.is_exam_room ? 'translate-x-6' : ''}`} />
              </button>
            </div>

            {/* Camera Source Selector */}
            <div className="space-y-2 p-4 bg-gray-50 dark:bg-gray-700/20 rounded-xl border border-gray-200 dark:border-gray-750">
              <label className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Camera className="w-4 h-4 text-indigo-500" /> Camera Device / Source
              </label>
              <select
                value={config.camera_source}
                onChange={e => updateField('camera_source', e.target.value)}
                className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-750 text-gray-900 dark:text-white text-sm focus:border-indigo-500 focus:outline-none"
              >
                <option value="0" className="text-gray-950 dark:text-gray-100 bg-white dark:bg-gray-800">Camera 0 (Built-in Webcam / External 1)</option>
                <option value="1" className="text-gray-955 dark:text-gray-100 bg-white dark:bg-gray-800">Camera 1 (NVIDIA Broadcast / Second Camera)</option>
                <option value="2" className="text-gray-955 dark:text-gray-100 bg-white dark:bg-gray-800">Camera 2 (External USB Webcam)</option>
                <option value="3" className="text-gray-955 dark:text-gray-100 bg-white dark:bg-gray-800">Camera 3</option>
                {config.camera_source && !['0', '1', '2', '3'].includes(config.camera_source) && (
                  <option value={config.camera_source} className="text-gray-955 dark:text-gray-100 bg-white dark:bg-gray-800">{config.camera_source} (Custom/RTSP Link)</option>
                )}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">Select the webcam index (0, 1, 2) that the background CV pipeline will monitor.</p>
            </div>

            {/* Proctoring Mode Selector */}
            <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-700/20 rounded-xl border border-gray-200 dark:border-gray-750">
              <label className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-500" /> Proctoring Mode
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => updateField('nfc_only', true)}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${config.nfc_only ? 'border-indigo-600 bg-blue-50/20 dark:bg-indigo-900/10' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 bg-white dark:bg-gray-800'}`}
                >
                  <span className="block font-bold text-xs text-gray-900 dark:text-white">Mode 1: NFC Scoped</span>
                  <span className="block text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Only track checked-in students.</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateField('nfc_only', false)}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${!config.nfc_only ? 'border-indigo-600 bg-blue-50/20 dark:bg-indigo-900/10' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 bg-white dark:bg-gray-800'}`}
                >
                  <span className="block font-bold text-xs text-gray-900 dark:text-white">Mode 2: Normal Roster</span>
                  <span className="block text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Track all enrolled students.</span>
                </button>
              </div>
            </div>

            {/* Focus Thresholds */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Brain className="w-4 h-4" /> Focus Detection Thresholds
              </h3>

              {/* Pitch Threshold */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <Eye className="w-4 h-4 text-blue-500" /> Pitch Threshold
                  </label>
                  <span className="text-sm font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-indigo-600 dark:text-indigo-400">
                    {config.pitch_threshold}°
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={45}
                  step={1}
                  value={config.pitch_threshold}
                  onChange={e => updateField('pitch_threshold', Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
                <p className="text-xs text-gray-400">Head tilted up/down beyond this angle = distracted</p>
              </div>

              {/* Yaw Threshold */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <Eye className="w-4 h-4 text-purple-500" /> Yaw Threshold
                  </label>
                  <span className="text-sm font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-indigo-600 dark:text-indigo-400">
                    {config.yaw_threshold}°
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={60}
                  step={1}
                  value={config.yaw_threshold}
                  onChange={e => updateField('yaw_threshold', Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-600"
                />
                <p className="text-xs text-gray-400">Head turned left/right beyond this angle = distracted</p>
              </div>

              {/* Distraction Timer */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-green-500" /> Distraction Timer
                  </label>
                  <span className="text-sm font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-indigo-600 dark:text-indigo-400">
                    {config.distraction_timer_sec}s
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={30}
                  step={0.5}
                  value={config.distraction_timer_sec}
                  onChange={e => updateField('distraction_timer_sec', Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-600"
                />
                <p className="text-xs text-gray-400">Continuous distraction for this long → "NOT FOCUS"</p>
              </div>
            </div>

            {/* Exam Mode Settings */}
            {config.is_exam_room && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="space-y-4 p-4 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-200 dark:border-red-800"
              >
                <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Exam Anti-Cheat Settings
                </h3>

                {/* Neighbor Yaw */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Neighbor Glance Yaw</label>
                    <span className="text-sm font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-red-600 dark:text-red-400">
                      {config.neighbor_yaw_threshold}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={50}
                    step={1}
                    value={config.neighbor_yaw_threshold}
                    onChange={e => updateField('neighbor_yaw_threshold', Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-600"
                  />
                </div>

                {/* Rapid Scan Count */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Rapid Scan Count</label>
                    <span className="text-sm font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-red-600 dark:text-red-400">
                      {config.rapid_change_count}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={10}
                    step={1}
                    value={config.rapid_change_count}
                    onChange={e => updateField('rapid_change_count', Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-600"
                  />
                  <p className="text-xs text-gray-400">Direction reversals within window to flag as cheating</p>
                </div>

                {/* Rapid Scan Window */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Rapid Scan Window</label>
                    <span className="text-sm font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-red-600 dark:text-red-400">
                      {config.rapid_change_window_sec}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={15}
                    step={0.5}
                    value={config.rapid_change_window_sec}
                    onChange={e => updateField('rapid_change_window_sec', Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-600"
                  />
                </div>
              </motion.div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`px-6 py-2 text-sm font-bold rounded-lg transition-all ${
                saved
                  ? 'bg-green-500 text-white'
                  : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg shadow-indigo-500/30'
              }`}
            >
              {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Configuration'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
