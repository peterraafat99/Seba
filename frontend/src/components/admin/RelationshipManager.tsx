import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/utils/api';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { 
  UserPlus, 
  Users, 
  School, 
  Link as LinkIcon, 
  Plus,
  Trash2, 
  GraduationCap, 
  Mail, 
  ShieldAlert,
  Camera,
  X
} from 'lucide-react';
import { FaceEnrollment } from '@/components/FaceEnrollment';

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  school_id?: number | null;
}

interface SchoolItem {
  id: number;
  name: string;
}

interface ClassroomItem {
  id: number;
  name: string;
  room_number?: string;
}

interface ClassroomDetail {
  id: number;
  name: string;
  room_number?: string;
  students: {
    student_id: number;
    name: string;
    email: string;
    is_active: boolean;
    has_face_profile?: boolean;
  }[];
  teachers: {
    teacher_id: number;
    name: string;
    role: string;
    subject?: string;
  }[];
}

export const RelationshipManager = () => {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [subTab, setSubTab] = useState<'create_user' | 'classroom_roster' | 'linking' | 'create_school_class'>('create_user');
  
  // Scoping States
  const [schools, setSchools] = useState<SchoolItem[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  
  // Data lists
  const [classrooms, setClassrooms] = useState<ClassroomItem[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState<string>('');
  const [classroomDetail, setClassroomDetail] = useState<ClassroomDetail | null>(null);
  
  // Face enrollment modal state
  const [enrollStudentFaceId, setEnrollStudentFaceId] = useState<number | null>(null);
  const [enrollStudentFaceName, setEnrollStudentFaceName] = useState('');
  
  const [parents, setParents] = useState<User[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [students, setStudents] = useState<User[]>([]);
  const [grades, setGrades] = useState<any[]>([]);
  const [selectedGradeId, setSelectedGradeId] = useState<string>('');
  
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // --- Form States ---
  // 1. Create User
  const [createUserForm, setCreateUserForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'student',
    school_id: ''
  });

  // 2. Add student to classroom
  const [selectedStudentsForClass, setSelectedStudentsForClass] = useState<string[]>([]);
  
  // 3. Assign teacher to classroom
  const [assignTeacherForm, setAssignTeacherForm] = useState({
    teacher_id: '',
    role: 'subject', // homeroom or subject
    subject: ''
  });

  // 4. Traditional Linking
  const [selectedParent, setSelectedParent] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [selectedStudentsForParent, setSelectedStudentsForParent] = useState<string[]>([]);
  const [selectedStudentsForTeacher, setSelectedStudentsForTeacher] = useState<string[]>([]);

  // 5. School Form
  const [schoolForm, setSchoolForm] = useState({
    name: '',
    address: '',
    logo_url: ''
  });

  // 6. Grade Form
  const [gradeForm, setGradeForm] = useState({
    name: '',
    academic_year: '2025-2026'
  });

  // 7. Classroom Form
  const [classroomForm, setClassroomForm] = useState({
    name: '',
    room_number: '',
    capacity: '30',
    is_exam_room: false
  });

  const [showCreateGradeForm, setShowCreateGradeForm] = useState(false);

  useEffect(() => {
    // Determine current user
    const userStr = localStorage.getItem('user');
    if (userStr) {
      const user = JSON.parse(userStr);
      setCurrentUser(user);
      if (user.role !== 'super_admin' && user.school_id) {
        setSelectedSchoolId(user.school_id.toString());
      }
    }
    loadBaseData();
  }, []);

  useEffect(() => {
    if (selectedSchoolId) {
      loadSchoolSpecificData(selectedSchoolId);
    } else {
      setClassrooms([]);
      setSelectedClassroomId('');
      setClassroomDetail(null);
    }
  }, [selectedSchoolId, subTab]);

  useEffect(() => {
    if (selectedClassroomId) {
      loadClassroomDetail(selectedClassroomId);
    } else {
      setClassroomDetail(null);
    }
  }, [selectedClassroomId]);

  const loadBaseData = async () => {
    try {
      setLoading(true);
      // Fetch schools list if super_admin
      const userStr = localStorage.getItem('user');
      const user = userStr ? JSON.parse(userStr) : null;
      
      if (user && user.role === 'super_admin') {
        const schoolsRes = await api.getSchools();
        setSchools(schoolsRes.data);
      }
    } catch (e) {
      console.error(e);
      setMsg({ type: 'error', text: 'Failed to load initial metadata.' });
    } finally {
      setLoading(false);
    }
  };

  const loadSchoolSpecificData = async (schoolId: string) => {
    try {
      setLoading(true);
      const [classroomsRes, teachersRes, studentsRes, parentsRes, gradesRes] = await Promise.all([
        api.getClassrooms(schoolId).catch(() => ({ data: [] })),
        api.getSchoolUsers('teacher', schoolId).catch(() => ({ data: [] })),
        api.getSchoolUsers('student', schoolId).catch(() => ({ data: [] })),
        api.getSchoolUsers('parent', schoolId).catch(() => ({ data: [] })),
        api.getGrades(schoolId).catch(() => ({ data: [] }))
      ]);

      setClassrooms(classroomsRes.data || []);
      setTeachers(teachersRes.data || []);
      setStudents(studentsRes.data || []);
      setParents(parentsRes.data || []);
      setGrades(gradesRes.data || []);
      
      if (gradesRes.data.length > 0 && !selectedGradeId) {
        setSelectedGradeId(gradesRes.data[0].id.toString());
      }
      
      // Clear classroom details if classroom is not in new list
      if (!classroomsRes.data.some((c: any) => c.id.toString() === selectedClassroomId)) {
        setSelectedClassroomId('');
        setClassroomDetail(null);
      }
    } catch (e) {
      console.error(e);
      setMsg({ type: 'error', text: 'Failed to load school-specific rosters.' });
    } finally {
      setLoading(false);
    }
  };

  const loadClassroomDetail = async (classroomId: string) => {
    try {
      setLoadingDetail(true);
      const res = await api.getClassroomDetail(classroomId);
      setClassroomDetail(res.data);
    } catch (e) {
      console.error(e);
      setMsg({ type: 'error', text: 'Failed to load classroom roster.' });
    } finally {
      setLoadingDetail(false);
    }
  };

  // --- ACTIONS ---

  // Create User
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createUserForm.name || !createUserForm.email) return;

    try {
      setLoading(true);
      const schoolIdInt = selectedSchoolId ? parseInt(selectedSchoolId) : null;
      
      await api.createSchoolUser({
        name: createUserForm.name,
        email: createUserForm.email,
        password: createUserForm.password || undefined,
        role: createUserForm.role,
        school_id: createUserForm.role === 'super_admin' ? null : schoolIdInt
      });

      setMsg({ type: 'success', text: `Successfully created ${createUserForm.role}: ${createUserForm.name}` });
      setCreateUserForm({
        name: '',
        email: '',
        password: '',
        role: 'student',
        school_id: ''
      });
      
      // Reload lists
      if (selectedSchoolId) {
        loadSchoolSpecificData(selectedSchoolId);
      }
    } catch (err: any) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Failed to create user.' });
    } finally {
      setLoading(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  // Create School
  const handleCreateSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolForm.name) return;
    try {
      setLoading(true);
      await api.createSchool(schoolForm);
      setMsg({ type: 'success', text: `School '${schoolForm.name}' created successfully!` });
      setSchoolForm({ name: '', address: '', logo_url: '' });
      // Reload schools list
      const schoolsRes = await api.getSchools();
      setSchools(schoolsRes.data);
    } catch (err: any) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Failed to create school.' });
    } finally {
      setLoading(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  // Create Classroom
  const handleCreateClassroom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classroomForm.name) return;
    if (!selectedSchoolId) {
      setMsg({ type: 'error', text: 'Please select a school first.' });
      return;
    }
    
    try {
      setLoading(true);
      let gradeId = selectedGradeId;
      
      // If creating a new grade inline
      if (showCreateGradeForm) {
        if (!gradeForm.name) {
          setMsg({ type: 'error', text: 'Please enter a Grade Name.' });
          setLoading(false);
          return;
        }
        const gradeRes = await api.createGrade(selectedSchoolId, gradeForm);
        gradeId = gradeRes.data.id.toString();
        // Reload grades list
        const gradesRes = await api.getGrades(selectedSchoolId);
        setGrades(gradesRes.data);
        setShowCreateGradeForm(false);
        setGradeForm({ name: '', academic_year: '2025-2026' });
      }
      
      if (!gradeId) {
        setMsg({ type: 'error', text: 'Please select or create a Grade level first.' });
        setLoading(false);
        return;
      }

      await api.createClassroom(parseInt(gradeId), {
        name: classroomForm.name,
        room_number: classroomForm.room_number || undefined,
        capacity: classroomForm.capacity ? parseInt(classroomForm.capacity) : undefined,
        camera_source: '0',
        is_exam_room: classroomForm.is_exam_room
      });

      setMsg({ type: 'success', text: `Classroom '${classroomForm.name}' created successfully!` });
      setClassroomForm({ name: '', room_number: '', capacity: '30', is_exam_room: false });
      
      // Reload classrooms list
      loadSchoolSpecificData(selectedSchoolId);
    } catch (err: any) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Failed to create classroom.' });
    } finally {
      setLoading(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  // Assign Student to Classroom Roster
  const handleAddStudentsToClass = async () => {
    if (!selectedClassroomId || selectedStudentsForClass.length === 0) return;
    try {
      setLoadingDetail(true);
      const studentIds = selectedStudentsForClass.map(id => parseInt(id));
      await api.addClassroomStudents(selectedClassroomId, studentIds);
      setMsg({ type: 'success', text: 'Students added to classroom roster successfully.' });
      setSelectedStudentsForClass([]);
      loadClassroomDetail(selectedClassroomId);
    } catch (e) {
      setMsg({ type: 'error', text: 'Failed to add students to classroom roster.' });
    } finally {
      setLoadingDetail(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  // Remove Student from Classroom Roster
  const handleRemoveStudentFromClass = async (studentId: number) => {
    if (!selectedClassroomId || !confirm('Are you sure you want to remove this student from the classroom?')) return;
    try {
      setLoadingDetail(true);
      await api.removeClassroomStudent(selectedClassroomId, studentId);
      setMsg({ type: 'success', text: 'Student removed from classroom roster.' });
      loadClassroomDetail(selectedClassroomId);
    } catch (e) {
      setMsg({ type: 'error', text: 'Failed to remove student from classroom roster.' });
    } finally {
      setLoadingDetail(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  // Assign Teacher to Classroom Roster
  const handleAssignTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassroomId || !assignTeacherForm.teacher_id) return;
    try {
      setLoadingDetail(true);
      await api.assignClassroomTeacher(parseInt(selectedClassroomId), {
        teacher_id: parseInt(assignTeacherForm.teacher_id),
        role: assignTeacherForm.role,
        subject: assignTeacherForm.subject || undefined
      });
      setMsg({ type: 'success', text: 'Teacher assigned to classroom roster successfully.' });
      setAssignTeacherForm({ teacher_id: '', role: 'subject', subject: '' });
      loadClassroomDetail(selectedClassroomId);
    } catch (e) {
      setMsg({ type: 'error', text: 'Failed to assign teacher to classroom.' });
    } finally {
      setLoadingDetail(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  // Link Parent to Child
  const handleLinkParent = async () => {
    if (!selectedParent || selectedStudentsForParent.length === 0) return;
    try {
      setLoading(true);
      await api.linkParent(selectedParent, selectedStudentsForParent.map(id => parseInt(id)));
      setMsg({ type: 'success', text: 'Parent linked to children successfully.' });
      setSelectedStudentsForParent([]);
    } catch (e) {
      setMsg({ type: 'error', text: 'Failed to link parent.' });
    } finally {
      setLoading(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  // Link Teacher to Students directly (legacy platform relation)
  const handleLinkTeacher = async () => {
    if (!selectedTeacher || selectedStudentsForTeacher.length === 0) return;
    try {
      setLoading(true);
      await api.linkTeacher(selectedTeacher, selectedStudentsForTeacher.map(id => parseInt(id)));
      setMsg({ type: 'success', text: 'Teacher linked to students successfully.' });
      setSelectedStudentsForTeacher([]);
    } catch (e) {
      setMsg({ type: 'error', text: 'Failed to link teacher.' });
    } finally {
      setLoading(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  // Filter out students already in classroom roster
  const unassignedStudents = students.filter(
    s => !classroomDetail?.students.some(cs => cs.student_id === s.id)
  );

  return (
    <div className="space-y-6">
      {msg && <Alert type={msg.type} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      {/* School Scope Selection (Visible only for Super Admins) */}
      {currentUser?.role === 'super_admin' && (
        <Card className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-md border border-gray-200 dark:border-gray-700">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex items-center gap-2 text-gray-900 dark:text-white font-semibold text-lg">
              <School className="h-5 w-5 text-blue-500" />
              <span>Select Managing Institution:</span>
            </div>
            <select
              className="flex-1 md:max-w-md p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-blue-500 focus:border-blue-500"
              value={selectedSchoolId}
              onChange={e => setSelectedSchoolId(e.target.value)}
            >
              <option value="">-- Choose a School --</option>
              {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </Card>
      )}

      {/* Sub-tab navigation */}
      <div className="flex bg-gray-100 dark:bg-gray-800 p-1.5 rounded-xl max-w-2xl border border-gray-200 dark:border-gray-700">
        {[
          { id: 'create_user', label: 'Create Account', icon: UserPlus },
          { id: 'create_school_class', label: 'Schools & Classes', icon: School },
          { id: 'classroom_roster', label: 'Classroom Roster', icon: Users },
          { id: 'linking', label: 'Account Linking', icon: LinkIcon }
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id as any)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg transition-all ${
                subTab === tab.id
                  ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Check school assignment warnings */}
      {!selectedSchoolId && currentUser?.role === 'super_admin' && subTab !== 'create_user' && subTab !== 'create_school_class' && (
        <div className="p-8 bg-blue-500/10 border border-blue-500/30 rounded-xl text-center">
          <ShieldAlert className="h-10 w-10 text-blue-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Select a school first</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">Please choose a school from the header to configure classroom rosters or link accounts.</p>
        </div>
      )}

      {/* Main Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={subTab + '-' + selectedSchoolId}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -15 }}
          transition={{ duration: 0.2 }}
        >
          {/* TAB 1: Create User */}
          {subTab === 'create_user' && (
            <div className="max-w-2xl bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg">
              <h3 className="text-xl font-bold mb-6 text-gray-900 dark:text-white flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-blue-500" />
                <span>Create New User Account</span>
              </h3>

              <form onSubmit={handleCreateUser} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Full Name</label>
                    <Input
                      type="text"
                      placeholder="e.g. John Doe"
                      value={createUserForm.name}
                      onChange={e => setCreateUserForm({ ...createUserForm, name: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Email Address</label>
                    <Input
                      type="email"
                      placeholder="e.g. johndoe@school.com"
                      value={createUserForm.email}
                      onChange={e => setCreateUserForm({ ...createUserForm, email: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Role Type</label>
                    <select
                      className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-blue-500 focus:border-blue-500"
                      value={createUserForm.role}
                      onChange={e => setCreateUserForm({ ...createUserForm, role: e.target.value })}
                    >
                      <option value="student">Student</option>
                      <option value="teacher">Teacher</option>
                      <option value="school_admin">School Admin</option>
                      <option value="parent">Parent</option>
                      {currentUser?.role === 'super_admin' && <option value="super_admin">Super Admin</option>}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Password</label>
                    <Input
                      type="password"
                      placeholder="Leave blank for 'default123'"
                      value={createUserForm.password}
                      onChange={e => setCreateUserForm({ ...createUserForm, password: e.target.value })}
                    />
                  </div>
                </div>

                {currentUser?.role === 'super_admin' && createUserForm.role !== 'super_admin' && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Assign School</label>
                    <select
                      className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-blue-500 focus:border-blue-500"
                      value={selectedSchoolId}
                      onChange={e => setSelectedSchoolId(e.target.value)}
                    >
                      <option value="">-- No Assigned School (Platform Wide) --</option>
                      {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}

                <div className="pt-4">
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? 'Creating...' : 'Create Account'}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 1.5: Create School & Class */}
          {subTab === 'create_school_class' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in duration-350">
              
              {/* Column 1: School Creator (Only for Super Admins) */}
              {currentUser?.role === 'super_admin' && (
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg flex flex-col justify-between">
                  <div>
                    <h3 className="text-xl font-bold mb-6 text-gray-900 dark:text-white flex items-center gap-2">
                      <School className="h-5 w-5 text-blue-500" />
                      <span>Create New School / Campus</span>
                    </h3>

                    <form onSubmit={handleCreateSchool} className="space-y-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">School Name</label>
                        <Input
                          type="text"
                          placeholder="e.g. Seba Academy"
                          value={schoolForm.name}
                          onChange={e => setSchoolForm({ ...schoolForm, name: e.target.value })}
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Address / Location</label>
                        <Input
                          type="text"
                          placeholder="e.g. Cairo, Egypt"
                          value={schoolForm.address}
                          onChange={e => setSchoolForm({ ...schoolForm, address: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Logo URL (Optional)</label>
                        <Input
                          type="text"
                          placeholder="e.g. /logos/seba.png"
                          value={schoolForm.logo_url}
                          onChange={e => setSchoolForm({ ...schoolForm, logo_url: e.target.value })}
                        />
                      </div>
                      <div className="pt-4">
                        <Button type="submit" disabled={loading} className="w-full">
                          {loading ? 'Creating...' : 'Create School'}
                        </Button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* Column 2: Classroom & Grade Creator */}
              <div className={`bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg ${currentUser?.role !== 'super_admin' ? 'max-w-2xl mx-auto w-full' : ''}`}>
                <h3 className="text-xl font-bold mb-6 text-gray-900 dark:text-white flex items-center gap-2">
                  <Plus className="h-5 w-5 text-blue-500" />
                  <span>Create Class & Grade Level</span>
                </h3>

                <form onSubmit={handleCreateClassroom} className="space-y-4">
                  {currentUser?.role === 'super_admin' && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-705 dark:text-gray-300 mb-1.5">Select Campus School</label>
                      <select
                        className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-blue-500 focus:border-blue-500 text-sm"
                        value={selectedSchoolId}
                        onChange={e => setSelectedSchoolId(e.target.value)}
                        required
                      >
                        <option value="">-- Choose School --</option>
                        {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Toggle create new grade inline */}
                  <div className="border border-gray-200 dark:border-gray-750 p-4 rounded-lg bg-gray-50/50 dark:bg-gray-800/50">
                    <div className="flex items-center justify-between mb-3">
                      <label className="block text-sm font-semibold text-gray-707 dark:text-gray-300">Grade / Year Level</label>
                      <button
                        type="button"
                        onClick={() => setShowCreateGradeForm(!showCreateGradeForm)}
                        className="text-xs text-blue-500 hover:text-blue-700 font-semibold"
                      >
                        {showCreateGradeForm ? 'Choose Existing Grade' : '+ Create New Grade'}
                      </button>
                    </div>

                    {showCreateGradeForm ? (
                      <div className="space-y-3 pt-1 border-t border-gray-200 dark:border-gray-750 mt-2">
                        <p className="text-xs text-gray-505 dark:text-gray-400">Add a new year level to this school (e.g. Grade 11).</p>
                        <div>
                          <label className="block text-xs font-semibold text-gray-650 dark:text-gray-450 uppercase mb-1">Grade Name</label>
                          <Input
                            type="text"
                            placeholder="e.g. Grade 11"
                            value={gradeForm.name}
                            onChange={e => setGradeForm({ ...gradeForm, name: e.target.value })}
                            required={showCreateGradeForm}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-650 dark:text-gray-450 uppercase mb-1">Academic Year</label>
                          <Input
                            type="text"
                            placeholder="e.g. 2025-2026"
                            value={gradeForm.academic_year}
                            onChange={e => setGradeForm({ ...gradeForm, academic_year: e.target.value })}
                            required={showCreateGradeForm}
                          />
                        </div>
                      </div>
                    ) : (
                      <select
                        className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-blue-500 focus:border-blue-500 text-sm"
                        value={selectedGradeId}
                        onChange={e => setSelectedGradeId(e.target.value)}
                        required={!showCreateGradeForm}
                      >
                        <option value="">-- Choose Grade level --</option>
                        {grades.map(g => (
                          <option key={g.id} value={g.id}>
                            {g.name} ({g.academic_year})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Classroom Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-705 dark:text-gray-300 mb-1.5">Class / Room Name</label>
                      <Input
                        type="text"
                        placeholder="e.g. 11-A Biology Lab"
                        value={classroomForm.name}
                        onChange={e => setClassroomForm({ ...classroomForm, name: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-705 dark:text-gray-300 mb-1.5">Room Number (Optional)</label>
                      <Input
                        type="text"
                        placeholder="e.g. A-304"
                        value={classroomForm.room_number}
                        onChange={e => setClassroomForm({ ...classroomForm, room_number: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                    <div>
                      <label className="block text-sm font-semibold text-gray-705 dark:text-gray-300 mb-1.5">Student Capacity</label>
                      <Input
                        type="number"
                        placeholder="30"
                        value={classroomForm.capacity}
                        onChange={e => setClassroomForm({ ...classroomForm, capacity: e.target.value })}
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-6">
                      <input
                        type="checkbox"
                        id="is_exam_room"
                        checked={classroomForm.is_exam_room}
                        onChange={e => setClassroomForm({ ...classroomForm, is_exam_room: e.target.checked })}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <label htmlFor="is_exam_room" className="text-sm font-medium text-gray-707 dark:text-gray-300 cursor-pointer">
                        Is Exam/Proctoring Room
                      </label>
                    </div>
                  </div>

                  <div className="pt-4">
                    <Button type="submit" disabled={loading || (!selectedSchoolId && currentUser?.role === 'super_admin')} className="w-full">
                      {loading ? 'Creating...' : 'Create Classroom'}
                    </Button>
                  </div>
                </form>
              </div>

            </div>
          )}

          {/* TAB 2: Classroom Roster Management */}
          {subTab === 'classroom_roster' && selectedSchoolId && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left Column: Select Classroom */}
              <div className="lg:col-span-1 bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-md">
                <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
                  <School className="h-5 w-5 text-blue-500" />
                  <span>Choose Classroom</span>
                </h3>
                
                {classrooms.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No classrooms registered in this school.</p>
                ) : (
                  <div className="space-y-2">
                    {classrooms.map(room => (
                      <button
                        key={room.id}
                        onClick={() => setSelectedClassroomId(room.id.toString())}
                        className={`w-full text-left p-3.5 rounded-lg border transition-all ${
                          selectedClassroomId === room.id.toString()
                            ? 'border-blue-500 bg-blue-500/5 text-blue-700 dark:text-blue-400 font-semibold shadow-sm'
                            : 'border-gray-200 dark:border-gray-750 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        <div className="text-base">{room.name}</div>
                        {room.room_number && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Room: {room.room_number}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Right Column: Classroom details and roster management */}
              <div className="lg:col-span-2 space-y-6">
                {!selectedClassroomId ? (
                  <div className="bg-white dark:bg-gray-800 p-12 rounded-xl border border-gray-200 dark:border-gray-700 text-center shadow-md">
                    <Users className="h-10 w-10 text-gray-400 mx-auto mb-3" />
                    <h4 className="text-lg font-semibold text-gray-900 dark:text-white">No classroom selected</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Select a classroom from the panel to manage teachers and students.</p>
                  </div>
                ) : loadingDetail && !classroomDetail ? (
                  <div className="bg-white dark:bg-gray-800 p-12 rounded-xl border border-gray-200 dark:border-gray-700 text-center shadow-md">
                    <p className="text-gray-500 dark:text-gray-400">Loading roster details...</p>
                  </div>
                ) : classroomDetail && (
                  <>
                    {/* Active Roster List */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-md">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-4 mb-4 gap-2">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900 dark:text-white">{classroomDetail.name}</h3>
                          <p className="text-xs text-gray-500 dark:text-gray-400">Room: {classroomDetail.room_number || 'N/A'}</p>
                        </div>
                        <span className="self-start sm:self-center px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 rounded-full text-xs font-semibold">
                          {classroomDetail.students.length} Students Assigned
                        </span>
                      </div>

                      {/* Teachers Section */}
                      <div className="mb-6">
                        <h4 className="text-sm font-bold text-gray-550 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <GraduationCap className="h-4 w-4" />
                          <span>Assigned Faculty / Teachers</span>
                        </h4>
                        
                        {classroomDetail.teachers.length === 0 ? (
                          <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-750 p-3 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
                            No teachers assigned to this classroom yet.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {classroomDetail.teachers.map(t => (
                              <div key={t.teacher_id} className="p-3 bg-gray-55/30 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-650 flex justify-between items-center">
                                <div>
                                  <div className="font-semibold text-gray-900 dark:text-white">{t.name}</div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 capitalize">{t.role} • {t.subject || 'All Subjects'}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Students List Roster */}
                      <div>
                        <h4 className="text-sm font-bold text-gray-550 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <Users className="h-4 w-4" />
                          <span>Student Roster</span>
                        </h4>

                        {classroomDetail.students.length === 0 ? (
                          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6 bg-gray-50 dark:bg-gray-750 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
                            Classroom roster is currently empty. Use the sidebar/form below to add students.
                          </p>
                        ) : (
                          <div className="max-h-80 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
                            {classroomDetail.students.map(s => (
                              <div key={s.student_id} className="p-3.5 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                                <div>
                                  <div className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                    <span>{s.name}</span>
                                    {!s.is_active && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded">Inactive</span>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
                                    <Mail className="h-3 w-3" />
                                    <span>{s.email}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                                    s.has_face_profile
                                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                      : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                                  }`}>
                                    {s.has_face_profile ? 'Face Enrolled' : 'No Face'}
                                  </span>
                                  <button
                                    onClick={() => {
                                      setEnrollStudentFaceId(s.student_id);
                                      setEnrollStudentFaceName(s.name);
                                    }}
                                    className="p-1.5 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-all"
                                    title="Enroll/Update face photo"
                                  >
                                    <Camera className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => handleRemoveStudentFromClass(s.student_id)}
                                    className="p-1.5 text-gray-400 hover:text-red-650 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all"
                                    title="Remove from classroom roster"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Quick Assign Faculty Form */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-md">
                      <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
                        <GraduationCap className="h-5 w-5 text-blue-500" />
                        <span>Assign Teacher</span>
                      </h3>

                      <form onSubmit={handleAssignTeacher} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-gray-650 dark:text-gray-450 uppercase mb-1">Select Teacher</label>
                            <select
                              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                              value={assignTeacherForm.teacher_id}
                              onChange={e => setAssignTeacherForm({ ...assignTeacherForm, teacher_id: e.target.value })}
                              required
                            >
                              <option value="">-- Choose Teacher --</option>
                              {teachers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.email})</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-650 dark:text-gray-450 uppercase mb-1">Role</label>
                            <select
                              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                              value={assignTeacherForm.role}
                              onChange={e => setAssignTeacherForm({ ...assignTeacherForm, role: e.target.value })}
                            >
                              <option value="subject">Subject Teacher</option>
                              <option value="homeroom">Homeroom Teacher</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-650 dark:text-gray-450 uppercase mb-1">Subject (e.g. Physics)</label>
                            <Input
                              type="text"
                              placeholder="e.g. Science"
                              value={assignTeacherForm.subject}
                              onChange={e => setAssignTeacherForm({ ...assignTeacherForm, subject: e.target.value })}
                            />
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <Button type="submit" disabled={loadingDetail || !assignTeacherForm.teacher_id}>
                            Assign Faculty
                          </Button>
                        </div>
                      </form>
                    </div>

                    {/* Quick Roster Add Students Form */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-md">
                      <h3 className="text-lg font-bold mb-3 text-gray-900 dark:text-white flex items-center gap-2">
                        <UserPlus className="h-5 w-5 text-blue-500" />
                        <span>Add Students to Roster</span>
                      </h3>

                      <div className="space-y-4">
                        {unassignedStudents.length === 0 ? (
                          <p className="text-sm text-gray-500 dark:text-gray-400">All available students in this school are already assigned to this classroom.</p>
                        ) : (
                          <>
                            <div>
                              <label className="block text-xs font-semibold text-gray-650 dark:text-gray-450 uppercase mb-1.5">Select Students (Ctrl/Cmd click to select multiple)</label>
                              <select
                                multiple
                                className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white h-44 focus:ring-blue-500 focus:border-blue-500 text-sm"
                                value={selectedStudentsForClass}
                                onChange={e => setSelectedStudentsForClass(Array.from(e.target.selectedOptions, opt => opt.value))}
                              >
                                {unassignedStudents.map(s => (
                                  <option key={s.id} value={s.id}>{s.name} ({s.email})</option>
                                ))}
                              </select>
                            </div>
                            <Button
                              onClick={handleAddStudentsToClass}
                              disabled={loadingDetail || selectedStudentsForClass.length === 0}
                              className="w-full"
                            >
                              Add Selected Students ({selectedStudentsForClass.length})
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: Traditional Linking (Legacy Relationship Map) */}
          {subTab === 'linking' && selectedSchoolId && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-300">
              {/* Parent Linking */}
              <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
                  👨‍👩‍👧‍👦 Link Parent to Children
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-705 dark:text-gray-300 mb-1.5">Select Parent</label>
                    <select
                      className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-blue-500 focus:border-blue-500"
                      value={selectedParent}
                      onChange={e => setSelectedParent(e.target.value)}
                    >
                      <option value="">Choose a parent...</option>
                      {parents.map(p => <option key={p.id} value={p.id}>{p.name} ({p.email})</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-705 dark:text-gray-300 mb-1.5">Select Children (Multi-select)</label>
                    <select multiple
                      className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white h-48 focus:ring-blue-500 focus:border-blue-500"
                      value={selectedStudentsForParent}
                      onChange={e => setSelectedStudentsForParent(Array.from(e.target.selectedOptions, option => option.value))}
                    >
                      {students.map(s => <option key={s.id} value={s.id}>{s.name} ({s.email})</option>)}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">Hold Ctrl (Windows) or Cmd (Mac) to select multiple students.</p>
                  </div>

                  <Button onClick={handleLinkParent} disabled={loading || !selectedParent || selectedStudentsForParent.length === 0} className="w-full">
                    Link Selected Children
                  </Button>
                </div>
              </div>

              {/* Teacher Linking */}
              <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
                  👨‍🏫 Link Teacher to Students
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-705 dark:text-gray-300 mb-1.5">Select Teacher</label>
                    <select
                      className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-blue-500 focus:border-blue-500"
                      value={selectedTeacher}
                      onChange={e => setSelectedTeacher(e.target.value)}
                    >
                      <option value="">Choose a teacher...</option>
                      {teachers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.email})</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-705 dark:text-gray-300 mb-1.5">Select Students (Multi-select)</label>
                    <select multiple
                      className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white h-48 focus:ring-blue-500 focus:border-blue-500"
                      value={selectedStudentsForTeacher}
                      onChange={e => setSelectedStudentsForTeacher(Array.from(e.target.selectedOptions, option => option.value))}
                    >
                      {students.map(s => <option key={s.id} value={s.id}>{s.name} ({s.email})</option>)}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">Hold Ctrl (Windows) or Cmd (Mac) to select multiple students.</p>
                  </div>
                  <Button onClick={handleLinkTeacher} disabled={loading || !selectedTeacher || selectedStudentsForTeacher.length === 0} className="w-full">
                    Link Selected Students
                  </Button>
                </div>
              </div>
            </div>
          )}
        </motion.div>
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
                  if (selectedClassroomId) {
                    loadClassroomDetail(selectedClassroomId);
                  }
                }}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
