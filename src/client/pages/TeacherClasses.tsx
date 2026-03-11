import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  LogOut,
  Plus,
  Library,
  Compass,
  BarChart,
  Users,
  Settings,
  HelpCircle,
  Search,
  MoreVertical,
  UserPlus,
  CheckCircle2,
  XCircle,
  ClipboardList,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  createTeacherClass,
  loadTeacherClasses,
  loadTeacherSettings,
  saveTeacherClasses,
  type TeacherClass,
} from '../lib/localData.ts';
import { signOutTeacher } from '../lib/teacherAuth.ts';

const COLOR_OPTIONS = ['bg-brand-purple', 'bg-brand-orange', 'bg-brand-yellow', 'bg-brand-dark', 'bg-white'];

const EMPTY_FORM = {
  id: '',
  name: '',
  subject: '',
  grade: '',
  color: 'bg-brand-purple',
  packId: '',
  notes: '',
};

export default function TeacherClasses() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [packs, setPacks] = useState<any[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('All');
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [studentName, setStudentName] = useState('');
  const [feedback, setFeedback] = useState('');
  const navigate = useNavigate();
  const teacherProfile = loadTeacherSettings().profile;
  const handleLogout = async () => {
    await signOutTeacher();
    navigate('/');
  };

  useEffect(() => {
    setClasses(loadTeacherClasses());
    fetch('/api/packs').then((res) => res.json()).then(setPacks);
    fetch('/api/dashboard/teacher/overview').then((res) => res.json()).then(setOverview);
  }, []);

  const subjects = useMemo(() => ['All', ...Array.from(new Set(classes.map((item) => item.subject))).filter(Boolean)], [classes]);

  const filteredClasses = useMemo(() => {
    return classes.filter((item) => {
      const matchesSearch =
        !searchQuery ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.grade.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesSubject = subjectFilter === 'All' || item.subject === subjectFilter;
      return matchesSearch && matchesSubject;
    });
  }, [classes, searchQuery, subjectFilter]);

  const selectedClass = classes.find((item) => item.id === selectedClassId) || null;

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setSelectedClassId(null);
    setStudentName('');
  };

  const persistClasses = (next: TeacherClass[]) => {
    setClasses(next);
    saveTeacherClasses(next);
  };

  const handleCreateNew = () => {
    resetForm();
    setSelectedClassId('new');
  };

  const handleEdit = (classItem: TeacherClass) => {
    setSelectedClassId(classItem.id);
    setForm({
      id: classItem.id,
      name: classItem.name,
      subject: classItem.subject,
      grade: classItem.grade,
      color: classItem.color,
      packId: classItem.packId ? String(classItem.packId) : '',
      notes: classItem.notes,
    });
    setStudentName('');
  };

  const handleSaveClass = () => {
    if (!form.name.trim() || !form.subject.trim() || !form.grade.trim()) {
      setFeedback('Fill class name, subject and grade before saving.');
      return;
    }

    if (form.id) {
      const next = classes.map((item) =>
        item.id === form.id
          ? {
              ...item,
              name: form.name.trim(),
              subject: form.subject.trim(),
              grade: form.grade.trim(),
              color: form.color,
              packId: form.packId ? Number(form.packId) : null,
              notes: form.notes.trim(),
            }
          : item,
      );
      persistClasses(next);
      setFeedback('Class updated.');
      return;
    }

    const created = createTeacherClass({
      name: form.name.trim(),
      subject: form.subject.trim(),
      grade: form.grade.trim(),
      color: form.color,
      packId: form.packId ? Number(form.packId) : null,
      notes: form.notes.trim(),
    });
    persistClasses([created, ...classes]);
    setSelectedClassId(created.id);
    setForm({
      id: created.id,
      name: created.name,
      subject: created.subject,
      grade: created.grade,
      color: created.color,
      packId: created.packId ? String(created.packId) : '',
      notes: created.notes,
    });
    setFeedback('Class created.');
  };

  const handleDeleteClass = (classId: string) => {
    const next = classes.filter((item) => item.id !== classId);
    persistClasses(next);
    if (selectedClassId === classId) resetForm();
    setFeedback('Class removed.');
  };

  const handleAddStudent = () => {
    if (!selectedClass || !studentName.trim()) return;
    const next = classes.map((item) =>
      item.id === selectedClass.id
        ? {
            ...item,
            students: [
              ...item.students,
              {
                id: `student-${Date.now()}`,
                name: studentName.trim(),
                joinedAt: new Date().toISOString(),
              },
            ],
          }
        : item,
    );
    persistClasses(next);
    setStudentName('');
    setFeedback('Student added to class.');
  };

  const handleRemoveStudent = (classId: string, studentId: string) => {
    const next = classes.map((item) =>
      item.id === classId ? { ...item, students: item.students.filter((student) => student.id !== studentId) } : item,
    );
    persistClasses(next);
    setFeedback('Student removed.');
  };

  const handleViewReports = (classItem: TeacherClass) => {
    if (!classItem.packId || !overview?.recent_sessions?.length) {
      navigate('/teacher/reports');
      return;
    }
    const match = overview.recent_sessions.find((session: any) => session.quiz_pack_id === classItem.packId);
    if (match?.session_id) {
      navigate(`/teacher/analytics/class/${match.session_id}`);
      return;
    }
    navigate('/teacher/reports');
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-dark font-sans flex overflow-hidden selection:bg-brand-orange selection:text-white">
      <motion.aside
        animate={{ width: isSidebarOpen ? 256 : 80 }}
        className="h-screen bg-white border-r-2 border-brand-dark flex flex-col flex-shrink-0 transition-all duration-300 relative z-20 shadow-[4px_0px_0px_0px_#1A1A1A]"
      >
        <div className="h-20 flex items-center px-6 border-b-2 border-brand-dark">
          {isSidebarOpen ? (
            <div className="text-2xl font-black tracking-tight flex items-center gap-1 cursor-pointer" onClick={() => navigate('/')}>
              <span className="text-brand-orange">Quiz</span>zi
            </div>
          ) : (
            <div className="w-10 h-10 bg-brand-yellow border-2 border-brand-dark text-brand-dark rounded-full flex items-center justify-center text-xl font-black mx-auto cursor-pointer" onClick={() => navigate('/')}>
              Q
            </div>
          )}
        </div>

        <div className="p-4 border-b-2 border-brand-dark">
          <button
            onClick={() => navigate('/teacher/pack/create')}
            className="w-full bg-brand-orange text-white border-2 border-brand-dark rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#e84d2a] transition-all shadow-[2px_2px_0px_0px_#1A1A1A] py-3"
          >
            <Plus className="w-5 h-5" />
            {isSidebarOpen && <span className="text-base">Create Quiz</span>}
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto hide-scrollbar">
          <NavItem icon={<Library />} label="My Quizzes" isOpen={isSidebarOpen} onClick={() => navigate('/teacher/dashboard')} />
          <NavItem icon={<Compass />} label="Discover" isOpen={isSidebarOpen} onClick={() => navigate('/explore')} />
          <NavItem icon={<BarChart />} label="Reports" isOpen={isSidebarOpen} onClick={() => navigate('/teacher/reports')} />
          <NavItem icon={<Users />} label="Classes" isOpen={isSidebarOpen} active onClick={() => navigate('/teacher/classes')} />

          <div className="my-4 border-t-2 border-brand-dark relative">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="absolute -right-6 top-1/2 -translate-y-1/2 w-6 h-6 bg-brand-yellow rounded-full flex items-center justify-center border-2 border-brand-dark hover:bg-yellow-300 transition-colors z-10 shadow-[2px_2px_0px_0px_#1A1A1A]"
            >
              <ChevronLeft className={`w-4 h-4 transition-transform ${!isSidebarOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>

          <NavItem icon={<Settings />} label="Settings" isOpen={isSidebarOpen} onClick={() => navigate('/teacher/settings')} />
          <NavItem icon={<HelpCircle />} label="Help Center" isOpen={isSidebarOpen} onClick={() => navigate('/teacher/help')} />
        </nav>

        <div className="p-4 border-t-2 border-brand-dark bg-brand-purple/10">
          <div className={`flex items-center ${isSidebarOpen ? 'justify-between' : 'justify-center'} bg-white border-2 border-brand-dark p-2 rounded-xl shadow-[2px_2px_0px_0px_#1A1A1A]`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-brand-yellow rounded-full flex items-center justify-center text-sm border-2 border-brand-dark overflow-hidden">
                {teacherProfile.avatar}
              </div>
              {isSidebarOpen && (
                <div>
                  <p className="font-black text-xs">{teacherProfile.firstName} {teacherProfile.lastName}</p>
                  <p className="text-[10px] font-bold text-brand-dark/60 truncate w-24">{teacherProfile.email}</p>
                </div>
              )}
            </div>
            {isSidebarOpen && (
              <button onClick={handleLogout} className="w-8 h-8 bg-brand-bg border-2 border-brand-dark text-brand-dark rounded-lg flex items-center justify-center hover:bg-brand-orange hover:text-white transition-colors" title="Log out">
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </motion.aside>

      <main className="flex-1 h-screen overflow-y-auto p-6 lg:p-8 relative bg-brand-bg">
        <div className="max-w-[1280px] mx-auto relative z-10">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl lg:text-4xl font-black tracking-tight">Classes</h1>
              <p className="text-brand-dark/60 font-bold mt-2">Manage class rosters, assign packs and jump into the latest related reports.</p>
            </div>
            <button
              onClick={handleCreateNew}
              className="px-6 py-3 bg-brand-yellow text-brand-dark border-2 border-brand-dark rounded-full flex items-center gap-2 hover:bg-yellow-300 transition-colors font-black text-base shadow-[2px_2px_0px_0px_#1A1A1A] w-fit"
            >
              <Plus className="w-5 h-5" />
              New Class
            </button>
          </div>

          {feedback && (
            <div className="mb-6 bg-white border-2 border-brand-dark rounded-2xl p-4 shadow-[2px_2px_0px_0px_#1A1A1A] flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <span className="font-bold">{feedback}</span>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-8">
            <section>
              <div className="bg-white border-2 border-brand-dark rounded-[2rem] p-5 shadow-[4px_4px_0px_0px_#1A1A1A] mb-6 flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-dark/40" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search classes, subjects or grades..."
                    className="w-full bg-brand-bg border-2 border-brand-dark rounded-full py-3 pl-12 pr-4 font-bold focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                  />
                </div>
                <select
                  value={subjectFilter}
                  onChange={(event) => setSubjectFilter(event.target.value)}
                  className="bg-brand-bg border-2 border-brand-dark rounded-full py-3 px-4 font-bold focus:outline-none"
                >
                  {subjects.map((subject) => (
                    <option key={subject} value={subject}>{subject}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {filteredClasses.map((classItem) => (
                  <ClassCard
                    key={classItem.id}
                    classItem={classItem}
                    packTitle={packs.find((pack) => pack.id === classItem.packId)?.title || 'No pack assigned'}
                    onEdit={() => handleEdit(classItem)}
                    onDelete={() => handleDeleteClass(classItem.id)}
                    onAddStudent={() => {
                      handleEdit(classItem);
                      setSelectedClassId(classItem.id);
                    }}
                    onViewReports={() => handleViewReports(classItem)}
                  />
                ))}
              </div>

              {filteredClasses.length === 0 && (
                <div className="bg-white border-2 border-brand-dark rounded-[2rem] p-10 mt-6 shadow-[4px_4px_0px_0px_#1A1A1A] text-center">
                  <p className="text-2xl font-black mb-2">No classes matched this filter.</p>
                  <p className="font-bold text-brand-dark/60">Try another query or create a new class.</p>
                </div>
              )}
            </section>

            <aside className="bg-white border-2 border-brand-dark rounded-[2rem] p-6 shadow-[4px_4px_0px_0px_#1A1A1A] h-fit sticky top-6">
              <div className="flex items-center gap-3 mb-6">
                <ClipboardList className="w-6 h-6 text-brand-purple" />
                <h2 className="text-2xl font-black">{form.id ? 'Edit Class' : 'Class Builder'}</h2>
              </div>

              <div className="space-y-4">
                <Field label="Class Name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
                <Field label="Subject" value={form.subject} onChange={(value) => setForm((current) => ({ ...current, subject: value }))} />
                <Field label="Grade" value={form.grade} onChange={(value) => setForm((current) => ({ ...current, grade: value }))} />

                <div>
                  <label className="block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50 mb-2">Assigned Pack</label>
                  <select
                    value={form.packId}
                    onChange={(event) => setForm((current) => ({ ...current, packId: event.target.value }))}
                    className="w-full bg-brand-bg border-2 border-brand-dark rounded-xl p-3 font-bold"
                  >
                    <option value="">No pack yet</option>
                    {packs.map((pack) => (
                      <option key={pack.id} value={pack.id}>{pack.title}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50 mb-2">Color</label>
                  <div className="flex gap-2">
                    {COLOR_OPTIONS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setForm((current) => ({ ...current, color }))}
                        className={`w-10 h-10 rounded-xl border-2 border-brand-dark ${color} ${form.color === color ? 'ring-4 ring-brand-orange/30' : ''}`}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50 mb-2">Notes</label>
                  <textarea
                    value={form.notes}
                    onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                    className="w-full bg-brand-bg border-2 border-brand-dark rounded-xl p-3 font-bold min-h-28"
                    placeholder="Optional notes for this class..."
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button onClick={handleSaveClass} className="flex-1 bg-brand-orange text-white border-2 border-brand-dark rounded-xl py-3 font-black shadow-[2px_2px_0px_0px_#1A1A1A]">
                  {form.id ? 'Update Class' : 'Create Class'}
                </button>
                <button onClick={resetForm} className="px-4 border-2 border-brand-dark rounded-xl font-black bg-white">
                  Reset
                </button>
              </div>

              {selectedClass && (
                <div className="mt-8 pt-6 border-t-2 border-brand-dark/10">
                  <h3 className="text-lg font-black mb-3">Students in {selectedClass.name}</h3>
                  <div className="flex gap-2 mb-3">
                    <input
                      value={studentName}
                      onChange={(event) => setStudentName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') handleAddStudent();
                      }}
                      placeholder="Add student name"
                      className="flex-1 bg-brand-bg border-2 border-brand-dark rounded-xl p-3 font-bold"
                    />
                    <button onClick={handleAddStudent} className="px-4 bg-brand-yellow border-2 border-brand-dark rounded-xl font-black">
                      Add
                    </button>
                  </div>
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {selectedClass.students.map((student) => (
                      <div key={student.id} className="flex items-center justify-between bg-brand-bg rounded-xl border-2 border-brand-dark/10 px-3 py-2">
                        <span className="font-bold">{student.name}</span>
                        <button onClick={() => handleRemoveStudent(selectedClass.id, student.id)} className="text-brand-orange">
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {selectedClass.students.length === 0 && <p className="text-sm font-bold text-brand-dark/50">No students added yet.</p>}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50 mb-2">{label}</label>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="w-full bg-brand-bg border-2 border-brand-dark rounded-xl p-3 font-bold" />
    </div>
  );
}

function ClassCard({
  classItem,
  packTitle,
  onEdit,
  onDelete,
  onAddStudent,
  onViewReports,
}: {
  key?: React.Key;
  classItem: TeacherClass;
  packTitle: string;
  onEdit: () => void;
  onDelete: () => void;
  onAddStudent: () => void;
  onViewReports: () => void;
}) {
  const isLight = classItem.color === 'bg-white' || classItem.color === 'bg-brand-yellow';
  const textColor = isLight ? 'text-brand-dark' : 'text-white';
  const secondaryButton = isLight ? 'bg-brand-dark text-white' : 'bg-white text-brand-dark';

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className={`${classItem.color} ${textColor} rounded-[2rem] p-6 border-2 border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A] flex flex-col gap-4`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black">{classItem.name}</h3>
          <p className={`font-bold ${isLight ? 'text-brand-dark/70' : 'text-white/70'}`}>{classItem.subject} · {classItem.grade}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onEdit} className="p-2 rounded-full border-2 border-current/20">
            <MoreVertical className="w-5 h-5" />
          </button>
          <button onClick={onDelete} className="p-2 rounded-full border-2 border-current/20">
            <XCircle className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="space-y-2 bg-white/10 rounded-2xl p-4 border border-current/10">
        <div className="flex items-center justify-between">
          <span className="font-bold">Students</span>
          <span className="font-black">{classItem.students.length}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-bold">Assigned Pack</span>
          <span className="font-black text-right line-clamp-1 max-w-[180px]">{packTitle}</span>
        </div>
      </div>

      <p className={`font-bold text-sm min-h-10 ${isLight ? 'text-brand-dark/70' : 'text-white/70'}`}>{classItem.notes || 'No notes yet.'}</p>

      <div className="flex gap-2 mt-auto">
        <button onClick={onViewReports} className={`flex-1 py-2 rounded-xl font-bold text-sm border-2 border-brand-dark shadow-[2px_2px_0px_0px_#1A1A1A] ${secondaryButton}`}>
          View Reports
        </button>
        <button onClick={onAddStudent} className={`p-2 rounded-xl border-2 border-brand-dark shadow-[2px_2px_0px_0px_#1A1A1A] ${secondaryButton}`}>
          <UserPlus className="w-5 h-5" />
        </button>
      </div>
    </motion.div>
  );
}

function NavItem({ icon, label, isOpen, active, onClick }: { icon: React.ReactNode; label: string; isOpen: boolean; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all ${active ? 'bg-brand-dark text-white border-brand-dark shadow-[2px_2px_0px_0px_#1A1A1A]' : 'bg-transparent border-transparent text-brand-dark/70 hover:bg-white hover:border-brand-dark hover:text-brand-dark hover:shadow-[2px_2px_0px_0px_#1A1A1A]'}`}>
      <div className="flex items-center gap-3">
        <div className={`w-5 h-5 flex items-center justify-center ${active ? 'text-brand-yellow' : ''}`}>
          {icon}
        </div>
        {isOpen && <span className="font-bold text-sm">{label}</span>}
      </div>
    </button>
  );
}
