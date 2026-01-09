import { Teacher, Class, Subject } from '../types/index';
import { getTeacherId, getClassId, getSubjectId } from './idUtils';

export interface ParsedCSVData {
  teachers: Map<string, Partial<Teacher>>;
  classes: Map<string, Partial<Class & { tempAssignments: Map<string, Set<string>>, classTeacherName: string | null }>>;
  subjects: Map<string, Partial<Subject>>;
  classSubjectTeacherLinks: { className: string, subjectKey: string, teacherName: string }[];
  errors: string[];
}

const normalizeLevel = (level: string): ('Anaokulu' | 'İlkokul' | 'Ortaokul') | null => {
  if (typeof level !== 'string' || !level.trim()) return null;
  const lowerLevel = level.trim().toLocaleLowerCase('tr-TR');
  if (lowerLevel.includes('anaokul')) return 'Anaokulu';
  if (lowerLevel.includes('ilkokul')) return 'İlkokul';
  if (lowerLevel.includes('ortaokul')) return 'Ortaokul';
  return null;
};

export const parseComprehensiveCSV = (csvContent: string): { teachers: Teacher[], classes: Class[], subjects: Subject[], errors: string[] } => {
  const teachersMap = new Map<string, Teacher>();
  const classesMap = new Map<string, Class>();
  const subjectsMap = new Map<string, Subject>();
  const errors: string[] = [];

  const lines = csvContent.split('\n').filter(line => line.trim() && !line.startsWith(';'));
  const dataLines = lines.slice(1);

  // Aggregation storage: className -> teacherNamesStr -> subjectName -> { hours, branch, level, pattern, isClubTeacher, isClubClass }
  const aggregation = new Map<string, Map<string, Map<string, { hours: number, branch: string, level: string, pattern: string, isClubTeacher: boolean, isClubClass: boolean }>>>();

  // 1. Pass: Aggregate Weekly Hours
  dataLines.forEach((line, index) => {
    const cleanLine = line.replace(/^\uFEFF/, '').replace(/\r$/, '');
    const columns = cleanLine.split(';').map(col => (col || '').trim().replace(/^"|"$/g, ''));

    if (columns.length < 6) {
      if (line.trim().length > 5) errors.push(`${index + 2}. satırda eksik sütun var.`);
      return;
    }

    const [teacherNameStr, branchStr, levelStr, subjectNameStr, classNameStr, weeklyHoursStr, distributionPatternStr, clubTeacherStr, clubClassStr] = columns;
    const hours = parseInt(weeklyHoursStr, 10) || 0;

    // Handle multiple classes (e.g. "1A / 1B", "5A-5B", "7A, 7B")
    const classNames = classNameStr.split(/[/,|]|\s+-\s+/).map(c => c.trim()).filter(c => !!c);

    classNames.forEach(className => {
      if (!aggregation.has(className)) aggregation.set(className, new Map());
      const teachersForClass = aggregation.get(className)!;

      // Group by the exact teacher string in the CSV row to handle co-teaching correctly
      const teacherKey = teacherNameStr;

      if (!teachersForClass.has(teacherKey)) teachersForClass.set(teacherKey, new Map());
      const subjectsForTeacher = teachersForClass.get(teacherKey)!;

      const subjectKey = subjectNameStr;
      if (!subjectsForTeacher.has(subjectKey)) {
        subjectsForTeacher.set(subjectKey, {
          hours: 0,
          branch: branchStr,
          level: levelStr,
          pattern: distributionPatternStr,
          isClubTeacher: clubTeacherStr?.toLowerCase() === 'x',
          isClubClass: clubClassStr?.toLowerCase() === 'x'
        });
      }
      subjectsForTeacher.get(subjectKey)!.hours += hours;
    });
  });

  // 2. Pass: Create Entities and Assignments
  aggregation.forEach((teachersForClass, className) => {
    const classId = getClassId(className);

    // Initialize Class at the top of the className loop to ensure it's ALWAYS created
    if (!classesMap.has(classId)) {
      const firstTeacherMap = Array.from(teachersForClass.values())[0];
      const firstSubjectData = firstTeacherMap ? Array.from(firstTeacherMap.values())[0] : null;
      const initialLevel = firstSubjectData ? normalizeLevel(firstSubjectData.level) : 'İlkokul';

      classesMap.set(classId, {
        id: classId,
        name: className,
        level: initialLevel || 'İlkokul',
        levels: initialLevel ? [initialLevel] : ['İlkokul'],
        createdAt: new Date(),
        assignments: [],
        teacherIds: [],
        classTeacherId: null,
        isClubClass: firstSubjectData?.isClubClass || false
      });
    }

    const classItem = classesMap.get(classId)!;
    const classLevels = new Set<"Anaokulu" | "İlkokul" | "Ortaokul">(classItem.levels || []);

    teachersForClass.forEach((subjectsForTeacher, teacherNamesStr) => {
      const teacherNames = teacherNamesStr.split(/[/,|]/).map(t => t.trim()).filter(t => !!t);

      subjectsForTeacher.forEach((data, subjectName) => {
        const levels = data.level.split('|').map((l: string) => normalizeLevel(l.trim())).filter((l): l is 'Anaokulu' | 'İlkokul' | 'Ortaokul' => !!l);
        const branches = data.branch.split(/[/,|]/).map(b => b.trim()).filter(b => !!b);

        // Update class levels if more are found
        levels.forEach(l => classLevels.add(l));

        // Create a TRULY UNIQUE Subject ID per Class+Teacher+Subject combo
        const subjectId = getSubjectId(className, teacherNamesStr, subjectName);

        if (!subjectsMap.has(subjectId)) {
          subjectsMap.set(subjectId, {
            id: subjectId,
            name: subjectName,
            branch: branches.join(' / '),
            level: levels[0] || 'İlkokul',
            levels: levels,
            weeklyHours: data.hours,
            distributionPattern: data.pattern || null,
            className, // YENİ: Sınıf adını ata
            createdAt: new Date()
          });
        }

        // Handle Teachers
        teacherNames.forEach(teacherName => {
          const teacherId = getTeacherId(teacherName);
          if (!teachersMap.has(teacherId)) {
            teachersMap.set(teacherId, {
              id: teacherId,
              name: teacherName,
              branch: branches.join(' / '),
              branches: branches,
              level: levels[0] || 'İlkokul',
              levels: levels,
              totalWeeklyHours: 0,
              isClubTeacher: data.isClubTeacher,
              createdAt: new Date()
            });
          }
          const teacher = teachersMap.get(teacherId)!;
          teacher.totalWeeklyHours = (teacher.totalWeeklyHours || 0) + data.hours;

          // Merge branches and levels for the teacher
          const currentBranches = new Set(teacher.branches);
          branches.forEach(b => currentBranches.add(b));
          teacher.branches = Array.from(currentBranches);

          const currentLevels = new Set(teacher.levels);
          levels.forEach(l => currentLevels.add(l));
          teacher.levels = Array.from(currentLevels);

          // Link to Class
          let assignment = classItem.assignments!.find(a => a.teacherId === teacherId);
          if (!assignment) {
            assignment = { teacherId, subjectIds: [] };
            classItem.assignments!.push(assignment);
            if (!classItem.teacherIds!.includes(teacherId)) {
              classItem.teacherIds!.push(teacherId);
            }
          }
          if (!assignment.subjectIds.includes(subjectId)) {
            assignment.subjectIds.push(subjectId);
          }
        });
      });
    });

    classItem.levels = Array.from(classLevels);
  });

  const teachers = Array.from(teachersMap.values());
  teachers.forEach(teacher => {
    if (teacher.isClubTeacher) {
      teacher.totalWeeklyHours = (teacher.totalWeeklyHours || 0) + 2;
    }
  });

  return {
    teachers,
    classes: Array.from(classesMap.values()),
    subjects: [
      ...Array.from(subjectsMap.values()),
      {
        id: 'auto-subject-kulup',
        name: 'KULÜP',
        branch: 'KULÜP',
        level: 'İlkokul',
        levels: ['İlkokul', 'Ortaokul'],
        weeklyHours: 2,
        createdAt: new Date()
      }
    ],
    errors
  };
};

// --- END OF FILE src/utils/csvParser.ts ---