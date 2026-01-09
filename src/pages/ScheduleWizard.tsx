// --- START OF FILE src/pages/ScheduleWizard.tsx ---

import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Home,
  BookOpen,
  Building,
  Users,
  Calendar,
  MapPin,
  Zap,
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useFirestore } from '../hooks/useFirestore';
import { useToast } from '../hooks/useToast';
import Button from '../components/UI/Button';
import WizardStepBasicInfo from '../components/Wizard/WizardStepBasicInfo';
import WizardStepSubjects from '../components/Wizard/WizardStepSubjects';
import WizardStepClasses from '../components/Wizard/WizardStepClasses';
import WizardStepClassrooms from '../components/Wizard/WizardStepClassrooms';
import WizardStepTeachers from '../components/Wizard/WizardStepTeachers';
import WizardStepConstraints from '../components/Wizard/WizardStepConstraints';
import GenerationPanel from '../components/ScheduleWizard/GenerationPanel';
import WizardSidebar from '../components/ScheduleWizard/WizardSidebar';
import WizardHeader from '../components/ScheduleWizard/WizardHeader';
import { Teacher, Class, Subject, Schedule } from '../types/index';
import { createSubjectTeacherMappings } from '../utils/subjectTeacherMapping';
import { generateSystematicSchedule } from '../utils/scheduleGeneration';
import { WizardData, ScheduleTemplate, EnhancedGenerationResult } from '../types/wizard';
import { normalizeId, ultraClean } from '../utils/idUtils';
import ConfirmationModal from '../components/UI/ConfirmationModal';
import { useConfirmation } from '../hooks/useConfirmation';

const WIZARD_STEPS = [
  { id: 'basic-info', title: 'Temel Bilgiler', description: 'Program adı ve dönem', icon: Home },
  { id: 'subjects', title: 'Dersler', description: 'Ders seçimi ve saatleri', icon: BookOpen },
  { id: 'classes', title: 'Sınıflar', description: 'Sınıf seçimi ve özellikleri', icon: Building },
  { id: 'classrooms', title: 'Derslikler', description: 'Derslik yönetimi', icon: MapPin },
  { id: 'teachers', title: 'Öğretmenler', description: 'Öğretmen seçimi ve dersleri', icon: Users },
  { id: 'constraints', title: 'Kısıtlamalar', description: 'Zaman kuralları', icon: Calendar },
  { id: 'generation', title: 'Program Oluştur', description: 'Otomatik oluşturma', icon: Zap }
];

