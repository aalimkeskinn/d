// --- START OF FILE src/utils/subjectTeacherMapping.ts ---

import { WizardData, SubjectTeacherMapping } from '../types/wizard';
import { Teacher, Class, Subject } from '../types/index';

/**
 * Bir öğretmenin veya sınıfın eğitim seviyesini döndürür.
 * Levels dizisi varsa ilkini, yoksa ana level alanını kullanır.
 */
export const getEntityLevel = (entity: Teacher | Class): 'Anaokulu' | 'İlkokul' | 'Ortaokul' => {
  if (entity.levels && entity.levels.length > 0) return entity.levels[0];
  return (entity as any).level || 'İlkokul';
};

export const createSubjectTeacherMappings = (
  wizardData: WizardData,
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[]
): { mappings: SubjectTeacherMapping[], errors: string[] } => {
  const mappings: SubjectTeacherMapping[] = [];
  const errors: string[] = [];

  // Ensure unique selection to prevent duplicate mappings
  const selectedClassIds = Array.from(new Set(wizardData.classes.selectedClasses));
  const selectedSubjectIds = new Set(wizardData.subjects.selectedSubjects);
  const selectedTeacherIds = new Set(wizardData.teachers.selectedTeachers);

  selectedClassIds.forEach(classId => {
    const classItem = allClasses.find(c => c.id === classId);
    if (!classItem || !classItem.assignments || classItem.assignments.length === 0) return;

    classItem.assignments.forEach(assignment => {
      const teacherId = assignment.teacherId;
      const teacher = allTeachers.find(t => t.id === teacherId);

      if (!selectedTeacherIds.has(teacherId) || !teacher) return;

      // *** YENİ: Seviye uyumluluğunu burada kontrol et ***
      const teacherLevels = new Set(teacher.levels || [teacher.level]);
      const classLevel = getEntityLevel(classItem);
      if (!teacherLevels.has(classLevel)) {
        errors.push(`UYARI: ${teacher.name} (${Array.from(teacherLevels).join(', ')}) öğretmeni, ${classItem.name} (${classLevel}) sınıfının seviyesiyle uyumsuz. Bu atama yoksayıldı.`);
        return;
      }

      assignment.subjectIds.forEach(subjectId => {
        if (!selectedSubjectIds.has(subjectId)) return;

        const subject = allSubjects.find(s => s.id === subjectId);
        if (!subject) return;

        const weeklyHours = wizardData.subjects.subjectHours[subjectId] || subject.weeklyHours;
        const priority = wizardData.subjects.subjectPriorities[subjectId] || 'medium';

        // Distribution pattern parsing if enabled
        let distribution: number[] | undefined;
        if (wizardData.constraints.globalRules.useDistributionPatterns && subject.distributionPattern) {
          distribution = subject.distributionPattern.split('+').map(h => parseInt(h.trim())).filter(h => !isNaN(h));

          // Pattern ile haftalık saat uyumsuzluğu kontrolü
          const patternSum = distribution.reduce((a, b) => a + b, 0);
          if (patternSum !== weeklyHours) {
            errors.push(`UYARI: ${subject.name} (${classItem?.name || 'Bilinmeyen sınıf'}) dersinde dağıtım şekli (${subject.distributionPattern} = ${patternSum} saat) ile haftalık saat (${weeklyHours}) uyumsuz`);
          }
        }

        mappings.push({
          id: `${classId}-${subjectId}-${teacherId}`,
          classId,
          subjectId,
          subjectName: subject.name, // V8: Ders adını doğrudan mapping'e ekle
          teacherId,
          weeklyHours,
          assignedHours: 0,
          distribution,
          priority,
          isClubTeacher: teacher.isClubTeacher,
          isClubClass: classItem.isClubClass
        });
      });
    });
  });

  // *** YENİ: Havuz Bazlı Kulüp Ataması (1-e-1 yerine Toplu) ***
  const clubTeachers = allTeachers.filter(t => t.isClubTeacher && selectedTeacherIds.has(t.id));
  const clubClasses = allClasses.filter(c => c.isClubClass && selectedClassIds.includes(c.id));

  // Öğretmenleri sanal sınıflara ata (Her öğretmene özel sanal sınıf)
  clubTeachers.forEach(teacher => {
    mappings.push({
      id: `auto-kulup-teacher-${teacher.id}`,
      classId: `kulup-virtual-class-${teacher.id}`,
      subjectId: 'auto-subject-kulup',
      subjectName: 'KULÜP', // V8: Ders adı
      teacherId: teacher.id,
      weeklyHours: 2,
      assignedHours: 0,
      distribution: [2],
      priority: 'high',
      isClubTeacher: true,
      isClubClass: true
    });
  });

  // Sınıfları sanal öğretmenlere ata (Her sınıfa özel sanal öğretmen)
  clubClasses.forEach(classItem => {
    mappings.push({
      id: `auto-kulup-class-${classItem.id}`,
      classId: classItem.id,
      subjectId: 'auto-subject-kulup',
      subjectName: 'KULÜP', // V8: Ders adı
      teacherId: `kulup-virtual-teacher-${classItem.id}`,
      weeklyHours: 2,
      assignedHours: 0,
      distribution: [2],
      priority: 'high',
      isClubTeacher: true,
      isClubClass: true
    });
  });

  if (mappings.length === 0 && errors.length === 0) {
    errors.push("Seçili kriterlere uygun ders eşleşmesi bulunamadı. Lütfen öğretmen, sınıf ve ders seçimlerinizi kontrol edin.");
  }

  return { mappings, errors };
};

// --- END OF FILE src/utils/subjectTeacherMapping.ts ---