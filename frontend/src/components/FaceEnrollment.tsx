import React, { useState, useCallback } from 'react';
import { api } from '@/utils/api';
import { Upload, Camera, CheckCircle, XCircle } from 'lucide-react';
import { motion } from 'framer-motion';

export function FaceEnrollment({ studentId, studentName, onComplete }: { studentId: string | number, studentName?: string, onComplete?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (selectedFile: File) => {
    if (!selectedFile.type.startsWith('image/')) {
      setStatus('error');
      setMessage('Please upload a valid image file (JPG/PNG).');
      return;
    }
    setFile(selectedFile);
    setPreview(URL.createObjectURL(selectedFile));
    setStatus('idle');
  };

  const handleUpload = async () => {
    if (!file) return;
    setStatus('uploading');
    setMessage('');
    
    try {
      await api.enrollStudentFace(studentId, file);
      setStatus('success');
      setMessage('Face successfully enrolled in the system!');
      if (onComplete) {
        setTimeout(onComplete, 2000);
      }
    } catch (error: any) {
      console.error(error);
      setStatus('error');
      setMessage(error.response?.data?.detail || 'Failed to extract face embedding. Ensure the photo contains a clear face.');
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 max-w-md w-full border border-gray-100 dark:border-gray-700">
      <div className="text-center mb-6">
        <div className="mx-auto w-12 h-12 bg-indigo-100 dark:bg-indigo-900/50 rounded-full flex items-center justify-center mb-3">
          <Camera className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Face Enrollment</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Upload a clear photo for {studentName || `student (ID: ${studentId})`}
        </p>
      </div>

      {!preview ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors cursor-pointer group"
        >
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
            id="file-upload"
          />
          <label htmlFor="file-upload" className="cursor-pointer">
            <Upload className="w-8 h-8 text-gray-400 group-hover:text-indigo-500 mx-auto mb-3 transition-colors" />
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Click to upload or drag and drop
            </p>
            <p className="text-xs text-gray-500 mt-1">PNG, JPG up to 5MB</p>
          </label>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
            <img src={preview} alt="Preview" className="w-full h-full object-cover" />
            {status === 'idle' && (
              <button 
                onClick={() => { setFile(null); setPreview(null); }}
                className="absolute top-2 right-2 p-1 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-sm"
              >
                <XCircle className="w-5 h-5" />
              </button>
            )}
          </div>
          
          {status === 'idle' && (
            <button
              onClick={handleUpload}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
            >
              Extract & Save Embedding
            </button>
          )}

          {status === 'uploading' && (
            <div className="py-3 text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600 mx-auto mb-2"></div>
              <p className="text-sm text-gray-500">Processing with ArcFace...</p>
            </div>
          )}

          {status === 'success' && (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="p-4 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-lg flex items-start gap-3">
              <CheckCircle className="w-5 h-5 shrink-0" />
              <p className="text-sm font-medium">{message}</p>
            </motion.div>
          )}

          {status === 'error' && (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg flex items-start gap-3">
              <XCircle className="w-5 h-5 shrink-0" />
              <p className="text-sm font-medium">{message}</p>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