const ScheduleWizard = () => {
  const navigate = useNavigate();
  const { confirmation, showConfirmation, hideConfirmation } = useConfirmation();
  const location = useLocation();
  const { data: teachers } = useFirestore<Teacher>('teachers');
  const { data: classes } = useFirestore<Class>('classes');
  const { data: subjects } = useFirestore<Subject>('subjects');
  const { add: addTemplate, update: updateTemplate, data: templates } = useFirestore<ScheduleTemplate>('schedule-templates');
  const { add: addSchedule, update: updateSchedule, data: existingSchedules, remove: removeSchedule } = useFirestore<Schedule>('schedules');
  const { success, error, warning, info } = useToast();

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [wizardData, setWizardData] = useState<WizardData>({
    basicInfo: { name: '', academicYear: '2024/2025', semester: 'Güz', startDate: '2024-09-01', endDate: '2025-06-13', description: '', institutionTitle: 'Okul Müdürü', dailyHours: 9, weekDays: 5, weekendClasses: false },
    subjects: { selectedSubjects: [], subjectHours: {}, subjectPriorities: {} },
    classes: { selectedClasses: [], classCapacities: {}, classPreferences: {} },
    classrooms: [],
    teachers: { selectedTeachers: [], teacherSubjects: {}, teacherMaxHours: {}, teacherPreferences: {} },
    constraints: {
      timeConstraints: [],
      fixedSlots: [], // YENİ: Sabit ders yerleştirme
      globalRules: { maxDailyHoursTeacher: 6, maxDailyHoursClass: 9, maxConsecutiveHours: 3, avoidConsecutiveSameSubject: true, preferMorningHours: true, avoidFirstLastPeriod: false, lunchBreakRequired: true, lunchBreakDuration: 1, useDistributionPatterns: true, preferBlockScheduling: true, enforceDistributionPatterns: true, maximumBlockSize: 2 }
    },
    generationSettings: { algorithm: 'balanced', prioritizeTeacherPreferences: true, prioritizeClassPreferences: true, allowOverlaps: false, generateMultipleOptions: true, optimizationLevel: 'balanced' }
  });
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  const [generationPhase, setGenerationPhase] = useState<'initial' | 'generating' | 'club_pre_assigned' | 'club_saved' | 'completed' | 'manual_editing'>('initial');
  const [generationResult, setGenerationResult] = useState<EnhancedGenerationResult | null>(null);
  const [optimizationProgress, setOptimizationProgress] = useState(0); // Progress state
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false); // Added isGenerating state

  const stopOptimizationRef = useRef(false);


  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const templateId = urlParams.get('templateId');
    if (templateId && templates.length > 0) {
      const template = templates.find(t => t.id === templateId);
      if (template && template.wizardData) {
        setEditingTemplateId(templateId);

        // MIGRATION: Normalize all entityIds in timeConstraints to ensure backward compatibility
        const normalizedData = { ...template.wizardData };
        if (normalizedData.constraints?.timeConstraints) {
          normalizedData.constraints.timeConstraints = normalizedData.constraints.timeConstraints.map(c => ({
            ...c,
            entityId: normalizeId(c.entityId, c.entityType as any)
          }));
        }

        setWizardData(normalizedData);

        const newCompletedSteps = new Set<number>();
        if (template.wizardData.basicInfo?.name) newCompletedSteps.add(0);
        if (template.wizardData.subjects?.selectedSubjects?.length > 0) newCompletedSteps.add(1);
        if (template.wizardData.classes?.selectedClasses?.length > 0) newCompletedSteps.add(2);
        if (template.wizardData.classrooms?.length > 0) newCompletedSteps.add(3);
        if (template.wizardData.teachers?.selectedTeachers?.length > 0) newCompletedSteps.add(4);
        if (template.wizardData.constraints) newCompletedSteps.add(5);
        setCompletedSteps(newCompletedSteps);
      }
    }
  }, [location.search, templates]);

  // AUTOMATIC CLEANUP: Detect and fix duplicate schedules in Firestore
  // This addresses the issue where teachers have inflated hours (e.g. 70h instead of 45h)
  useEffect(() => {
    if (!existingSchedules || existingSchedules.length === 0) return;

    const teacherMap = new Map<string, typeof existingSchedules>();
    existingSchedules.forEach(s => {
      const list = teacherMap.get(s.teacherId) || [];
      list.push(s);
      teacherMap.set(s.teacherId, list);
    });

    teacherMap.forEach((list, teacherId) => {
      if (list.length > 1) {
        // console.warn(`Duplicate schedules found for teacher ${teacherId}. Cleaning up...`);
        // Sort by updatedAt desc (keep newest)
        list.sort((a, b) => {
          // Handle Firestore Timestamp or Date object
          const getMillis = (d: any) => {
            if (!d) return 0;
            if (typeof d.toMillis === 'function') return d.toMillis();
            if (d.seconds) return d.seconds * 1000;
            if (d instanceof Date) return d.getTime();
            return 0;
          };
          const tA = getMillis(a.updatedAt);
          const tB = getMillis(b.updatedAt);
          return tB - tA;
        });

        // Keep index 0, delete the rest
        for (let i = 1; i < list.length; i++) {
          removeSchedule(list[i].id);
        }
        info('Veri Temizliği', `Öğretmen ${teacherId} için çift kayıtlar temizlendi.`);
      }
    });
  }, [existingSchedules]);

  const onSelectedTeachersChange = (selectedTeacherIds: string[]) => {
    setWizardData(prev => ({ ...prev, teachers: { ...prev.teachers, selectedTeachers: selectedTeacherIds } }));
  };

  const currentStep = WIZARD_STEPS[currentStepIndex];

  const validateCurrentStep = (): boolean => {
    switch (currentStep.id) {
      case 'basic-info': return !!(wizardData.basicInfo.name && wizardData.basicInfo.academicYear);
      // Relax validation for other steps if we assume CSV data might be used directly
      // But for now, keep it to ensure user reviews the data
      case 'subjects': return wizardData.subjects.selectedSubjects.length > 0;
      case 'classes': return wizardData.classes.selectedClasses.length > 0;
      case 'teachers': return wizardData.teachers.selectedTeachers.length > 0;
      default: return true;
    }
  };

  const handleNext = () => { if (validateCurrentStep()) { setCompletedSteps(prev => new Set(Array.from(prev).concat(currentStepIndex))); if (currentStepIndex < WIZARD_STEPS.length - 1) { setCurrentStepIndex(currentStepIndex + 1); } } else { warning('⚠️ Eksik Bilgi', 'Lütfen gerekli alanları doldurun'); } };
  const handlePrevious = () => { if (currentStepIndex > 0) { setCurrentStepIndex(currentStepIndex - 1); } };
  const handleStepClick = (index: number) => {
    if ((completedSteps.has(index) || index < currentStepIndex) && validateCurrentStep()) {
      setCurrentStepIndex(index);
    }
  };

  const updateWizardData = (stepId: keyof WizardData, stepData: any) => {
    setWizardData(prev => ({ ...prev, [stepId]: stepData }));
  };

  const handleSaveTemplate = async () => {
    if (!wizardData.basicInfo.name) { warning('⚠️ Program Adı Gerekli', 'Lütfen program adını girin'); return; }
    setIsSaving(true);
    try {
      const templateData: Omit<ScheduleTemplate, 'id'> = { name: wizardData.basicInfo.name, description: wizardData.basicInfo.description, academicYear: wizardData.basicInfo.academicYear, semester: wizardData.basicInfo.semester, updatedAt: new Date(), wizardData, status: 'draft' as const, generatedSchedules: [] };
      if (editingTemplateId) {
        await updateTemplate(editingTemplateId, templateData);
        success('✅ Şablon Güncellendi', `'${templateData.name}' başarıyla güncellendi`);
      } else {
        const result = await addTemplate(templateData);
        if (result.success && result.id) {
          setEditingTemplateId(result.id);
          navigate(`/schedule-wizard?templateId=${result.id}`, { replace: true });
          success('✅ Şablon Kaydedildi', `'${templateData.name}' başarıyla kaydedildi`);
        } else {
          throw new Error(result.error || "Şablon eklenirken bilinmeyen bir hata oluştu.");
        }
      }
    } catch (err: any) { error('❌ Kayıt Hatası', `Şablon kaydedilirken bir hata oluştu: ${err.message}`); } finally { setIsSaving(false); }
  };

  const _handleGenerateSchedule = () => {
    setGenerationPhase('generating'); // This should be 'generating' for the full schedule
    stopOptimizationRef.current = false;

    setTimeout(async () => {
      try {
        info("Program oluşturuluyor...");

        // 1. Create Mappings
        const { mappings, errors: mappingErrors } = createSubjectTeacherMappings(wizardData, teachers, classes, subjects);

        // --- DIAGNOSTICS: Check for Orphaned Constraints ---
        const loadedTimeConstraints = wizardData.constraints?.timeConstraints || [];
        if (loadedTimeConstraints.length > 0) {
          const superClean = ultraClean;
          const validTIdsSC = new Set(teachers.map(t => superClean(t.id)));
          const validCIdsSC = new Set(classes.map(c => superClean(c.id)));
          const validSIdsSC = new Set(subjects.map(s => superClean(s.id)));

          let orphanCount = 0;
          loadedTimeConstraints.forEach(c => {
            const idSC = superClean(c.entityId);
            let isValid = false;
            // FIX: Normalize entityType for backward compatibility
            const typeNorm = c.entityType?.replace(/s$/, '') || '';
            if (typeNorm === 'teacher') isValid = validTIdsSC.has(idSC);
            else if (typeNorm === 'class') isValid = validCIdsSC.has(idSC);
            else if (typeNorm === 'subject') isValid = validSIdsSC.has(idSC);

            if (!isValid) {
              orphanCount++;
              // if (orphanCount < 5) console.warn(`Orphaned Constraint Detected: ${c.entityType} ID "${c.entityId}" not found in current data.`);
            }
          });

          if (orphanCount > 0) {
            // console.error(`TOTAL ORPHANED CONSTRAINTS: ${orphanCount}. These will be IGNORED by the scheduler.`);
          }
        }
        // --- END DIAGNOSTICS ---

        // DEBUG: Mappings'teki öğretmen bazlı toplam saatleri logla
        const mappingHoursByTeacher = new Map<string, number>();
        mappings.forEach(m => {
          if (!m.isClubTeacher) {
            mappingHoursByTeacher.set(m.teacherId, (mappingHoursByTeacher.get(m.teacherId) || 0) + m.weeklyHours);
          }
        });
        // console.log('📊 [MAPPING-DEBUG] Öğretmen bazlı toplam saatler (mappings):', Object.fromEntries(mappingHoursByTeacher));

        // Sınıf atamalarından beklenen saatler
        const expectedHoursByTeacher = new Map<string, number>();
        classes.forEach(classItem => {
          classItem.assignments?.forEach(assignment => {
            assignment.subjectIds.forEach(subjectId => {
              const subject = subjects.find(s => s.id === subjectId);
              if (subject) {
                expectedHoursByTeacher.set(assignment.teacherId, (expectedHoursByTeacher.get(assignment.teacherId) || 0) + subject.weeklyHours);
              }
            });
          });
        });

        // Farkları logla
        expectedHoursByTeacher.forEach((expected, teacherId) => {
          const actual = mappingHoursByTeacher.get(teacherId) || 0;
          if (expected !== actual) {
            const _teacher = teachers.find(t => t.id === teacherId);
            // console.warn(`🔴 [MAPPING-FARK] ${teacher?.name || teacherId}: Sınıf atamaları ${expected} saat, Mappings ${actual} saat (${expected - actual} eksik)`);
          }
        });

        if (mappingErrors.length > 0) {
          error("Planlama Hatası", `Program oluşturulamadı:\n- ${mappingErrors.join('\n- ')}`);
          setGenerationPhase('initial'); // Changed from 'idle'
          return;
        }

        // 2. Validate 45-Hour Constraint
        const classHours = new Map<string, number>();
        const classSubjectSeen = new Set<string>(); // To handle co-teaching: don't sum same subject twice for one class

        mappings.forEach(m => {
          const seenKey = `${m.classId}-${m.subjectId}`;
          if (!classSubjectSeen.has(seenKey)) {
            classHours.set(m.classId, (classHours.get(m.classId) || 0) + m.weeklyHours);
            classSubjectSeen.add(seenKey);
          }
        });


        const invalidClasses: string[] = [];
        classHours.forEach((hours, classId) => {
          if (hours !== 45) {
            const className = classes.find(c => c.id === classId)?.name || classId;
            invalidClasses.push(`${className}: ${hours} saat (45 olmalı)`);
          }
        });

        if (invalidClasses.length > 0) {
          error("Saat Hatası", `Aşağıdaki sınıfların ders yükü 45 saat değil:\n- ${invalidClasses.join('\n- ')}`);
          setGenerationPhase('initial'); // Changed from 'idle'
          return;
        }

        // 3. Generate
        const result = await generateSystematicSchedule(
          mappings,
          teachers,
          classes,
          subjects,
          wizardData.constraints?.timeConstraints || [],
          wizardData.constraints.globalRules,
          stopOptimizationRef,
          (progress) => {
            setOptimizationProgress(progress);
            // console.log(`Optimization Progress: ${progress}%`);
          },
          undefined, // initialSchedules
          wizardData.constraints?.fixedSlots || [] // fixedSlots
        );

        setGenerationResult(result);
        setGenerationPhase('completed'); // Changed from 'finished'

        if (result.statistics.placedLessons === result.statistics.totalLessonsToPlace) {
          success('🎉 Program Hazır!', 'Tüm dersler başarıyla yerleştirildi.');
        } else {
          warning('Tamamlanamadı', `En iyi sonuç: ${result.statistics.placedLessons}/${result.statistics.totalLessonsToPlace}. Bazı dersler yerleştirilemedi.`);
        }

      } catch (err: any) {
        error("Kritik Hata", `Beklenmedik bir hata oluştu: ${err.message}`);
        setGenerationPhase('initial'); // Changed from 'idle'
      }
    }, 50);
  };

  // NEW: Save clubs without reloading
  const handlePreAssignClubs = () => {
    setGenerationPhase('generating');
    stopOptimizationRef.current = false;

    setTimeout(async () => {
      try {
        info("Kulüp dersleri atanıyor...");

        const { mappings, errors: mappingErrors } = createSubjectTeacherMappings(wizardData, teachers, classes, subjects);

        if (mappingErrors.length > 0) {
          error("Planlama Hatası", `Kulüpler atanamadı:\n- ${mappingErrors.join('\n- ')}`);
          setGenerationPhase('initial');
          return;
        }

        // Sadece kulüp derslerini filtrele
        const clubMappings = mappings.filter(m => m.subjectId === 'auto-subject-kulup');

        // 3. Run generation ONLY for clubs
        const result = await generateSystematicSchedule(
          clubMappings,
          teachers,
          classes,
          subjects,
          wizardData.constraints?.timeConstraints || [],
          wizardData.constraints.globalRules,
          stopOptimizationRef,
          (_progress) => {
            // console.log(`Club Optimization Progress: ${progress}%`);
          },
          undefined, // initialSchedules
          wizardData.constraints?.fixedSlots || [] // fixedSlots
        );

        setGenerationResult(result);
        setGenerationPhase('club_pre_assigned');
        success('Kulüp Dersleri Atandı', 'Kulüp dersleri başarıyla yerleştirildi.');

      } catch (err: any) {
        console.error(err);
        error("Kritik Hata", `Kulüp ataması sırasında beklenmedik bir hata oluştu: ${err.message}`);
        setGenerationPhase('initial');
      } finally {
        setIsGenerating(false);
      }
    }, 50);
  };

  const handleSaveClubs = async () => {
    if (!generationResult) return; // Ensure generationResult is not null

    setIsSaving(true);
    try {
      const scheduleMap: { [teacherId: string]: Schedule['schedule'] } = {};

      // Iterate through the finalGrid of the generationResult to extract slots
      Object.entries(generationResult.finalGrid).forEach(([cId, days]) => {
        Object.entries(days).forEach(([day, periods]) => {
          Object.entries(periods).forEach(([period, slot]) => {
            if (slot?.teacherId) {
              const tId = slot.teacherId;
              if (!scheduleMap[tId]) {
                scheduleMap[tId] = {};
                const DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
                const PERIODS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
                DAYS.forEach(d => {
                  scheduleMap[tId][d] = {};
                  PERIODS.forEach(p => scheduleMap[tId][d][p] = null);
                });
              }

              scheduleMap[tId][day][period] = {
                classId: cId,
                subjectId: slot.subjectId
              };
            }
          });
        });
      });

      // Filter for club-related schedules to save only those
      const clubSchedulesToSave: Schedule[] = [];
      for (const teacherId in scheduleMap) {
        const teacherSchedule = scheduleMap[teacherId];
        let hasClub = false;
        for (const day in teacherSchedule) {
          for (const period in teacherSchedule[day]) {
            if (teacherSchedule[day][period]?.subjectId === 'auto-subject-kulup') {
              hasClub = true;
              break;
            }
          }
          if (hasClub) break;
        }
        if (hasClub) {
          clubSchedulesToSave.push({ teacherId, schedule: teacherSchedule, updatedAt: new Date() } as Schedule);
        }
      }

      const savePromises = clubSchedulesToSave.map(async (newSchedule) => {
        const existing = existingSchedules.find(s => s.teacherId === newSchedule.teacherId);
        if (existing) {
          // Merge or overwrite existing schedule with new club assignments
          // For this scenario, we'll assume we're updating the specific slots
          // or overwriting if it's a fresh club assignment.
          // A more robust solution would merge, but for now, let's simplify.
          await updateSchedule(existing.id, { schedule: newSchedule.schedule, updatedAt: new Date() });
        } else {
          await addSchedule(newSchedule);
        }
      });

      await Promise.all(savePromises);

      success('Kulüpler Kaydedildi', 'Kulüp atamaları başarıyla kaydedildi. Şimdi kalan dersleri atayabilirsiniz.');
      setGenerationPhase('club_saved'); // Move to state where we can assign rest
    } catch (err: any) {
      console.error(err);
      error('Kayıt Hatası', `Kulüpler kaydedilirken bir sorun oluştu: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAssignRemaining = async () => {
    setIsGenerating(true);
    // Give UI a moment to update
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      // 1. Filter assignments: EXCLUDE Club mappings
      const { mappings: allMappings } = createSubjectTeacherMappings(wizardData, teachers, classes, subjects);
      const remainingMappings = allMappings.filter(m => m.subjectId !== 'auto-subject-kulup');

      // 2. Get the current state of schedules (PRESERVE ONLY CLUBS)
      // We must avoid passing general lessons as "initialSchedules", 
      // otherwise re-running this will duplicate them.
      const initialSchedulesForRemaining = (generationResult?.schedules || []).map(entry => {
        const filteredSchedule: any = {};
        Object.entries(entry.schedule || {}).forEach(([day, periods]) => {
          Object.entries(periods || {}).forEach(([period, slot]: [string, any]) => {
            if (slot && (
              slot.subjectId === 'auto-subject-kulup' ||
              slot.teacherId === 'KULÜP' ||
              slot.classId?.startsWith('generic-') ||
              slot.isFixed // Manually fixed slots should also stay
            )) {
              if (!filteredSchedule[day]) filteredSchedule[day] = {};
              filteredSchedule[day][period] = slot;
            }
          });
        });
        return { ...entry, schedule: filteredSchedule };
      });

      // 3. Run generation with initialGrid = current Clubs
      const result = await generateSystematicSchedule(
        remainingMappings,
        teachers,
        classes,
        subjects,
        wizardData.constraints?.timeConstraints || [],
        wizardData.constraints.globalRules,
        stopOptimizationRef,
        (progress) => {
          setOptimizationProgress(progress);
          // console.log(`Remaining Optimization Progress: ${progress}%`);
        },
        initialSchedulesForRemaining,
        wizardData.constraints?.fixedSlots || [] // fixedSlots
      );

      setGenerationResult(result);
      setGenerationPhase('completed');
      success('Program Tamamlandı', 'Tüm dersler başarıyla dağıtıldı.');
    } catch (err: any) {
      console.error(err);
      error('Dağıtım Hatası', `Ders dağıtımı sırasında bir hata oluştu: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };





  const handleSaveAndExit = async () => { // Renamed from handleApplySchedule to avoid confusion
    if (!generationResult) return;
    setIsSaving(true);
    try {
      // ÖNEMLİ: finalGrid'den schedules'ı yeniden oluştur
      // Bu, manuel düzenleme ekranında görülen TÜM derslerin kaydedilmesini sağlar
      const schedulesFromGrid: typeof generationResult.schedules = [];
      const teacherScheduleMap: Record<string, any> = {};

      // finalGrid'den öğretmen bazlı schedule oluştur
      let skippedSlots = 0;
      if (generationResult.finalGrid) {
        Object.entries(generationResult.finalGrid).forEach(([classId, days]) => {
          Object.entries(days as any).forEach(([day, periods]) => {
            Object.entries(periods as any).forEach(([period, slot]: [string, any]) => {
              if (slot) {
                if (slot.teacherId && slot.subjectId) {
                  if (!teacherScheduleMap[slot.teacherId]) {
                    teacherScheduleMap[slot.teacherId] = {
                      teacherId: slot.teacherId,
                      schedule: {
                        Pazartesi: {},
                        Salı: {},
                        Çarşamba: {},
                        Perşembe: {},
                        Cuma: {}
                      }
                    };
                  }

                  // ÇAKIŞMA TESPİTİ: Bu slot zaten dolu mu?
                  const existingSlot = teacherScheduleMap[slot.teacherId].schedule[day][period];
                  if (existingSlot) {
                    console.error(`🔴 [ÇAKIŞMA] ${slot.teacherId} ${day} ${period}: ${existingSlot.classId} korunuyor, ${classId} atlanıyor!`);
                    // İLK SLOT'U KORU: Çakışma durumunda ilk slot'u koru, ikinci slot'u ATLAMA
                    // Bu sınıfın bu slot'unu kaydetmiyoruz ama finalGrid'de var
                    // TODO: Generation'daki çakışma sorununu kök nedeninden çözmek gerekiyor
                    return; // Bu slot'u işleme, bir sonraki slot'a geç
                  }

                  teacherScheduleMap[slot.teacherId].schedule[day][period] = {
                    classId,
                    subjectId: slot.subjectId,
                    ...(slot.isFixed && { isFixed: true }),
                    ...(slot.isFixedSlot && { isFixedSlot: true })
                  };
                } else {
                  // ATLANAN SLOT - teacherId veya subjectId yok!
                  skippedSlots++;
                  console.error(`🔴 [ATLANAN-SLOT] ${classId} ${day} ${period}: teacherId=${slot.teacherId}, subjectId=${slot.subjectId}`);
                }
              }
            });
          });
        });
      }
      if (skippedSlots > 0) {
        console.error(`📊 [ÖZET] ${skippedSlots} slot atlandı (teacherId veya subjectId eksik)!`);
      }

      // finalGrid'deki toplam slot sayısını ve sınıf bazlı dağılımı hesapla
      let totalFinalGridSlots = 0;
      let totalFinalGridSlotsWithTeacher = 0;
      const finalGridSlotsByClass: Record<string, number> = {};
      Object.entries(generationResult.finalGrid || {}).forEach(([classId, days]) => {
        Object.entries(days as any).forEach(([_day, periods]) => {
          Object.entries(periods as any).forEach(([_period, slot]: [string, any]) => {
            if (slot) {
              totalFinalGridSlots++;
              if (slot.teacherId && slot.subjectId) {
                totalFinalGridSlotsWithTeacher++;
                finalGridSlotsByClass[classId] = (finalGridSlotsByClass[classId] || 0) + 1;
              }
            }
          });
        });
      });
      // console.log(`📊 [FINAL-GRID] finalGrid'de toplam ${totalFinalGridSlots} slot var`);
      // console.log(`📊 [FINAL-GRID-DERS] teacherId+subjectId olan: ${totalFinalGridSlotsWithTeacher} slot`);
      // console.log(`📊 [FINAL-GRID-ATLANAN] teacherId/subjectId olmayan (YEMEK vs): ${totalFinalGridSlots - totalFinalGridSlotsWithTeacher} slot`);
      // console.log(`📊 [FINAL-GRID-SINIFLAR]`, finalGridSlotsByClass);

      // Map'i array'e çevir
      let totalSlotsFromGrid = 0;
      const slotsByClass: Record<string, number> = {};
      Object.values(teacherScheduleMap).forEach((schedule: any) => {
        Object.values(schedule.schedule).forEach((day: any) => {
          Object.values(day).forEach((slot: any) => {
            if (slot && slot.classId) {
              totalSlotsFromGrid++;
              slotsByClass[slot.classId] = (slotsByClass[slot.classId] || 0) + 1;
            }
          });
        });
        schedulesFromGrid.push(schedule as any);
      });

      // console.log(`🔄 [GRID→SCHEDULES] finalGrid'den ${schedulesFromGrid.length} öğretmen için ${totalSlotsFromGrid} slot oluşturuldu`);
      // console.log(`📊 [SINIF-BAZLI] Sınıf başına slot sayıları:`, slotsByClass);

      // Kaydetme işlemlerini takip et
      let totalAddedSlots = 0;
      let addedTeachers = 0;

      const savePromises = schedulesFromGrid.map(async (newSchedule) => {
        // Find ALL existing schedules for this teacher
        const existingDocs = existingSchedules.filter(s => s.teacherId === newSchedule.teacherId);

        // Slot sayısını hesapla
        let newSlotCount = 0;
        Object.values(newSchedule.schedule).forEach((day: any) => {
          Object.values(day).forEach((slot: any) => {
            if (slot && slot.classId) newSlotCount++;
          });
        });

        // Mevcut schedule'ları sil
        if (existingDocs.length > 0) {
          for (const doc of existingDocs) {
            await removeSchedule(doc.id);
          }
        }

        // Yeni schedule'ı ekle (KULÜP dahil tüm slotlar korunur)
        try {
          await addSchedule(newSchedule as Omit<Schedule, 'id' | 'createdAt'>);
          totalAddedSlots += newSlotCount;
          addedTeachers++;
        } catch (err) {
          console.error(`❌ [HATA] ${newSchedule.teacherId} için kaydetme başarısız:`, err);
        }
      });

      await Promise.all(savePromises);

      // console.log(`✅ [KAYDETME-ÖZET] ${addedTeachers} öğretmen için toplam ${totalAddedSlots} slot Firebase'e eklendi`);
      // console.log(`📊 [KARŞILAŞTIRMA] schedulesFromGrid: ${totalSlotsFromGrid} slot, Firebase'e eklenen: ${totalAddedSlots} slot`);

      // 2. Automatically Save/Update Template
      const templateData: Omit<ScheduleTemplate, 'id'> = {
        name: wizardData.basicInfo.name || `Program ${new Date().toLocaleDateString('tr-TR')}`,
        description: wizardData.basicInfo.description || 'Sihirbaz tarafından oluşturuldu',
        academicYear: wizardData.basicInfo.academicYear,
        semester: wizardData.basicInfo.semester,
        updatedAt: new Date(),
        wizardData,
        status: 'published' as const,
        generatedSchedules: [] // Optional: store IDs if needed
      };

      if (editingTemplateId) {
        await updateTemplate(editingTemplateId, templateData);
      } else {
        await addTemplate(templateData);
      }

      success('💾 Program Kaydedildi!', `${generationResult.schedules.length} öğretmen için program güncellendi ve taslak kaydedildi.`);
      navigate('/all-schedules');
    } catch (err: any) {
      error("Kayıt Hatası", `Program kaydedilirken bir hata oluştu: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleStopOptimization = () => {
    stopOptimizationRef.current = true;
  };

  const renderGenerationStep = () => {
    const totalLessons = generationResult?.statistics.totalLessonsToPlace || wizardData.subjects.selectedSubjects.reduce((sum, id) => sum + (wizardData.subjects.subjectHours[id] || 0), 0) || 0;

    const handleDeleteAllSchedules = () => {
      showConfirmation({
        title: 'Tüm Programları Sil',
        message: 'Mevcut tüm ders programları kalıcı olarak silinecek.\nBu işlem geri alınamaz ve sıfırdan başlamanız gerekecek.\n\nDevam etmek istiyor musunuz?',
        type: 'danger',
        confirmText: 'Evet, Hepsini Sil',
        cancelText: 'Vazgeç',
        confirmVariant: 'danger'
      }, () => {
        existingSchedules.forEach(s => removeSchedule(s.id));
        success('Başarılı', 'Tüm programlar temizlendi.');
      });
    };

    const handleManualEditSave = async (updatedSchedules: Omit<Schedule, 'id' | 'createdAt'>[]) => {
      setIsSaving(true);
      try {
        const savePromises = updatedSchedules.map(async (newSchedule) => {
          const existing = existingSchedules.find(s => s.teacherId === newSchedule.teacherId);
          if (existing) {
            await updateSchedule(existing.id, { schedule: newSchedule.schedule, updatedAt: new Date() });
          } else {
            await addSchedule(newSchedule);
          }
        });
        await Promise.all(savePromises);

        // Save template
        const templateData: Omit<ScheduleTemplate, 'id'> = {
          name: wizardData.basicInfo.name || `Program ${new Date().toLocaleDateString('tr-TR')}`,
          description: wizardData.basicInfo.description || 'Sihirbaz tarafından oluşturuldu',
          academicYear: wizardData.basicInfo.academicYear,
          semester: wizardData.basicInfo.semester,
          updatedAt: new Date(),
          wizardData,
          status: 'published' as const,
          generatedSchedules: []
        };

        if (editingTemplateId) {
          await updateTemplate(editingTemplateId, templateData);
        } else {
          await addTemplate(templateData);
        }

        success('💾 Program Kaydedildi!', 'Tüm değişiklikler başarıyla kaydedildi.');
        navigate('/all-schedules');
      } catch (err: any) {
        error('Kayıt Hatası', `Program kaydedilirken bir hata oluştu: ${err.message}`);
      } finally {
        setIsSaving(false);
      }
    };

    return (
      <GenerationPanel
        generationPhase={generationPhase}
        generationResult={generationResult}
        isGenerating={isGenerating}
        isSaving={isSaving}
        optimizationProgress={optimizationProgress}
        existingSchedules={existingSchedules}
        classes={classes}
        teachers={teachers}
        subjects={subjects}
        totalLessons={totalLessons}
        onPreAssignClubs={handlePreAssignClubs}
        onSaveClubs={handleSaveClubs}
        onAssignRemaining={handleAssignRemaining}
        onSaveAndExit={handleSaveAndExit}
        onStopOptimization={handleStopOptimization}
        onManualEdit={() => setGenerationPhase('manual_editing')}
        onManualEditCancel={() => setGenerationPhase('completed')}
        onManualEditSave={handleManualEditSave}
        onDeleteAllSchedules={handleDeleteAllSchedules}
      />
    );
  };

  const renderStepContent = () => {
    switch (currentStep.id) {
      case 'basic-info': return (<WizardStepBasicInfo data={wizardData.basicInfo} onUpdate={(data) => updateWizardData('basicInfo', data)} />);
      case 'subjects': return (<WizardStepSubjects data={wizardData.subjects} onUpdate={(data) => updateWizardData('subjects', data)} subjects={subjects} />);
      case 'classes': return (<WizardStepClasses data={wizardData} onUpdate={(data) => updateWizardData('classes', data.classes)} classes={classes} />);
      case 'classrooms': return (<WizardStepClassrooms data={wizardData} onUpdate={(data) => updateWizardData('classrooms', data.classrooms)} />);
      case 'teachers': return (<WizardStepTeachers selectedTeachers={wizardData.teachers.selectedTeachers} onSelectedTeachersChange={onSelectedTeachersChange} wizardData={wizardData} all_classes={classes} teachers={teachers} />);
      case 'constraints': return (<WizardStepConstraints data={wizardData} onUpdate={(data) => updateWizardData('constraints', data.constraints)} teachers={teachers} classes={classes} subjects={subjects} />);
      case 'generation': return renderGenerationStep();
      default: return <div>Bilinmeyen adım</div>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <WizardHeader
        title={wizardData.basicInfo.name || 'Program'}
        stepInfo={`Adım ${currentStepIndex + 1}: ${currentStep.title}`}
        isEditing={!!editingTemplateId}
        isSaving={isSaving}
        canSaveTemplate={!!wizardData.basicInfo.name}
        onSaveTemplate={handleSaveTemplate}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <WizardSidebar
            steps={WIZARD_STEPS}
            currentStepIndex={currentStepIndex}
            completedSteps={completedSteps}
            onStepClick={handleStepClick}
          />
          <div className="lg:col-span-3">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="p-6">{renderStepContent()}</div>
              <div className="p-6 border-t border-gray-200 bg-gray-50">
                <div className="flex items-center justify-between">
                  <Button onClick={handlePrevious} icon={ChevronLeft} variant="secondary" disabled={currentStepIndex === 0}>Önceki</Button>
                  {currentStepIndex < WIZARD_STEPS.length - 1 && (<Button onClick={handleNext} icon={ChevronRight} variant="primary" disabled={!validateCurrentStep()}>Sonraki</Button>)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ConfirmationModal
        {...confirmation}
        onClose={hideConfirmation}
      />
    </div>
  );
};

export default ScheduleWizard;
// --- END OF FILE src/pages/ScheduleWizard.tsx ---