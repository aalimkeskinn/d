import React, { useState, useEffect } from 'react';
import { Calendar, Users, Building, Save, RotateCcw, AlertTriangle, Filter } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Teacher, Class, Subject, Schedule, DAYS, PERIODS, getTimeForPeriod, formatTimeRange } from '../types';
import { useFirestore } from '../hooks/useFirestore';
import { useToast } from '../hooks/useToast';
import { useConfirmation } from '../hooks/useConfirmation';
import { useErrorModal } from '../hooks/useErrorModal';
import { TimeConstraint } from '../types/constraints';
import { checkSlotConflict, validateScheduleWithConstraints } from '../utils/scheduleValidation';
import Button from '../components/UI/Button';
import ScheduleSlotModal from '../components/UI/ScheduleSlotModal';
import ConfirmationModal from '../components/UI/ConfirmationModal';
import ErrorModal from '../components/UI/ErrorModal';

const Schedules = () => {
  /* const navigate = useNavigate(); */
  const location = useLocation();
  const { data: teachers } = useFirestore<Teacher>('teachers');
  const { data: classes } = useFirestore<Class>('classes');
  const { data: subjects } = useFirestore<Subject>('subjects');
  const { data: schedules, add: addSchedule, update: updateSchedule, remove: removeSchedule } = useFirestore<Schedule>('schedules');
  const { data: timeConstraints } = useFirestore<TimeConstraint>('constraints');
  const { success, error } = useToast();
  const { confirmation, showConfirmation, hideConfirmation, confirmUnsavedChanges } = useConfirmation();
  const { errorModal, showError, hideError } = useErrorModal();

  const [mode, setMode] = useState<'teacher' | 'class'>('teacher');
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedDay, setSelectedDay] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [isSlotModalOpen, setIsSlotModalOpen] = useState(false);
  const [currentSchedule, setCurrentSchedule] = useState<Schedule['schedule']>({});
  const [originalSchedule, setOriginalSchedule] = useState<Schedule['schedule']>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const [selectedLevel, setSelectedLevel] = useState<string>('');
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [showScheduleTable, setShowScheduleTable] = useState(false);

  const createEmptyScheduleGrid = (): Schedule['schedule'] => {
    const grid: Schedule['schedule'] = {};
    DAYS.forEach(day => {
      grid[day] = {};
      PERIODS.forEach(period => { grid[day][period] = null; });
    });
    return grid;
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const modeParam = params.get('mode');
    const teacherId = params.get('teacherId');
    const classId = params.get('classId');

    if (modeParam === 'class' && classId) {
      setMode('class');
      setSelectedClassId(classId);
    } else if (teacherId) {
      setMode('teacher');
      setSelectedTeacherId(teacherId);
    }
  }, [location]);

  useEffect(() => {
    const newSchedule = createEmptyScheduleGrid();

    if (mode === 'teacher' && selectedTeacherId) {
      const existingSchedule = schedules.find(s => s.teacherId === selectedTeacherId);
      if (existingSchedule) {
        Object.assign(newSchedule, JSON.parse(JSON.stringify(existingSchedule.schedule)));
      }
    } else if (mode === 'class' && selectedClassId) {
      schedules.forEach(schedule => {
        Object.entries(schedule.schedule).forEach(([day, daySlots]) => {
          Object.entries(daySlots).forEach(([period, slot]) => {
            if (slot?.classId === selectedClassId) {
              if (!newSchedule[day]) newSchedule[day] = {};
              newSchedule[day][period] = { ...slot, teacherId: schedule.teacherId };
            }
          });
        });
      });
    }
    setCurrentSchedule(newSchedule);
    setOriginalSchedule(JSON.parse(JSON.stringify(newSchedule)));
    setHasUnsavedChanges(false);
  }, [mode, selectedTeacherId, selectedClassId, schedules]);

  useEffect(() => {
    setHasUnsavedChanges(JSON.stringify(currentSchedule) !== JSON.stringify(originalSchedule));
  }, [currentSchedule, originalSchedule]);

  useEffect(() => {
    setShowScheduleTable(
      (mode === 'teacher' && !!selectedTeacherId && !!selectedLevel && !!selectedSubject) ||
      (mode === 'class' && !!selectedClassId)
    );
  }, [mode, selectedTeacherId, selectedClassId, selectedLevel, selectedSubject]);

  const selectedTeacher = teachers.find(t => t.id === selectedTeacherId);
  const selectedClass = classes.find(c => c.id === selectedClassId);

  const getTeacherLevels = (teacher: Teacher | undefined): string[] => {
    if (!teacher) return [];
    return teacher.levels || [teacher.level];
  };

  const getTeacherBranches = (teacher: Teacher | undefined): string[] => {
    if (!teacher) return [];
    if (teacher.branches && teacher.branches.length > 0) return teacher.branches;
    // Split by comma or slash and trim whitespace
    return teacher.branch ? teacher.branch.split(/[,\/]/).map(b => b.trim()) : [];
  };

  const levelOptions = selectedTeacher
    ? getTeacherLevels(selectedTeacher).map(level => ({ value: level, label: level }))
    : [];

  const getSubjectOptions = () => {
    if (!selectedTeacher || !selectedLevel) return [];
    const teacherBranches = getTeacherBranches(selectedTeacher);
    const normalizedTeacherBranches = teacherBranches.map(b => b.toLocaleUpperCase('tr-TR').trim());

    // Level mapping for broader categories
    const LEVEL_MAPPING: Record<string, (string | number)[]> = {
      'Anaokul': [0, 'Anaokul', 'Anaokulu'],
      'Anaokulu': [0, 'Anaokul', 'Anaokulu'],
      'İlkokul': [1, 2, 3, 4, 'İlkokul'],
      'Ortaokul': [5, 6, 7, 8, 'Ortaokul'],
      'Lise': [9, 10, 11, 12, 'HZ', 'Hazırlık', 'Lise']
    };

    const filteredSubjects = subjects.filter(subject => {
      const normalizedSubjectBranch = subject.branch.toLocaleUpperCase('tr-TR').trim();

      // Permissive branch matching (substring match either way)
      const branchMatch = normalizedTeacherBranches.some(tb =>
        normalizedSubjectBranch === tb ||
        normalizedSubjectBranch.includes(tb) ||
        tb.includes(normalizedSubjectBranch)
      );

      const subjectLevels = (subject.levels || [subject.level]).map(l => String(l).toLocaleUpperCase('tr-TR').trim());
      const currentLevelStr = String(selectedLevel).toLocaleUpperCase('tr-TR').trim();

      let levelMatch = false;

      // Direct match
      if (subjectLevels.includes(currentLevelStr)) {
        levelMatch = true;
      }
      // Mapped match (e.g. if selected is "Ortaokul", match if subject has 5, 6, 7 or 8)
      else if (LEVEL_MAPPING[selectedLevel]) {
        const mappedLevels = LEVEL_MAPPING[selectedLevel].map(ml => String(ml).toLocaleUpperCase('tr-TR').trim());
        levelMatch = subjectLevels.some(l => mappedLevels.includes(l));
      }

      return branchMatch && levelMatch;
    });

    // Deduplicate by name
    const uniqueSubjects = new Map();
    filteredSubjects.forEach(s => {
      const normalizedName = s.name.toLocaleUpperCase('tr-TR').trim();
      if (!uniqueSubjects.has(normalizedName)) {
        uniqueSubjects.set(normalizedName, s);
      }
    });

    return Array.from(uniqueSubjects.values())
      .map(subject => ({ value: subject.id, label: subject.name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'tr-TR'));
  };

  const subjectOptions = getSubjectOptions();

  const getFilteredClasses = () => {
    if (mode !== 'teacher' || !selectedLevel || !selectedSubject) return classes;
    const selectedSubjectObj = subjects.find(s => s.id === selectedSubject);
    if (!selectedSubjectObj) return classes;
    return classes.filter(classItem => {
      const classLevels = classItem.levels || [classItem.level];
      return classLevels.includes(selectedLevel as any);
    });
  };

  const filteredClasses = getFilteredClasses();
  const sortedClasses = [...filteredClasses].sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  const handleSlotClick = (day: string, period: string) => {
    if (currentSchedule[day]?.[period]?.isFixed) return;
    setSelectedDay(day);
    setSelectedPeriod(period);
    setIsSlotModalOpen(true);
  };

  // DÜZELTME 1: handleSaveSlot
  const handleSaveSlot = (subjectId: string, classId: string, teacherId?: string) => {
    if (!selectedDay || !selectedPeriod) return;

    const isClearing = mode === 'teacher' ? !classId : !teacherId;

    if (!isClearing) {
      const conflictResult = checkSlotConflict(mode, selectedDay, selectedPeriod, mode === 'teacher' ? classId : teacherId!, mode === 'teacher' ? selectedTeacherId : selectedClassId, schedules, teachers, classes);
      if (conflictResult.hasConflict) {
        showError('Çakışma Tespit Edildi', conflictResult.message);
        return;
      }
    }

    setCurrentSchedule(prev => {
      const newSchedule = JSON.parse(JSON.stringify(prev));
      if (!newSchedule[selectedDay]) newSchedule[selectedDay] = {};

      if (isClearing) {
        newSchedule[selectedDay][selectedPeriod] = null;
      } else {
        if (mode === 'teacher') {
          newSchedule[selectedDay][selectedPeriod] = { classId, subjectId: selectedSubject || subjectId };
        } else {
          newSchedule[selectedDay][selectedPeriod] = { teacherId, subjectId, classId: selectedClassId };
        }
      }
      return newSchedule;
    });
    setIsSlotModalOpen(false);
  };

  const handleSaveSchedule = async () => {
    const validationResult = validateScheduleWithConstraints(mode, currentSchedule, mode === 'teacher' ? selectedTeacherId : selectedClassId, schedules, teachers, classes, subjects, timeConstraints);
    if (!validationResult.isValid) {
      showError('Program Kaydedilemedi', `Aşağıdaki sorunları düzeltin:\n\n${validationResult.errors.join('\n')}`);
      return;
    }
    if (validationResult.warnings.length > 0) {
      showConfirmation({ title: 'Uyarılar Mevcut', message: `Aşağıdaki uyarılar mevcut:\n\n${validationResult.warnings.join('\n')}\n\nYine de kaydetmek istiyor musunuz?`, type: 'warning', confirmText: 'Yine de Kaydet', cancelText: 'İptal', confirmVariant: 'primary' }, handleConfirmSave);
      return;
    }
    await handleConfirmSave();
  };

  // DÜZELTME 2: handleConfirmSave
  const handleConfirmSave = async () => {
    setIsSaving(true);
    try {
      if (mode === 'teacher') {
        const existingSchedule = schedules.find(s => s.teacherId === selectedTeacherId);
        const scheduleData = { schedule: currentSchedule, updatedAt: new Date() };
        if (existingSchedule) {
          await updateSchedule(existingSchedule.id, scheduleData);
        } else {
          await addSchedule({ teacherId: selectedTeacherId, ...scheduleData } as Omit<Schedule, 'id' | 'createdAt'>);
        }
        success('✅ Program Kaydedildi', `${selectedTeacher?.name} programı başarıyla güncellendi.`);
      } else {
        const affectedTeacherIds = new Set<string>();
        Object.values(originalSchedule).forEach(day => Object.values(day || {}).forEach(slot => { if (slot?.teacherId) affectedTeacherIds.add(slot.teacherId) }));
        Object.values(currentSchedule).forEach(day => Object.values(day || {}).forEach(slot => { if (slot?.teacherId) affectedTeacherIds.add(slot.teacherId) }));

        for (const teacherId of affectedTeacherIds) {
          const existingSchedule = schedules.find(s => s.teacherId === teacherId);
          const newTeacherSchedule = existingSchedule ? JSON.parse(JSON.stringify(existingSchedule.schedule)) : createEmptyScheduleGrid();

          DAYS.forEach(day => PERIODS.forEach(period => {
            if (newTeacherSchedule[day]?.[period]?.classId === selectedClassId) {
              newTeacherSchedule[day][period] = null;
            }
            const newSlot = currentSchedule[day]?.[period];
            if (newSlot?.teacherId === teacherId) {
              newTeacherSchedule[day][period] = { classId: selectedClassId, subjectId: newSlot.subjectId };
            }
          }));

          const hasAnyLesson = Object.values(newTeacherSchedule as any).some((day: any) => Object.values(day).some(slot => slot !== null));

          if (existingSchedule) {
            if (hasAnyLesson) {
              await updateSchedule(existingSchedule.id, { schedule: newTeacherSchedule, updatedAt: new Date() });
            } else {
              await removeSchedule(existingSchedule.id);
            }
          } else if (hasAnyLesson) {
            await addSchedule({ teacherId, schedule: newTeacherSchedule, updatedAt: new Date() } as Omit<Schedule, 'id' | 'createdAt'>);
          }
        }
        success('✅ Program Kaydedildi', `${selectedClass?.name} programı başarıyla güncellendi.`);
      }

      setOriginalSchedule(JSON.parse(JSON.stringify(currentSchedule)));
      error('❌ Kayıt Hatası', 'Program kaydedilirken bir hata oluştu.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (hasUnsavedChanges) {
      showConfirmation({ title: 'Değişiklikleri Sıfırla', message: 'Kaydedilmemiş değişiklikler var. Sıfırlamak istediğinizden emin misiniz?', type: 'warning', confirmText: 'Sıfırla', cancelText: 'İptal', confirmVariant: 'danger' }, confirmReset);
    } else {
      confirmReset();
    }
  };

  const confirmReset = () => {
    setIsResetting(true);
    setCurrentSchedule(JSON.parse(JSON.stringify(originalSchedule)));
    setHasUnsavedChanges(false);
    setIsResetting(false);
    success('🔄 Program Sıfırlandı', 'Tüm değişiklikler sıfırlandı');
  };

  const handleModeChange = (newMode: 'teacher' | 'class') => {
    if (hasUnsavedChanges) {
      showConfirmation({ title: 'Kaydedilmemiş Değişiklikler', message: 'Kaydedilmemiş değişiklikler var. Devam etmek istediğinizden emin misiniz?', type: 'warning', confirmText: 'Devam Et', cancelText: 'İptal', confirmVariant: 'danger' }, () => confirmModeChange(newMode));
    } else {
      confirmModeChange(newMode);
    }
  };

  const confirmModeChange = (newMode: 'teacher' | 'class') => {
    setMode(newMode);
    setSelectedTeacherId('');
    setSelectedClassId('');
    setCurrentSchedule({});
    setOriginalSchedule({});
    setHasUnsavedChanges(false);
    setSelectedLevel('');
    setSelectedSubject('');
    setShowScheduleTable(false);
  };

  const getSlotInfo = (day: string, period: string) => {
    const slot = currentSchedule[day]?.[period];
    if (mode === 'teacher') {
      if (!slot?.classId || slot.classId === 'fixed-period') return null;
      if (slot.classId === 'KULÜP' || slot.classId.startsWith('kulup-virtual-class-')) {
        const subject = subjects.find(s => s.id === slot.subjectId);
        return { classItem: { name: 'KULÜP' }, subject };
      }
      const classItem = classes.find(c => c.id === slot.classId);
      const subject = subjects.find(s => s.id === slot.subjectId);
      return { classItem, subject };
    } else {
      if (!slot?.teacherId) return null;
      if (slot.teacherId === 'KULÜP' || slot.teacherId.startsWith('kulup-virtual-teacher-')) {
        const subject = subjects.find(s => s.id === slot.subjectId);
        return { teacher: { name: 'KULÜP' }, subject };
      }
      const teacher = teachers.find(t => t.id === slot.teacherId);
      const subject = subjects.find(s => s.id === slot.subjectId);
      return { teacher, subject };
    }
  };



  const getTimeInfo = (period: string) => {
    const currentLevel = mode === 'teacher' ? selectedLevel as any : selectedClass?.level;
    const timePeriod = getTimeForPeriod(period, currentLevel);
    if (timePeriod) return formatTimeRange(timePeriod.startTime, timePeriod.endTime);
    return `${period}. Ders`;
  };

  const teacherOptions = teachers
    .map(teacher => ({ value: teacher.id, label: `${teacher.name} (${teacher.branch} - ${teacher.level})` }))
    .sort((a, b) => a.label.localeCompare(b.label, 'tr-TR'));
  const classOptions = sortedClasses.map(classItem => ({ value: classItem.id, label: `${classItem.name} (${classItem.level})` }));

  return (
    <div className="container-mobile">
      <div className="header-mobile">
        <div className="flex items-center">
          <Calendar className="w-8 h-8 text-ide-primary-600 mr-3" />
          <div>
            <h1 className="text-responsive-xl font-bold text-gray-900">Program Oluşturucu</h1>
            <p className="text-responsive-sm text-gray-600">{mode === 'teacher' ? 'Öğretmen bazlı program oluşturun' : 'Sınıf bazlı program oluşturun'}</p>
          </div>
        </div>
        <div className="button-group-mobile">
          <Button onClick={() => handleModeChange('teacher')} variant={mode === 'teacher' ? 'primary' : 'secondary'} icon={Users} className="w-full sm:w-auto">Öğretmen Modu</Button>
          <Button onClick={() => handleModeChange('class')} variant={mode === 'class' ? 'primary' : 'secondary'} icon={Building} className="w-full sm:w-auto">Sınıf Modu</Button>
        </div>
      </div>

      {/* Selection Panel - Premium Design */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 overflow-hidden">
        {/* Header Bar */}
        <div className={`bg-gradient-to-r ${mode === 'teacher' ? 'from-blue-600 to-blue-700' : 'from-emerald-600 to-emerald-700'} px-4 py-2.5`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {mode === 'teacher' ? <Users className="w-4 h-4 text-white/80" /> : <Building className="w-4 h-4 text-white/80" />}
              <span className="text-sm font-medium text-white">
                {mode === 'teacher' ? 'Öğretmen ve Ders Seçimi' : 'Sınıf Seçimi'}
              </span>
            </div>
            {((mode === 'teacher' && selectedTeacherId) || (mode === 'class' && selectedClassId)) && (
              <span className="text-xs bg-white/20 text-white px-2.5 py-1 rounded-full backdrop-blur-sm">
                {mode === 'teacher' ? selectedTeacher?.name : selectedClass?.name}
              </span>
            )}
          </div>
        </div>

        {/* Filter Controls */}
        <div className="p-4 bg-gray-50/50">
          {mode === 'teacher' ? (
            <div className="space-y-4">
              {/* Teacher Selection */}
              <div className="flex items-start gap-3">
                <div className="flex items-center gap-1 bg-white border-2 border-gray-200 rounded-xl px-3 py-2 hover:border-blue-300 transition-colors flex-1">
                  <Users className="w-4 h-4 text-blue-500 flex-shrink-0" />
                  <select
                    value={selectedTeacherId}
                    onChange={(e) => {
                      if (hasUnsavedChanges) {
                        confirmUnsavedChanges(() => {
                          setSelectedTeacherId(e.target.value);
                          setSelectedLevel('');
                          setSelectedSubject('');
                          setShowScheduleTable(false);
                        });
                      } else {
                        setSelectedTeacherId(e.target.value);
                        setSelectedLevel('');
                        setSelectedSubject('');
                        setShowScheduleTable(false);
                      }
                    }}
                    className="bg-transparent text-sm text-gray-700 font-medium focus:outline-none cursor-pointer flex-1 pr-1"
                  >
                    <option value="">Öğretmen Seçin...</option>
                    {teacherOptions.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Teacher Info Badge */}
              {selectedTeacher && (
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-200">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-blue-700">
                    <span className="font-medium">{selectedTeacher.name}</span>
                    <span className="text-blue-400">•</span>
                    <span>{getTeacherBranches(selectedTeacher).join(', ')}</span>
                    <span className="text-blue-400">•</span>
                    <span>{getTeacherLevels(selectedTeacher).join(', ')}</span>
                  </div>
                </div>
              )}

              {/* Level and Subject Filters */}
              {selectedTeacher && (
                <div className="flex flex-col lg:flex-row gap-3 p-3 bg-purple-50 rounded-xl border border-purple-200">
                  <div className="flex items-center gap-1 bg-white border-2 border-gray-200 rounded-xl px-3 py-2 hover:border-purple-300 transition-colors flex-1">
                    <Filter className="w-4 h-4 text-purple-500 flex-shrink-0" />
                    <select
                      value={selectedLevel}
                      onChange={(e) => setSelectedLevel(e.target.value)}
                      className="bg-transparent text-sm text-gray-700 font-medium focus:outline-none cursor-pointer flex-1 pr-1"
                    >
                      <option value="">Eğitim Seviyesi Seçin</option>
                      {levelOptions.map(l => (
                        <option key={l.value} value={l.value}>{l.label}</option>
                      ))}
                    </select>
                  </div>

                  {selectedLevel && (
                    <div className="flex items-center gap-1 bg-white border-2 border-gray-200 rounded-xl px-3 py-2 hover:border-purple-300 transition-colors flex-1">
                      <Calendar className="w-4 h-4 text-purple-500 flex-shrink-0" />
                      <select
                        value={selectedSubject}
                        onChange={(e) => setSelectedSubject(e.target.value)}
                        className="bg-transparent text-sm text-gray-700 font-medium focus:outline-none cursor-pointer flex-1 pr-1"
                      >
                        <option value="">Ders Seçin</option>
                        {subjectOptions.map(s => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Class Mode Selection */
            <div className="flex items-center gap-1 bg-white border-2 border-gray-200 rounded-xl px-3 py-2 hover:border-emerald-300 transition-colors">
              <Building className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <select
                value={selectedClassId}
                onChange={(e) => {
                  if (hasUnsavedChanges) {
                    confirmUnsavedChanges(() => setSelectedClassId(e.target.value));
                  } else {
                    setSelectedClassId(e.target.value);
                  }
                }}
                className="bg-transparent text-sm text-gray-700 font-medium focus:outline-none cursor-pointer flex-1 pr-1"
              >
                <option value="">Sınıf Seçin...</option>
                {classOptions.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Active Selection Bar */}
        {((mode === 'teacher' && (selectedTeacherId || selectedLevel || selectedSubject)) || (mode === 'class' && selectedClassId)) && (
          <div className={`px-4 py-2.5 ${mode === 'teacher' ? 'bg-blue-50/50 border-t border-blue-100' : 'bg-emerald-50/50 border-t border-emerald-100'} flex flex-wrap items-center gap-2`}>
            <span className="text-xs text-gray-500 mr-1">Seçili:</span>

            {mode === 'teacher' && selectedTeacher && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-blue-100 text-blue-700 pl-2.5 pr-1.5 py-1 rounded-full font-medium">
                <Users className="w-3 h-3" /> {selectedTeacher.name}
                <button onClick={() => { setSelectedTeacherId(''); setSelectedLevel(''); setSelectedSubject(''); }} className="hover:bg-blue-200 p-0.5 rounded-full transition-colors">
                  <span className="text-xs">×</span>
                </button>
              </span>
            )}
            {mode === 'teacher' && selectedLevel && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-purple-100 text-purple-700 pl-2.5 pr-1.5 py-1 rounded-full font-medium">
                <Filter className="w-3 h-3" /> {selectedLevel}
                <button onClick={() => { setSelectedLevel(''); setSelectedSubject(''); }} className="hover:bg-purple-200 p-0.5 rounded-full transition-colors">
                  <span className="text-xs">×</span>
                </button>
              </span>
            )}
            {mode === 'teacher' && selectedSubject && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-orange-100 text-orange-700 pl-2.5 pr-1.5 py-1 rounded-full font-medium">
                <Calendar className="w-3 h-3" /> {subjects.find(s => s.id === selectedSubject)?.name}
                <button onClick={() => setSelectedSubject('')} className="hover:bg-orange-200 p-0.5 rounded-full transition-colors">
                  <span className="text-xs">×</span>
                </button>
              </span>
            )}
            {mode === 'class' && selectedClass && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-emerald-100 text-emerald-700 pl-2.5 pr-1.5 py-1 rounded-full font-medium">
                <Building className="w-3 h-3" /> {selectedClass.name}
                <button onClick={() => setSelectedClassId('')} className="hover:bg-emerald-200 p-0.5 rounded-full transition-colors">
                  <span className="text-xs">×</span>
                </button>
              </span>
            )}

            <button
              onClick={() => { setSelectedTeacherId(''); setSelectedClassId(''); setSelectedLevel(''); setSelectedSubject(''); setShowScheduleTable(false); }}
              className="ml-auto text-xs text-red-600 hover:text-red-700 font-medium hover:bg-red-50 px-2 py-1 rounded-lg transition-colors"
            >
              Temizle
            </button>
          </div>
        )}
      </div>

      {showScheduleTable && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 overflow-hidden">
          {/* Schedule Header - Premium Design */}
          <div className={`bg-gradient-to-r ${mode === 'teacher' ? 'from-blue-600 to-blue-700' : 'from-emerald-600 to-emerald-700'} px-4 py-3`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-white">
                <h3 className="font-semibold text-sm">
                  📚 {mode === 'teacher'
                    ? `${selectedTeacher?.name} - ${selectedLevel} - ${subjects.find(s => s.id === selectedSubject)?.name}`
                    : `${selectedClass?.name} Programı`
                  }
                </h3>
                <p className="text-xs text-white/80 mt-0.5">
                  {mode === 'teacher'
                    ? `${selectedLevel} seviyesi için haftalık ders programı`
                    : `${selectedClass?.level} seviyesi`
                  }
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={handleReset} icon={RotateCcw} variant="secondary" disabled={!hasUnsavedChanges || isResetting} className="!py-1.5 !px-3 !text-xs">
                  {isResetting ? 'Sıfırlanıyor...' : 'Sıfırla'}
                </Button>
                <Button onClick={handleSaveSchedule} icon={Save} variant="primary" disabled={!hasUnsavedChanges || isSaving} className="!py-1.5 !px-3 !text-xs !bg-white !text-blue-700 hover:!bg-blue-50">
                  {isSaving ? 'Kaydediliyor...' : 'Kaydet'}
                </Button>
              </div>
            </div>
          </div>

          {/* Unsaved Changes Warning */}
          {hasUnsavedChanges && (
            <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <p className="text-xs text-amber-700 font-medium">Kaydedilmemiş değişiklikler var</p>
            </div>
          )}

          {/* Schedule Table */}
          <div className="table-responsive schedule-mobile">
            <table className="min-w-full schedule-table">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-center text-[10px] font-semibold text-gray-700 uppercase border bg-gray-50 tracking-wider">
                    Dersler
                  </th>
                  <th className="px-3 py-2 text-center text-[10px] font-semibold text-gray-700 uppercase border bg-gray-50 tracking-wider">
                    Saatler
                  </th>
                  {DAYS.map(day => (
                    <th key={day} className="px-3 py-2 text-center text-[10px] font-semibold text-gray-700 uppercase border bg-gray-50 tracking-wider">
                      {day}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {/* Hazırlık Row */}
                <tr className="bg-yellow-400">
                  <td className="px-3 py-2 font-semibold text-gray-900 border text-xs text-center border-black tracking-wide">
                    {(mode === 'teacher' ? selectedLevel : selectedClass?.level) === 'Ortaokul' ? 'HAZIRLIK' : 'KAHVALTI'}
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-900 border text-xs text-center border-black whitespace-nowrap">
                    {(mode === 'teacher' ? selectedLevel : selectedClass?.level) === 'Ortaokul' ? '08:30-08:40' : '08:30-08:50'}
                  </td>
                  <td colSpan={5} className="px-3 py-2 font-semibold text-gray-900 border-black border text-sm text-center tracking-wide">
                    {(mode === 'teacher' ? selectedLevel : selectedClass?.level) === 'Ortaokul' ? 'HAZIRLIK' : 'KAHVALTI / breakfast (20\')'}
                  </td>
                </tr>

                {/* Period Rows */}
                {PERIODS.map(period => {
                  const currentLevel = mode === 'teacher' ? selectedLevel : selectedClass?.level;
                  const isLunchPeriod = ((currentLevel === 'İlkokul' || currentLevel === 'Anaokulu') && period === '5') ||
                    (currentLevel === 'Ortaokul' && period === '6');
                  const showBreakfastAfter = currentLevel === 'Ortaokul' && period === '1';
                  const showAfternoonBreakAfter = period === '8';
                  const timeInfo = getTimeInfo(period);

                  return (
                    <React.Fragment key={period}>
                      <tr className={isLunchPeriod ? 'bg-yellow-400' : ''}>
                        <td className={`px-3 py-2 font-semibold text-gray-900 text-xs text-center border-black border tracking-wide ${isLunchPeriod ? '' : 'bg-gray-50'}`}>
                          {isLunchPeriod ? 'YEMEK' : `${period}. DERS`}
                        </td>
                        <td className={`px-3 py-2 font-medium text-gray-900 text-xs text-center border-black border whitespace-nowrap ${isLunchPeriod ? '' : 'bg-gray-50'}`}>
                          {isLunchPeriod
                            ? (currentLevel === 'İlkokul' || currentLevel === 'Anaokulu' ? '11:50-12:25' : '12:30-13:05')
                            : timeInfo
                          }
                        </td>

                        {isLunchPeriod ? (
                          <td colSpan={5} className="px-3 py-2 font-semibold text-gray-900 border-black border text-sm text-center tracking-wide">
                            ÖĞLE YEMEĞİ / LUNCH
                          </td>
                        ) : (
                          DAYS.map(day => {
                            const slotInfo = getSlotInfo(day, period);
                            const isClub = slotInfo?.subject?.id === 'auto-subject-kulup' || slotInfo?.subject?.name?.includes('KULÜP');

                            if (!slotInfo) {
                              return (
                                <td key={`${day}-${period}`} className="px-1 py-1 border border-black" onClick={() => handleSlotClick(day, period)}>
                                  <div className="min-h-[40px] flex items-center justify-center bg-gray-50 hover:bg-blue-50 cursor-pointer transition-colors rounded">
                                    <span className="text-gray-300 text-xs">+</span>
                                  </div>
                                </td>
                              );
                            }

                            return (
                              <td key={`${day}-${period}`} className="px-1 py-1 border border-black" onClick={() => handleSlotClick(day, period)}>
                                <div className={`min-h-[40px] flex flex-col items-center justify-center p-1 rounded cursor-pointer transition-colors ${isClub ? 'bg-purple-100 hover:bg-purple-200' : 'bg-blue-100 hover:bg-blue-200'}`}>
                                  <span className={`font-semibold text-xs ${isClub ? 'text-purple-900' : 'text-blue-900'}`}>
                                    {mode === 'teacher' ? slotInfo.classItem?.name : slotInfo.teacher?.name}
                                  </span>
                                  {!isClub && (
                                    <span className={`text-[10px] mt-0.5 ${mode === 'teacher' ? 'text-blue-700' : 'text-blue-700'}`}>
                                      {slotInfo.subject?.name}
                                    </span>
                                  )}
                                </div>
                              </td>
                            );
                          })
                        )}
                      </tr>

                      {/* Breakfast Row (after 1st period for Ortaokul) */}
                      {showBreakfastAfter && (
                        <tr className="bg-yellow-400">
                          <td className="px-3 py-2 font-semibold text-gray-900 border text-xs text-center border-black tracking-wide">
                            KAHVALTI
                          </td>
                          <td className="px-3 py-2 font-medium text-gray-900 border text-xs text-center border-black whitespace-nowrap">
                            09:15-09:35
                          </td>
                          <td colSpan={5} className="px-3 py-2 font-semibold text-gray-900 border-black border text-sm text-center tracking-wide">
                            KAHVALTI / BREAKFAST (20')
                          </td>
                        </tr>
                      )}

                      {/* Afternoon Break Row */}
                      {showAfternoonBreakAfter && (
                        <tr className="bg-yellow-400">
                          <td className="px-3 py-2 font-semibold text-gray-900 border text-xs text-center border-black tracking-wide">
                            İKİNDİ
                          </td>
                          <td className="px-3 py-2 font-medium text-gray-900 border text-xs text-center border-black whitespace-nowrap">
                            14:35-14:45
                          </td>
                          <td colSpan={5} className="px-3 py-2 font-semibold text-gray-900 border-black border text-sm text-center tracking-wide">
                            İKİNDİ KAHVALTISI / AFTERNOON SNACK (10')
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {((mode === 'teacher' && !selectedTeacherId) || (mode === 'class' && !selectedClassId)) && (<div className="text-center py-12 mobile-card"><Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" /><h3 className="text-lg font-medium text-gray-900 mb-2">{mode === 'teacher' ? 'Öğretmen Seçin' : 'Sınıf Seçin'}</h3><p className="text-gray-500 mb-4">{mode === 'teacher' ? 'Program oluşturmak için bir öğretmen seçin' : 'Program oluşturmak için bir sınıf seçin'}</p></div>)}
      {mode === 'teacher' && selectedTeacherId && !showScheduleTable && (<div className="text-center py-12 mobile-card"><Filter className="w-16 h-16 text-gray-300 mx-auto mb-4" /><h3 className="text-lg font-medium text-gray-900 mb-2">Eğitim Seviyesi ve Ders Seçin</h3><p className="text-gray-500 mb-4">Program tablosunu görmek için yukarıdan eğitim seviyesi ve o seviyeye uygun bir ders seçimi yapın.</p></div>)}

      <ScheduleSlotModal isOpen={isSlotModalOpen} onClose={() => setIsSlotModalOpen(false)} onSave={handleSaveSlot} subjects={subjects} classes={sortedClasses} teachers={teachers} mode={mode} currentSubjectId={currentSchedule[selectedDay]?.[selectedPeriod]?.subjectId || selectedSubject} currentClassId={mode === 'teacher' ? currentSchedule[selectedDay]?.[selectedPeriod]?.classId || '' : selectedClassId} currentTeacherId={mode === 'class' ? currentSchedule[selectedDay]?.[selectedPeriod]?.teacherId || '' : selectedTeacherId} day={selectedDay} period={selectedPeriod} />
      <ConfirmationModal {...confirmation} onClose={hideConfirmation} />
      <ErrorModal {...errorModal} onClose={hideError} />
    </div>
  );
};

export default Schedules;